const nodeRedis = require("ioredis");
const logger = console;
logger.isVerbose = false;
logger.verbose = logger.info;

const redis = process.env.REDIS_URL
  ? nodeRedis.createClient({
      url: process.env.REDIS_TOKEN
        ? process.env.REDIS_URL.replace("$REDIS_TOKEN", process.env.REDIS_TOKEN)
        : process.env.REDIS_URL,
    })
  : null;

if (process.env.REDIS_URL) {
  logger.info("Connecting to Redis", process.env.REDIS_URL);
}

const CacheUtil = {
  prefix: process.env.CACHE_PREFIX || "",
  logThreshold: 100,
  timeoutMs: 3 * 3600 * 1000, // 3 hours
  replacer: (key, value) => {
    return value;
  },
  reviver: (key, value) => {
    return value;
  },
  unjson: (str) => {
    return JSON.parse(str, CacheUtil.reviver);
  },
  json: (data) => {
    return JSON.stringify(data, CacheUtil.replacer);
  },
};

const Cache = redis
  ? {
      get: (key) =>
        new Promise(async (resolve, reject) => {
          const started = Date.now();
          redis.get(CacheUtil.prefix + key, async (err, reply) => {
            if (err) {
              if (logger.isVerbose) {
                logger.verbose("Failed to get", "error", err);
              }
              reject(err);
              return;
            }

            if (reply != null) {
              const data = CacheUtil.unjson(reply);
              if (Date.now() - started > CacheUtil.logThreshold) {
                logger.info("Cache get", CacheUtil.prefix + key, "took", Date.now() - started, "ms");
              }
              if (logger.isVerbose) logger.verbose("Returning cached", key);
              resolve(data);
            } else {
              if (logger.isVerbose) logger.verbose("Cache not found", key);
              resolve(null);
            }
          });
        }),
      getset: (key, def, timeoutMs) =>
        new Promise(async (resolve, reject) => {
          const started = Date.now();
          redis.get(CacheUtil.prefix + key, async (err, reply) => {
            if (err) {
              if (logger.isVerbose) {
                logger.verbose("Failed to get", CacheUtil.prefix + key, "error", err);
              }

              reject(err);
              return;
            }

            if (reply === null) {
              if (logger.isVerbose) logger.verbose("Cache not found", key);
              const value = await def();

              const started2 = Date.now();
              Cache.set(key, value, timeoutMs)
                .then((_) => {
                  if (Date.now() - started2 > CacheUtil.logThreshold) {
                    logger.info("Cache set", CacheUtil.prefix + key, "took", Date.now() - started, "ms");
                  }
                  resolve(value);
                })
                .catch(reject);
            } else {
              const data = CacheUtil.unjson(reply);
              if (Date.now() - started > CacheUtil.logThreshold) {
                logger.info("Cache get", CacheUtil.prefix + key, "took", Date.now() - started, "ms");
              }
              if (logger.isVerbose) logger.verbose("Returning cached", key);
              resolve(data);
            }
          });
        }),
      set: (key, data, timeoutMs) =>
        new Promise((resolve, reject) => {
          if (data === null || data === undefined) {
            if (logger.isVerbose) logger.verbose("Removing cached value for " + data, key);
            redis.del(key, (err, reply) => {
              if (err) {
                if (logger.isVerbose) {
                  logger.verbose("Failed to del", CacheUtil.prefix + key, "error", err);
                }
                reject(err);
                return;
              }

              resolve(reply > 0);
            });
            resolve(false);
            return;
          }

          if (logger.isVerbose) logger.verbose("Caching", key);
          if (data != null) {
            const started = Date.now();
            redis.set(
              CacheUtil.prefix + key,
              CacheUtil.json(data),
              "PX",
              timeoutMs ? timeoutMs : CacheUtil.timeoutMs,
              (err, reply) => {
                if (err) {
                  if (logger.isVerbose) {
                    logger.verbose("Failed to set", CacheUtil.prefix + key, "error", err);
                  }
                  reject(err);
                  return;
                }

                if (Date.now() - started > CacheUtil.logThreshold) {
                  logger.info("Cache set", CacheUtil.prefix + key, "took", Date.now() - started, "ms");
                }

                resolve(reply === "OK");
              }
            );
          }
        }),
    }
  : {
      get: (_key) => Promise.resolve(null),
      getset: (_key, def) => Promise.resolve(def()),
      set: (_key, _data) => Promise.resolve(false),
    };

const batch = async (list, executor, concurrencyLimit) => {
  const activeTasks = [];
  const LOG_THRESHOLD = 100;
  let queued = 0;

  for (const item of list) {
    while (activeTasks.length >= concurrencyLimit) {
      await Promise.all(activeTasks);
    }

    logger.isVerbose && logger.verbose(`Start task: ${item}`);
    const activeTask = new Promise((resolve, reject) => {
      try {
        executor(item).then(resolve).catch(reject);
      } catch (e) {
        logger.warn("Batch reject", e);
        reject(e);
      }
    })
      .then(() => {
        activeTasks.splice(activeTasks.indexOf(activeTask), 1);
        logger.isVerbose && logger.verbose(`End task: ${item}`);
      })
      .catch((error) => {
        activeTasks.splice(activeTasks.indexOf(activeTask), 1);
        logger.isVerbose && logger.verbose(`End task: ${item}`, error);
        throw error;
      });

    activeTasks.push(activeTask);
    queued++;
    if (queued % LOG_THRESHOLD === 0 && queued > 0) {
      logger.info("Processed", queued, "items in batch");
    }
  }

  if (activeTasks.length > 0) {
    await Promise.all(activeTasks);
  }
};

module.exports = { cache: Cache, batch };
