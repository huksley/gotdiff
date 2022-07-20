const https = require("https");
const { logger } = require("./logger");

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
            const err = new Error("HTTP response " + url + " " + res.statusCode + " " + JSON.stringify(data));
            err.res = res;
            err.req = req;
            reject(err);
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
exports.request = request;