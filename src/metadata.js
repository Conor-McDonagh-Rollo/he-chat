import fetch from "node-fetch";

export let INSTANCE_INFO = { instanceId: "", az: "" };

export async function fetchInstanceMetadata()
{
	try
	{
		const base = "http://169.254.169.254/latest";
		const withTimeout = async (urlStr, init, ms = 1000) =>
		{
			const ac = new AbortController();
			const t = setTimeout(() => ac.abort(), ms);
			try
			{
				return await fetch(urlStr, { ...(init || {}), signal: ac.signal });
			}
			finally
			{
				clearTimeout(t);
			}
		};
		const tokRes = await withTimeout(`${base}/api/token`, {
			method: "PUT",
			headers: { "X-aws-ec2-metadata-token-ttl-seconds": "21600" }
		});
		const token = await tokRes.text();
		const get = async (p) => (await withTimeout(`${base}/meta-data/${p}`, { headers: { "X-aws-ec2-metadata-token": token } })).text();
		const instanceId = await get("instance-id");
		const az = await get("placement/availability-zone");
		INSTANCE_INFO = { instanceId, az };
	}
	catch
	{
		// ignore if not on EC2
	}
}

