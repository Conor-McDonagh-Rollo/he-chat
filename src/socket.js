import { createAdapter as createRedisAdapter } from "@socket.io/redis-adapter";
import { createClient as createRedisClient } from "redis";

export async function attachSocket(io, options)
{
	const { rooms, pool, tableNameFor, issuer, verifyToken } = options;

	// Try to enable Redis adapter for cross instance broadcast
	try
	{
		const ep = process.env.REDIS_ENDPOINT;
		if (ep)
		{
			const url = ep.startsWith("redis://") || ep.startsWith("rediss://") ? ep : `redis://${ep}:6379`;
			const pubClient = createRedisClient({ url });
			const subClient = pubClient.duplicate();
			await pubClient.connect();
			await subClient.connect();
			io.adapter(createRedisAdapter(pubClient, subClient));
			console.log("Socket.IO Redis adapter enabled:", url);
		}
	}
	catch (e)
	{
		console.error("Failed to enable Redis adapter:", e);
	}

	// Auth for sockets
	io.use(async (socket, next) =>
	{
		try
		{
			const token = socket.handshake.auth && socket.handshake.auth.token
				? socket.handshake.auth.token
				: String(socket.handshake.headers && socket.handshake.headers.authorization || "").replace(/^Bearer\s+/i, "");
			const payload = await verifyToken(token, issuer);
			socket.user = {
				sub: payload.sub,
				username: payload["cognito:username"] || payload.username || payload.email || "user",
				email: payload.email || null
			};
			return next();
		}
		catch
		{
			return next(new Error("Unauthorized"));
		}
	});

	io.on("connection", (socket) =>
	{
		let joinedRoom = null;

		socket.emit("auth_ok", { username: socket.user.username });

		socket.on("join", async ({ room }) =>
		{
			const alias = socket.user.username;
			try
			{
				if (typeof room !== "string")
				{
					return;
				}
				room = room.trim();
				if (!rooms.includes(room))
				{
					return;
				}
				if (joinedRoom)
				{
					socket.leave(joinedRoom);
				}
				joinedRoom = room;
				socket.join(room);
				socket.emit("joined", { room, alias });
				const [rows] = await pool.query(`SELECT alias, message, created_at FROM \`${tableNameFor(room)}\` ORDER BY id DESC LIMIT 50`);
				socket.emit("history", rows.reverse());
				io.to(room).emit("message", { alias: "★ System", message: `${alias} just joined the room! ★`, created_at: new Date() });
			}
			catch
			{
				socket.emit("error_msg", "Error joining room");
			}
		});

		socket.on("typing", ({ room }) =>
		{
			const alias = socket.user.username;
			if (!room || !alias)
			{
				return;
			}
			socket.to(room).emit("typing", { alias });
		});

		socket.on("message", async ({ text }) =>
		{
			const alias = socket.user.username;
			try
			{
				if (!joinedRoom || !alias)
				{
					return;
				}
				if (typeof text !== "string")
				{
					return;
				}
				const cleanText = text.trim().slice(0, 1000);
				if (!cleanText)
				{
					return;
				}
				const table = tableNameFor(joinedRoom);
				await pool.query(`INSERT INTO \`${table}\` (alias, message) VALUES (?, ?)`, [alias, cleanText]);
				const payload = { alias, message: cleanText, created_at: new Date() };
				io.to(joinedRoom).emit("message", payload);
			}
			catch
			{
				socket.emit("error_msg", "Error sending message");
			}
		});
	});
}

