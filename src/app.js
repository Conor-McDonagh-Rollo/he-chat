import express from "express";
import fs from "fs";
import path from "path";
import url from "url";
import crypto from "crypto";

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
	app.get("/burn", async (req, res) =>
	{
		// use pbkdf2 to push cpu via libuv threadpool
		const conc = Math.max(1, Math.min(32, Number(req.query.c || req.query.concurrent || 8)));
		const iters = Math.max(10000, Math.min(2000000, Number(req.query.iters || 200000)));
		const started = Date.now();
		const jobs = [];
		for (let i = 0; i < conc; i++)
		{
			jobs.push(new Promise((resolve, reject) =>
			{
				crypto.pbkdf2("netchat", "salt" + i, iters, 64, "sha512", (err) =>
				{
					if (err) return reject(err);
					resolve();
				});
			}));
		}
		await Promise.all(jobs);
		const elapsed = Date.now() - started;
		res.json({ ok: true, concurrent: conc, iterations: iters, ms: elapsed, at: new Date().toISOString() });
	});

	// Memory allocation test (use with care)
	app.get("/mem", (req, res) =>
	{
		const mb = Math.max(1, Math.min(1024, Number(req.query.mb || 50)));
		const sec = Math.max(1, Math.min(300, Number(req.query.sec || 30)));
		const buf = Buffer.alloc(mb * 1024 * 1024, 0xaa);
		globalThis.__NETCHAT_MEM = globalThis.__NETCHAT_MEM || [];
		globalThis.__NETCHAT_MEM.push(buf);
		setTimeout(() => { globalThis.__NETCHAT_MEM = []; }, sec * 1000);
		res.json({ ok: true, allocatedMB: mb, holdSeconds: sec, at: new Date().toISOString() });
	});

	return app;
}
