import aws from "aws-sdk";
import { logger } from "./logger.js";

const s3 = new aws.S3({ apiVersion: "2006-03-01" });

export const cacheInBucket = async (fetch, bucket, key, cdnUrl, mimeType, objectProps) => {
  if (!bucket) {
    return fetch();
  } else {
    try {
      const list = await s3
        .listObjectsV2({
          Bucket: bucket,
          Prefix: key,
          MaxKeys: 1,
        })
        .promise();
      logger.verbose("Cached list result", list?.Contents);
      if (list.Contents?.length == 1 && list.Contents[0]) {
        logger.info("Found existing S3", list.Contents[0].Key);
        if (cdnUrl) {
          return true;
        } else {
          try {
            const response = await s3
              .getObject({
                Bucket: bucket,
                Key: key,
              })
              .promise();
            return response.Body;
          } catch (e) {
            throw new Error("Failed to read: " + e.message ? e.message : e);
          }
        }
      } else {
        try {
          const buffer = await fetch();
          logger.info("Writing s3://" + bucket + "/" + key);
          const s3result = await s3
            .upload({
              Bucket: bucket,
              Key: key,
              Body: Buffer.from(buffer),
              ContentType: mimeType || "application/octet-stream",
              ...objectProps,
            })
            .promise();
          const cachedUrl = s3result.Location;
          logger.info("Cached in S3", cachedUrl);
          return buffer;
        } catch (e) {
          throw new Error("Failed to save: " + e.message ? e.message : e);
        }
      }
    } catch (e) {
      throw new Error("Failed to list: " + e.message ? e.message : e);
    }
  }
};
