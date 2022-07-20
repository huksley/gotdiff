import { logger } from "../logger";

// https://swr.vercel.app/docs/advanced/cache#localstorage-based-persistent-cache
const prefix = "__swr_4";

export const SWRLocalStorageCache = () => ({
  get: (key) => {
    const value = localStorage.getItem(prefix + key);
    logger.verbose("Cache get", key);
    return value ? JSON.parse(value) : undefined;
  },
  set: (key, value) => {
    logger.verbose("Cache set", key, value);
    try {
      return localStorage.setItem(prefix + key, JSON.stringify(value));
    } catch (e) {
      logger.warn("Failed, clearing", e);
      localStorage.clear();
    }
  },
  delete: (key) => {
    logger.verbose("Cache clear", key);
    localStorage.removeItem(prefix + key);
  },
});
