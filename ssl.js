import fs from "fs";
import "dotenv/config";
import greenlock from "greenlock-express";
import { handler } from "./index.js";

if (!fs.existsSync("greenlock.d/config.json")) {
  fs.mkdirSync("greenlock.d", { recursive: true });
  fs.writeFileSync(
    "greenlock.d/config.json",
    JSON.stringify(
      {
        defaults: {},
        sites: [{ subject: process.env.DOMAIN, altnames: [process.env.DOMAIN, "www." + process.env.DOMAIN] }],
      },
      null,
      2
    )
  );
}

process.env.NODE_ENV = "production";

greenlock
  .init({
    packageRoot: ".",
    configDir: "./greenlock.d",
    maintainerEmail: process.env.EMAIL,
    cluster: false,
  })
  // Serves on 80 and 443
  // Get's SSL certificates magically!
  .serve(handler);
