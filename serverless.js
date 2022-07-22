import { logger } from "./logger.js";
import { exec } from "child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { resolve } from "path";

const __modules = process.env.LAMBDA_TASK_ROOT
  ? resolve(process.env.LAMBDA_TASK_ROOT, "node_modules")
  : process.env.IS_LOCAL
  ? resolve("./../node_modules")
  : resolve("./node_modules");

export const handler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  logger.info("Got event", JSON.stringify(event, null, 2));

  if (!process.env.QUERY_TOKEN || !event?.headers || event?.headers["x-auth-token"] !== process.env.QUERY_TOKEN) {
    return {
      statusCode: 403,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Keep-Alive,User-Agent,Content-Type",
        "Access-Control-Max-Age": "1728000",
      },
      body: JSON.stringify({ status: "Error", message: "Forbidden" }),
    };
  }

  let name = event?.queryStringParameters?.name || "swr";
  let version = event?.queryStringParameters?.version || "latest";
  const dir = "/tmp/t" + Date.now();

  if (!existsSync(dir)) {
    if (!mkdirSync(dir, { recursive: true })) {
      throw new Error("Cannot make dir: " + dir);
    }
  }

  writeFileSync(dir + "/package.json", JSON.stringify({}));

  await new Promise((resolve, reject) => {
    exec(
      "npm install " + name + "@" + version + " --ignore-scripts --omit peer --no-audit",
      {
        cwd: dir,
        timeout: 30000,
        maxBuffer: 16 * 1024 * 1024,
        env: {
          HOME: dir,
          PREFIX: dir,
          PATH: process.env.PATH,
        },
      },
      (err, stdout, stderr) => {
        if (err) {
          resolve(new Error("Error " + String(err)));
        }

        logger.info(stdout);
        resolve(stdout);
      }
    );
  });

  const size = await new Promise((resolve, reject) => {
    exec(
      "du -s node_modules",
      {
        cwd: dir,
        timeout: 30000,
        env: {
          HOME: dir,
          PREFIX: dir,
          PATH: process.env.PATH,
        },
      },
      (err, stdout, stderr) => {
        if (err) {
          resolve(new Error("Error " + String(err)));
        }
        resolve(parseInt(stdout?.split("\t")[0], 10) * 1024);
      }
    );
  });

  let result = {};
  if (existsSync(dir + "/package-lock.json")) {
    const lock = readFileSync(dir + "/package-lock.json", { encoding: "utf-8" });
    result = {
      __size: size,
      ...JSON.parse(lock),
    };
  }

  rmSync(dir, { recursive: true, force: true });

  if (event?.requestContext?.http) {
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Keep-Alive,User-Agent,Content-Type",
        "Access-Control-Max-Age": "1728000",
      },
      body: JSON.stringify(result, null, 2),
    };
  }

  return new Error("Unknown event");
};

if (!process.env.AWS_EXECUTION_ENV && import.meta.url == "file://" + process.argv[1] + ".js") {
  process.env.QUERY_TOKEN = "123";
  handler(
    {
      headers: {
        "x-auth-token": "123",
      },
      requestContext: {
        http: {},
      },
    },
    {}
  ).then((r) => {
    logger.info("Result", r);
  });
}
