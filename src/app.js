import express from "express";
import fs from "fs";
import path from "path";
import url from "url";

import { getProjectRoot } from "./config.js";

export function createApp(options)
{
	const { env, rooms, pool, tableNameFor, auth, instanceInfo } = options;
	const app = express();

	// Keep payloads small
	app.use(express.json({ limit: "64kb" }));

	const __filename = url.fileURLToPath(import.meta.url);
	const __dirname = path.dirname(__filename);
	const root = getProjectRoot();

	// Inject runtime config into the home page
	app.get(["/", "/index.html"], (_req, res) =>
	{
		const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
		const cfg = {
			rooms,
			region: env.AWS_REGION,
			userPoolId: env.COGNITO_USER_POOL_ID,
			clientId: env.COGNITO_CLIENT_ID,
			domain: env.COGNITO_DOMAIN,
			instanceId: instanceInfo.instanceId,
			az: instanceInfo.az,
			s3Bucket: env.S3_BUCKET
		};
		const injected = html.replace(
			"<head>",
			`<head><script>(function(){var cfg=${JSON.stringify(cfg)}; window.NETCHAT_CONFIG=cfg; window.HECHAT_CONFIG=cfg;})();</script>`
		);
		res.type("html").send(injected);
	});

	// Static files
	app.use(express.static(path.join(root, "public")));

	// Health check (auth)
	app.get("/health", auth, async (_req, res) =>
	{
		try
		{
			await pool.query("SELECT 1");
			res.json({ ok: true, rooms });
		}
		catch (e)
		{
			res.status(500).json({ ok: false, error: String(e) });
		}
	});

	// History (auth)
	app.get("/history/:room", auth, async (req, res) =>
	{
		const room = req.params.room || "";
		if (!rooms.includes(room))
		{
			return res.status(400).json({ error: "Unknown room" });
		}
		const limit = Math.max(1, Math.min(200, Number(req.query.limit || 50)));
		const offset = Math.max(0, Number(req.query.offset || 0));
		try
		{
			const [rows] = await pool.query(
				`SELECT alias, message, created_at FROM \`${tableNameFor(room)}\` ORDER BY id DESC LIMIT ? OFFSET ?`,
				[limit, offset]
			);
			res.json(rows.reverse());
		}
		catch
		{
			res.status(500).json({ error: "DB error" });
		}
	});

	// Who am I (for LB tests)
	app.get("/whoami", (_req, res) =>
	{
		res.json({ instanceId: instanceInfo.instanceId || null, az: instanceInfo.az || null, time: new Date().toISOString() });
	});

	// CPU burn (demo CPU based scaling)
	app.get("/burn", (req, res) =>
	{
		const ms = Math.max(0, Math.min(10000, Number(req.query.ms || 250))); 
		const end = Date.now() + ms;
		while (Date.now() < end)
		{
			Math.sqrt(Math.random());
		}
		res.json({ ok: true, burnedMs: ms, at: new Date().toISOString() });
	});

	return app;
}

