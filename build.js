import fs from "fs";
import { exec } from "child_process";
import { logger } from "./logger.js";

export const build = () =>
  new Promise((resolve, reject) => {
    const st = Date.now();
    logger.info("Building client side...");
    exec(
      `./node_modules/.bin/esbuild ./public/index.jsx --bundle \
                  --define:process.env.LOG_VERBOSE=\\"${process.env.LOG_VERBOSE}\\" \
                  --define:process.env.NODE_ENV=\\"${process.env.NODE_ENV || "development"}\\" \
                  --sourcemap ${process.env.NODE_ENV === "production" ? "--minify" : ""}\
                  --analyze \
                  --target=chrome100,firefox100,safari15`,
      { maxBuffer: 16 * 1024 * 1024, timeout: 10000 },
      (err, stdout, stderr) => {
        if (err) {
          logger.warn("Compilation failed", err?.code, stderr);
          reject(new Error(stderr));
        } else {
          logger.info("Compiled in", Date.now() - st, "ms, size", stdout.length, "bytes");
          logger.info(stderr);
          resolve(stdout);
        }
      }
    );
  });

if (import.meta.url === "file://" + process.argv[1] + ".js") {
  fs.mkdirSync(".build", { recursive: true });
  build()
    .then((output) => {
      fs.writeFileSync(".build/index.js", output);
    })
    .catch((e) => {
      logger.info("Error", e?.message || String(e));
      process.exit(1);
    });
}
