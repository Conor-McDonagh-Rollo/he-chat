import jwt from "jsonwebtoken";
import jwkToPem from "jwk-to-pem";
import fetch from "node-fetch";

let JWKS_CACHE = null;

export function getIssuer(region, userPoolId)
{
	return `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
}

async function getJwks(issuer)
{
	if (JWKS_CACHE)
	{
		return JWKS_CACHE;
	}
	const res = await fetch(`${issuer}/.well-known/jwks.json`);
	JWKS_CACHE = await res.json();
	return JWKS_CACHE;
}

export async function verifyToken(token, issuer)
{
	if (!token)
	{
		throw new Error("Missing token");
	}
	const decoded = jwt.decode(token, { complete: true });
	if (!decoded || !decoded.header || !decoded.header.kid)
	{
		throw new Error("Invalid token header");
	}
	const jwks = await getJwks(issuer);
	const jwk = jwks.keys.find(k => k.kid === decoded.header.kid);
	if (!jwk)
	{
		throw new Error("Unknown key id");
	}
	const pem = jwkToPem(jwk);
	return jwt.verify(token, pem, { issuer });
}

export function authMiddleware(issuer)
{
	return function(req, res, next)
	{
		try
		{
			const header = req.headers.authorization || "";
			const token = header.replace(/^Bearer\s+/i, "");
			verifyToken(token, issuer).then(payload =>
			{
				req.user = payload;
				next();
			}).catch(() => res.status(401).json({ error: "Unauthorized" }));
		}
		catch
		{
			res.status(401).json({ error: "Unauthorized" });
		}
	};
}

