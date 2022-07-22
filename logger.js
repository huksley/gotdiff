/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-empty-function */

const _prefix = process.env.NODE_ENV === "production" ? "" : "dev ";

/**
 * Universal logger based on console. Also supports logger.verbose()
 * and level testing properties, i.e. logger.isVerbose || false
 *
 * Usage:
 * ```
 * import logger from "@/lib/logger"
 * logger.info(...)
 * logger.verbose(...)
 *
 * if (logger.isVerbose) {
 *  logger.verbose(...)
 * }
 * ```
 */
export const logger = {
  isVerbose:
    process.env.LOG_VERBOSE && (process.env.LOG_VERBOSE === "1" || process.env.LOG_VERBOSE === "true") ? true : false,
  info: console.info.bind(console.info, _prefix + "%s"),
  verbose:
    process.env.LOG_VERBOSE && (process.env.LOG_VERBOSE === "1" || process.env.LOG_VERBOSE === "true")
      ? console.info.bind(console.info, "DEBUG " + _prefix + "%s")
      : () => {},
  warn: console.warn.bind(console.info, _prefix + "%s"),
  error: console.error.bind(console.info, _prefix + "%s"),
};
