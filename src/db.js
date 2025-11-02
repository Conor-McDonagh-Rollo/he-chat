import mysql from "mysql2/promise";

export function createPool(env)
{
	return mysql.createPool({
		host: env.DB_HOST,
		port: env.DB_PORT,
		user: env.DB_USER,
		password: env.DB_PASSWORD,
		database: env.DB_NAME,
		connectionLimit: 10,
		enableKeepAlive: true,
		keepAliveInitialDelay: 0
	});
}

export function sanitizeRoom(name)
{
	return name.toLowerCase().replace(/[^a-z0-9_]/g, "_");
}

export function tableNameFor(room)
{
	return `room_${sanitizeRoom(room)}`;
}

export async function ensureRoomTables(pool, rooms)
{
	for (const room of rooms)
	{
		const table = tableNameFor(room);
		await pool.query(
			`CREATE TABLE IF NOT EXISTS \`${table}\` (
				id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
				alias VARCHAR(40) NOT NULL,
				message TEXT NOT NULL,
				created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
				PRIMARY KEY (id),
				INDEX (created_at)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`
		);
	}
}

