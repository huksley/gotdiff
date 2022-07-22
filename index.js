import http from "http";
import path from "path";
import ejs from "ejs";
import fs from "fs";
import { logger } from "./logger.js";
import mime from "mime-types";
import { build } from "./build.js";
import { queryPackage } from "./query.js";

export const handler = async (req, res) => {
  ejs.rmWhitespace = true;
  ejs.openDelimiter = "{";
  ejs.closeDelimiter = "}";

  if (req.url != "/api/health" && req.url != "/c" && !req.url.endsWith(".svg")) {
    const requestMs = Date.now();
    logger.info("HTTP ==> " + req.url);
    const __end = res.end;
    res.end = (...args) => {
      logger.info("HTTP <== " + req.url, "<" + res.statusCode + ">", Date.now() - requestMs, "ms");
      __end.apply(res, args);
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
    const name = url.searchParams.get("package") || "next";
    logger.info("req", url.searchParams);
    const response = await queryPackage(name);
    res.end(JSON.stringify(response));
  } else {
    if (url.pathname === "/favicon.ico") {
      res.setHeader("Location", "/favicon.svg");
      res.writeHead(302);
      res.end("OK");
    } else if (url.pathname === "/public/index.jsx") {
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
      const file = path.resolve("public", url.pathname.substring(1));
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

if (import.meta.url == "file://" + process.argv[1]) {
  const server = http.createServer(handler);
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
  logger.info("Starting server on", port);
  server.listen(port);

  if (process.env.NODE_ENV === "development") {
    import("./livereload.js");
  }

  process.on("SIGINT", (signal) => {
    logger.info("Caught interrupt signal", signal);
    if (server) {
      server.close();
    }
    process.exit(1);
  });
}
