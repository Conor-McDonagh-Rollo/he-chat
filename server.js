import express from "express";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import mysql from "mysql2/promise";
import fs from "fs";
import path from "path";
import url from "url";
import dotenv from "dotenv";

dotenv.config();

import jwt from "jsonwebtoken";
import jwkToPem from "jwk-to-pem";
import fetch from "node-fetch";

const COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID;
const AWS_REGION = process.env.AWS_REGION || "us-east-1";
const COGNITO_ISSUER = `https://cognito-idp.${AWS_REGION}.amazonaws.com/${COGNITO_USER_POOL_ID}`;

let JWKS_CACHE = null;
async function getJwks() {
  if (JWKS_CACHE) return JWKS_CACHE;
  const res = await fetch(`${COGNITO_ISSUER}/.well-known/jwks.json`);
  JWKS_CACHE = await res.json();
  return JWKS_CACHE;
}

async function verifyToken(token) {
  if (!token) throw new Error("Missing token");
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded?.header?.kid) throw new Error("Invalid token header");
  const jwks = await getJwks();
  const jwk = jwks.keys.find(k => k.kid === decoded.header.kid);
  if (!jwk) throw new Error("Unknown key id");
  const pem = jwkToPem(jwk);
  return jwt.verify(token, pem, { issuer: COGNITO_ISSUER });
}


const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Config ---
const PORT = Number(process.env.PORT || 80);
const ROOMS = (process.env.ROOMS || "lobby,tech,gaming")
  .split(",")
  .map((r) => r.trim())
  .filter(Boolean);

// --- App first ---
const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, { cors: { origin: "*" } });

app.use(express.json({ limit: "64kb" }));

function authMiddleware(req, res, next) {
  try {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    verifyToken(token).then(payload => {
      req.user = payload;
      next();
    }).catch(() => res.status(401).json({ error: "Unauthorized" }));
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}

// --- Image handling ---
import AWS from "aws-sdk";
import multer from "multer";
import multerS3 from "multer-s3";

const s3 = new AWS.S3({
  region: process.env.AWS_REGION
});

const upload = multer({
  storage: multerS3({
    s3,
    bucket: process.env.S3_BUCKET,
    acl: "public-read",
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: (req, file, cb) => {
      const safeName = file.originalname.replace(/[^\w.\-]+/g, "_");
      const key = `uploads/${Date.now()}_${safeName}`;
      cb(null, key);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB
});

// handle uploads
app.post("/upload", authMiddleware, upload.single("image"), (req, res) => {
  res.json({ url: req.file.location });
});

// Note: uploads are stored in S3 and returned with public URLs
//       I should probably make this more secure... but for later


// --- Static + dynamic homepage ---
app.get(["/", "/index.html"], (_req, res) => {
  const html = fs.readFileSync(path.join(__dirname, "public/index.html"), "utf8");
  const cfg = {
    rooms: ROOMS,
    region: AWS_REGION,
    userPoolId: process.env.COGNITO_USER_POOL_ID,
    clientId: process.env.COGNITO_CLIENT_ID,
    domain: process.env.COGNITO_DOMAIN || "",
  };
  // Inject config early in so it's available before script.js runs
  const injected = html.replace(
    "<head>",
    `<head><script>window.HECHAT_CONFIG=${JSON.stringify(cfg)}</script>`
  );
  res.type("html").send(injected);
});

app.use(express.static(path.join(__dirname, "public")));

// --- DB setup ---
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: 10,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

const sanitizeRoom = (name) => name.toLowerCase().replace(/[^a-z0-9_]/g, "_");
const tableNameFor = (room) => `room_${sanitizeRoom(room)}`;

async function ensureRoomTables() {
  for (const room of ROOMS) {
    const table = tableNameFor(room);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`${table}\` (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        alias VARCHAR(40) NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }
}

// --- Routes ---
app.get("/health", authMiddleware, async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, rooms: ROOMS });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.get("/history/:room", authMiddleware, async (req, res) => {
  const room = req.params.room || "";
  if (!ROOMS.includes(room)) return res.status(400).json({ error: "Unknown room" });

  const limit = Math.max(1, Math.min(200, Number(req.query.limit || 50)));
  const offset = Math.max(0, Number(req.query.offset || 0));
  try {
    const [rows] = await pool.query(
      `SELECT alias, message, created_at FROM \`${tableNameFor(room)}\` ORDER BY id DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    res.json(rows.reverse());
  } catch {
    res.status(500).json({ error: "DB error" });
  }
});

// --- Socket.IO ---
io.use(async (socket, next) => {
  try {
    const token =
      socket.handshake.auth?.token ||
      (socket.handshake.headers?.authorization || "").replace(/^Bearer\s+/i, "");
    const payload = await verifyToken(token);
    socket.user = {
      sub: payload.sub,
      username: payload["cognito:username"] || payload.username || payload.email || "user",
      email: payload.email || null
    };
    return next();
  } catch (e) {
    return next(new Error("Unauthorized"));
  }
});

io.on("connection", (socket) => {
  let joinedRoom = null;

  socket.emit("auth_ok", { username: socket.user.username });

  socket.on("join", async ({ room }) => {
    const alias = socket.user.username; // trust Cognito
    try {
      if (typeof room !== "string") return;
      room = room.trim();
      if (!ROOMS.includes(room)) return;
      if (joinedRoom) socket.leave(joinedRoom);
      joinedRoom = room;
      socket.join(room);
      socket.emit("joined", { room, alias });
      const [rows] = await pool.query(
        `SELECT alias, message, created_at FROM \`${tableNameFor(room)}\` ORDER BY id DESC LIMIT 50`
      );
      socket.emit("history", rows.reverse());
      io.to(room).emit("message", {
        alias: "★ System",
        message: `${alias} just joined the room! ★`,
        created_at: new Date()
      });
    } catch {
      socket.emit("error_msg", "Error joining room");
    }
  });

  socket.on("typing", ({ room }) => {
      const alias = socket.user.username;
      if (!room || !alias) return;
      socket.to(room).emit("typing", { alias });
  });


  socket.on("message", async ({ text }) => {
    const alias = socket.user.username;
    try {
      if (!joinedRoom || !alias) return;
      if (typeof text !== "string") return;
      const cleanText = text.trim().slice(0, 1000);
      if (!cleanText) return;
      const table = tableNameFor(joinedRoom);
      await pool.query(
        `INSERT INTO \`${table}\` (alias, message) VALUES (?, ?)`,
        [alias, cleanText]
      );
      const payload = { alias, message: cleanText, created_at: new Date() };
      io.to(joinedRoom).emit("message", payload);
    } catch {
      socket.emit("error_msg", "Error sending message");
    }
  });

});

// --- Run ---
await ensureRoomTables();
server.listen(PORT, "0.0.0.0", () => {
  console.log(`HE-Chat listening on :${PORT} with rooms: ${ROOMS.join(", ")}`);
});
