const nano = require("nano");
const http = require("http");
const https = require("https");
const path = require("path");
const { cache } = require("./cache");
const compareVersions = require("compare-versions");
const ejs = require("ejs");
ejs.rmWhitespace = true;
ejs.openDelimiter = "{";
ejs.closeDelimiter = "}";
const fs = require("fs");
const { logger } = require("./logger");
const exec = require("child_process").exec;
const mime = require("mime-types");
const semverInc = require("semver/functions/inc");

const request = async (url, { method, body, headers }) => {
  const payload = body ? JSON.stringify(body) : undefined;

  logger.info("HTTP", method || "GET", url, payload ? "payload " + payload.length + " bytes" : "");

  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        timeout: 10000,
        method: method || "GET",
        headers: {
          "User-Agent": "Mozilla 55 (like IE 6.0; created by huksley)",
          ...(payload
            ? {
                "Content-Type": "application/json",
                "Content-Length": payload.length,
              }
            : {}),
          ...headers,
        },
      },
      (res) => {
        logger.verbose("Got response", res.statusCode, res.statusMessage);

        // Collect body
        let data = "";
        res.on("data", function (chunk) {
          data += chunk;
        });

        res.on("end", function () {
          if (
            res.headers["content-type"] === "application/json" ||
            res.headers["content-type"].startsWith("application/json;")
          ) {
            data = JSON.parse(data);
          }
          res.body = data;
          if (res.statusCode && res.statusCode >= 200 && res.statusCode <= 399) {
            resolve(res);
          } else {
            logger.verbose("Reject", res.statusCode, data);
            reject(res);
          }
        });
      }
    );
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
};

const server = http.createServer(async (req, res) => {
  if (req.url != "/api/health" && req.url != "/_log") {
    const requestMs = Date.now();
    logger.info("HTTP ==> " + req.url);
    __end = res.end;
    res.end = (...arguments) => {
      logger.info("HTTP <== " + req.url, "<" + res.statusCode + ">", Date.now() - requestMs, "ms");
      __end.apply(res, arguments);
    };
  }

  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/") {
    res.setHeader("Content-Type", "text/html");
    res.writeHead(200);
    res.end(ejs.render(fs.readFileSync("./views/index.ejs", { encoding: "utf-8" })));
  } else if (url.pathname === "/json") {
    res.setHeader("Content-Type", "application/json");
    res.writeHead(200);
    const st = Date.now();
    const db = nano("https://replicate.npmjs.com/registry");
    const name = url.searchParams.get("package") || "next";
    logger.info("req", url.searchParams);
    packages = await cache.getset(
      name + "-package",
      async () => {
        logger.info("Query NPMJS", name);
        return await db.get(name);
      },
      24 * 3600 * 1000
    );
    logger.info("Query NPMDB done in", Date.now() - st, "ms");

    const allVersions = Object.keys(packages.versions)
      .filter(
        (v) =>
          !v.includes("canary") &&
          !v.includes("beta") &&
          !v.includes("alpha") &&
          !v.includes("-next-") &&
          !v.includes("-rc.")
      )
      .sort(compareVersions);

    const latest = allVersions[allVersions.length - 1];
    const older = allVersions[allVersions.length - 2];

    const olderPackages = Object.keys(packages.versions)
      .filter((v) => v === older)
      .map((ver) => ({
        ...packages.versions[older],
      }));
    const olderPackage = olderPackages[0];
    const latestPackages = Object.keys(packages.versions)
      .filter((v) => v === latest)
      .map((ver) => ({
        ...packages.versions[ver],
      }));
    const latestPackage = latestPackages[0];

    let repoUrl = olderPackage?.repository?.url;
    if (repoUrl?.startsWith("git+https")) {
      repoUrl = repoUrl.replace("git+https", "https");
    }
    if (repoUrl?.startsWith("git://")) {
      repoUrl = repoUrl.replace("git://", "https://");
    }
    if (repoUrl?.endsWith(".git")) {
      repoUrl = repoUrl.replace(/\.git$/, "");
    }

    let org = undefined;
    let repository = undefined;

    const repo = repoUrl ? new URL(repoUrl) : undefined;
    if (repo?.hostname === "github.com") {
      org = repo.pathname.split("/")[1];
      repository = repo.pathname.split("/")[2];
    }

    logger.info("Fetching releases for", repoUrl);
    const releases = await cache.getset(
      name + "-releases3",
      async () => {
        if (!org || !repository) {
          return [];
        }
        try {
          const r = await request(`https://api.github.com/repos/${org}/${repository}/releases?per_page=100`, {
            headers: {
              Accept: "application/vnd.github+json",
              Authorization: "token " + process.env.GITHUB_TOKEN,
            },
          });
          logger.info(
            "Got releases",
            r.body.map((c) => c.name + ", " + c.tag_name)
          );
          return r.body;
        } catch (e) {
          logger.warn("Failed to get releases", e);
          return [];
        }
      },
      24 * 3600 * 1000
    );

    const matchRelease = (version) => (r) =>
      r.name === version ||
      r.name === "v" + version ||
      r.tag_name === version ||
      r.tag_name === "v" + version ||
      r.tag_name === name + "@" + version ||
      r.tag_name === name + "@v" + version;

    logger.info("releases", releases.length);
    latestRelease = releases.find(matchRelease(latest));
    const latestVersions = allVersions.length > 15 ? allVersions.slice(allVersions.length - 15) : allVersions;

    res.end(
      JSON.stringify({
        allVersions,
        latestVersions,
        latestPackage,
        olderPackage,
        releases: releases,
        latestRelease,
        older,
        latest,
        name: packages.name || name,
        url: repoUrl,
        npmUrl: "https://npmjs.com/package/" + name,
        packages: latestVersions.map((v) => packages.versions[v]),
      })
    );
  } else {
    if (url.pathname === "/favicon.ico") {
      res.setHeader("Location", "/favicon.svg");
      res.writeHead(302);
      res.end("OK");
    } else if (url.pathname === "/public/index.jsx") {
      logger.info("Building bundle");
      const st = Date.now();
      exec(
        `esbuild ./public/index.jsx --bundle \
            --define:process.env.LOG_VERBOSE=\\"${process.env.LOG_VERBOSE}\\" \
            --define:process.env.NODE_ENV=\\"${process.env.NODE_ENV || "development"}\\" \
            --sourcemap \
            --analyze \
            --target=chrome100,firefox100,safari15`,
        { maxBuffer: 16 * 1024 * 1024, timeout: 10000 },
        (err, stdout, stderr) => {
          if (err) {
            logger.warn("Compilation failed", err?.code, stderr);
          } else {
            logger.info("Compiled in", Date.now() - st, "ms, size", stdout.length, "bytes");
            res.setHeader("Content-Type", "application/javascript");
            res.writeHead(200);
            res.end(stdout);
            logger.info(stderr);
          }
        }
      );
    } else {
      const file = path.resolve(__dirname, "public", url.pathname.substring(1));
      let stat = undefined;
      try {
        stat = fs.statSync(file);
      } catch (e) {
        // Ignore
      }
      if (stat) {
        logger.info("Sending", file);
        res.setHeader("Content-Type", mime.lookup(file) || "application/octet-stream");
        res.writeHead(200);
        res.end(fs.readFileSync(file, { encoding: "utf-8" }));
      } else {
        logger.info("Not found", file);
        res.setHeader("Content-Type", "text/html");
        res.writeHead(404);
        res.end("Not found");
      }
    }
  }
});

server.listen(8080);

process.on("beforeExit", (code) => {
  logger.info("NodeJS exiting", code);
});

process.on("SIGINT", (signal) => {
  logger.info("Caught interrupt signal", signal);
  server.close();
  process.exit(1);
});
