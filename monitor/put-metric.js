#!/usr/bin/env node
// push a simple custom cloudwatch metric for netchat instances
// metrics: memoryutilization (%) and uptimeseconds

import os from "os";
import AWS from "aws-sdk";

const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
AWS.config.update({ region: region });
const cw = new AWS.CloudWatch({ apiVersion: "2010-08-01" });

function memoryUtilization()
{
	const total = os.totalmem();
	const free = os.freemem();
	const used = total - free;
	return (used / total) * 100;
}

async function main()
{
	const mem = memoryUtilization();
	const uptime = os.uptime();

	const params = {
		Namespace: "NetChat",
		MetricData: [
			{
				MetricName: "MemoryUtilization",
				Unit: "Percent",
				Value: Number(mem.toFixed(2))
			},
			{
				MetricName: "UptimeSeconds",
				Unit: "Seconds",
				Value: Math.floor(uptime)
			}
		]
	};

	try
	{
		await cw.putMetricData(params).promise();
		console.log("[monitor] sent metrics: mem=" + mem.toFixed(2) + " uptime=" + uptime);
	}
	catch (e)
	{
		console.error("[monitor] failed to put metrics", e);
		process.exitCode = 1;
	}
}

main();

