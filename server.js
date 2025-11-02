import http from "http";
import express from "express";
import { Server as SocketIOServer } from "socket.io";

import { getEnv, getRooms } from "./src/config.js";
import { INSTANCE_INFO, fetchInstanceMetadata } from "./src/metadata.js";
import { createPool, ensureRoomTables, tableNameFor } from "./src/db.js";
import { getIssuer, authMiddleware, verifyToken } from "./src/auth.js";
import { createApp } from "./src/app.js";
import { attachSocket } from "./src/socket.js";

async function main()
{
	// read environment and rooms
	const env = getEnv();
	const rooms = getRooms();
	const issuer = getIssuer(env.AWS_REGION, env.COGNITO_USER_POOL_ID);

	// express and socket.io
	const baseApp = express();
	const server = http.createServer(baseApp);
	const io = new SocketIOServer(server, { cors: { origin: "*" } });

	// metadata is best effort
	await fetchInstanceMetadata();

	// database
	const pool = createPool(env);
	await ensureRoomTables(pool, rooms);

	// mount app routes
	const app = createApp({ env, rooms, pool, tableNameFor, auth: authMiddleware(issuer), instanceInfo: INSTANCE_INFO });
	baseApp.use(app);

	// sockets
	await attachSocket(io, { rooms, pool, tableNameFor, issuer, verifyToken });

	// listen
	server.listen(env.PORT || 80, "0.0.0.0", () =>
	{
		console.log(`NetChat listening on :${env.PORT || 80} with rooms: ${rooms.join(", ")}`);
	});
}

await main();

