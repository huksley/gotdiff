import { logger } from "./logger.js";
import { exec } from "child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { resolve } from "path";
import { cacheInBucket } from "./cacheInBucket.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Keep-Alive,User-Agent,Content-Type",
  "Access-Control-Max-Age": "1728000",
};

const __modules = process.env.LAMBDA_TASK_ROOT
  ? resolve(process.env.LAMBDA_TASK_ROOT, "node_modules")
  : process.env.IS_LOCAL
  ? resolve("./../node_modules")
  : resolve("./node_modules");

const fetchPackage = async (name, version) => {
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
        timeout: 120000,
        maxBuffer: 16 * 1024 * 1024,
        env: {
          HOME: "/tmp",
          PREFIX: "/tmp",
          PATH: process.env.PATH,
        },
      },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error("Error " + String(err)));
        }

        if (stderr) {
          logger.info(stderr);
        }
        resolve(stdout);
      }
    );
  });

  const size = await new Promise((resolve, reject) => {
    exec(
      "du -s node_modules",
      {
        cwd: dir,
        timeout: 5000,
        env: {
          HOME: "/tmp",
          PREFIX: "/tmp",
          PATH: process.env.PATH,
        },
      },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error("Error " + String(err)));
        }
        if (stderr) {
          logger.info(stderr);
        }
        resolve(parseInt(stdout?.split("\t")[0], 10) * 1024);
      }
    );
  });

  let result = undefined;
  if (existsSync(dir + "/package-lock.json")) {
    const lock = readFileSync(dir + "/package-lock.json", { encoding: "utf-8" });
    result = {
      __size: size,
      ...JSON.parse(lock),
    };
  } else {
    throw new Error("Unable to find package-lock.json");
  }

  rmSync(dir, { recursive: true, force: true });
  return result;
};

export const handler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  logger.info("Got event", JSON.stringify(event, null, 2));

  if (!event?.requestContext?.http) {
    return new Error("Unknown event");
  }

  try {
    if (
      !process.env.QUERY_TOKEN ||
      !event?.headers ||
      (event?.headers["x-auth-token"] !== process.env.QUERY_TOKEN &&
        event?.queryStringParameters?.token !== process.env.QUERY_TOKEN)
    ) {
      return {
        statusCode: 403,
        headers: {
          "Content-Type": "application/json",
          ...cors,
        },
        body: JSON.stringify({ status: "Error", message: "Forbidden", error: true }),
      };
    }

    let name = event?.queryStringParameters?.name || "swr";
    let version = event?.queryStringParameters?.version || "latest";
    let response = undefined;

    logger.info("Fetching", name, version);
    if (version === "latest") {
      // Never cache "latest"
      response = JSON.stringify(await fetchPackage(name, version));
    } else {
      response = await cacheInBucket(
        async () => JSON.stringify(await fetchPackage(name, version)),
        process.env.S3_BUCKET,
        (process.env.S3_PREFIX || "cache") + "/" + new Date().getFullYear() + "/" + name + "-" + version + ".json",
        "application/json"
      );
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        ...cors,
      },
      body: Buffer.from(response).toString("utf-8"),
    };
  } catch (e) {
    logger.warn("Failed", e);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        ...cors,
      },
      body: { status: "Error", message: "Internal server error", error: true },
    };
  }
};

if (!process.env.AWS_EXECUTION_ENV && import.meta.url == "file://" + process.argv[1] + ".js") {
  process.env.QUERY_TOKEN = "123";
  handler(
    {
      headers: {
        "x-auth-token": "123",
      },
      queryStringParameters: {
        name: "swr",
        version: "1.2.0",
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
