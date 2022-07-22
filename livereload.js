import livereload from "livereload";
import { logger } from "./logger.js";

logger.info("Starting livereload server");

const server = livereload.createServer({
  extraExts: ["ejs", "jsx"],
});

server.watch(["./public", "./views"]);

server.server.once("connection", () => {
  setTimeout(() => {
    logger.info("Reloading page");
    server.refresh("/");
  }, 100);
});
