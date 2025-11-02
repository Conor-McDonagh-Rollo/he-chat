import dotenv from "dotenv";
import path from "path";
import url from "url";

dotenv.config();

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

export function getEnv()
{
	return {
		PORT: Number(process.env.PORT || 80),
		AWS_REGION: process.env.AWS_REGION || "us-east-1",
		COGNITO_USER_POOL_ID: process.env.COGNITO_USER_POOL_ID || "",
		COGNITO_CLIENT_ID: process.env.COGNITO_CLIENT_ID || "",
		COGNITO_DOMAIN: process.env.COGNITO_DOMAIN || "",
		S3_BUCKET: process.env.S3_BUCKET || "",
		DB_HOST: process.env.DB_HOST,
		DB_PORT: Number(process.env.DB_PORT || 3306),
		DB_USER: process.env.DB_USER,
		DB_PASSWORD: process.env.DB_PASSWORD,
		DB_NAME: process.env.DB_NAME
	};
}

export function getRooms()
{
	const raw = process.env.ROOMS || "lobby,tech,gaming";
	return raw.split(",").map(s => s.trim()).filter(Boolean);
}

export function getProjectRoot()
{
	return projectRoot;
}

