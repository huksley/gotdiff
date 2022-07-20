process.env.NODE_ENV = "production";
process.env.AWS_EXECUTION_ENV = "nodejs";

const fs = require("fs");
require("dotenv/config");
const { handler } = require("./index.js");

if (!fs.existsSync("greenlock.d/config.json")) {
  fs.mkdirSync("greenlock.d", { recursive: true });
  fs.writeFileSync(
    "greenlock.d/config.json",
    JSON.stringify(
      {
        defaults: {},
        sites: [{ subject: "gotdiff.com", altnames: ["gotdiff.com", "www.gotdiff.com"] }],
      },
      null,
      2
    )
  );
}

require("greenlock-express")
  .init({
    packageRoot: __dirname,
    configDir: "./greenlock.d",
    maintainerEmail: process.env.EMAIL || "ruslanfg@protonmail.com",
    cluster: false,
  })
  // Serves on 80 and 443
  // Get's SSL certificates magically!
  .serve(handler);
