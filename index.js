const nano = require("nano");
const http = require("http");
const path = require("path");
const { cache } = require("./cache");
const compareVersions = require("compare-versions");
const ejs = require("ejs");
ejs.rmWhitespace = true;
ejs.openDelimiter = "{";
ejs.closeDelimiter = "}";
const fs = require("fs");
const { logger } = require("./logger");
const mime = require("mime-types");
const { build } = require("./build");
const { request } = require("./request");
const { exec } = require("child_process");

const handler = async (req, res) => {
  if (req.url != "/api/health" && req.url != "/c" && !req.url.endsWith(".svg")) {
    const requestMs = Date.now();
    logger.info("HTTP ==> " + req.url);
    __end = res.end;
    res.end = (...arguments) => {
      logger.info("HTTP <== " + req.url, "<" + res.statusCode + ">", Date.now() - requestMs, "ms");
      __end.apply(res, arguments);
    };
  }

  if (req.method === "POST" || req.method === "PATCH") {
    const buffers = [];
    for await (const chunk of req) {
      buffers.push(chunk);
    }

    let data = Buffer.concat(buffers).toString();
    if (req.headers["content-type"] === "application/json") {
      data = JSON.parse(data);
    }
    logger.verbose("Incoming body", data.length, "byte");
    req.body = data;
  }

  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/") {
    res.setHeader("Content-Type", "text/html");
    res.writeHead(200);
    res.end(
      ejs.render(fs.readFileSync("./views/index.ejs", { encoding: "utf-8" }), {
        livereload:
          process.env.NODE_ENV === "production"
            ? ""
            : '<script async defer src="http://localhost:35729/livereload.js"></script>',
      })
    );
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
        try {
          return await db.get(name);
        } catch (e) {
          logger.warn("Error fetching", name, e);
          return {};
        }
      },
      24 * 3600 * 1000
    );
    logger.info("Query NPMDB done in", Date.now() - st, "ms");

    const allVersions = Object.keys(packages.versions || [])
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

    const olderPackages = Object.keys(packages.versions || [])
      .filter((v) => v === older)
      .map((ver) => ({
        ...packages.versions[older],
      }));
    const olderPackage = olderPackages[0];
    const latestPackages = Object.keys(packages.versions || [])
      .filter((v) => v === latest)
      .map((ver) => ({
        ...packages.versions[ver],
      }));
    const latestPackage = latestPackages[0];

    let repoUrl = olderPackage?.repository?.url;
    if (repoUrl?.startsWith("git+https")) {
      repoUrl = repoUrl.replace("git+https", "https");
    }
    if (repoUrl?.startsWith("git+ssh://")) {
      repoUrl = repoUrl.replace("git+ssh://", "https://");
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

    logger.info("Fetching tree for", name, latest);
    const st2 = Date.now();
    const tree = await cache.getset(
      name + "_package_lock6_" + latest,
      async () => {
        try {
          const json = await new Promise((resolve, reject) => {
            exec(
              "./tree.sh " + name + "@" + latest,
              { maxBuffer: 16 * 1024 * 1024, timeout: 10000 },
              (err, stdout, stderr) => {
                if (err) {
                  logger.warn("Fetch tree failed", name, latest, err?.code, stderr);
                  reject(new Error("Fetch failed " + name + "@" + latest));
                } else {
                  logger.info("Fetched tree", name, stderr);
                  resolve(stdout);
                }
              }
            );
          });

          return json;
        } catch (e) {
          logger.warn("Fetch failed", e);
          return null;
        }
      },
      24 * 3600 * 1000
    );

    logger.info("Fetched tree in", Date.now() - st2, "ms, ", tree?.length, "bytes");
    const lock = tree ? JSON.parse(tree) : undefined;

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
        footprint: lock?.__size,
        dependencies: Object.keys(lock?.packages)
          .filter((name) => name.startsWith("node_modules/"))
          .filter((name) => {
            const p = lock?.packages[name];
            return !p.peer;
          }),
      })
    );
  } else {
    if (url.pathname === "/favicon.ico") {
      res.setHeader("Location", "/favicon.svg");
      res.writeHead(302);
      res.end("OK");
    } else if (url.pathname === "/public/index.jsx") {
      logger.info(process.env.NODE_ENV);
      if (process.env.NODE_ENV === "production") {
        res.setHeader("Content-Type", "application/javascript");
        res.writeHead(200);
        logger.verbose("Sending static build .build/index.js");
        res.end(fs.readFileSync(".build/index.js", { encoding: "utf-8" }));
      } else {
        build()
          .then((output) => {
            res.setHeader("Content-Type", "application/javascript");
            res.writeHead(200);
            res.end(output);
          })
          .catch((e) => {
            logger.warn("Failed to compile", e?.message || String(e));
            res.setHeader("Content-Type", "text/plain");
            res.writeHead(500);
            res.end("Internal server error");
          });
      }
    } else {
      const file = path.resolve(__dirname, "public", url.pathname.substring(1));
      let stat = undefined;
      try {
        stat = fs.statSync(file);
      } catch (e) {
        // Ignore
      }
      if (stat) {
        logger.verbose("Sending", file);
        res.setHeader("Content-Type", mime.lookup(file) || "application/octet-stream");
        res.writeHead(200);
        res.end(fs.readFileSync(file, { encoding: "utf-8" }));
      } else {
        logger.warn("Not found", file);
        res.setHeader("Content-Type", "text/html");
        res.writeHead(404);
        res.end("Not found");
      }
    }
  }
};

let server = undefined;

if (!process.env.AWS_EXECUTION_ENV) {
  server = http.createServer(handler);
  server.listen(process.env.PORT ? parseInt(process.env.PORT, 10) : 8080);
}

process.on("beforeExit", (code) => {
  logger.info("NodeJS exiting", code);
});

process.on("SIGINT", (signal) => {
  logger.info("Caught interrupt signal", signal);
  if (server) {
    server.close();
  }
  process.exit(1);
});

module.exports = {
  server,
  handler,
};
