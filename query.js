import nano from "nano";
import { createCache, closeCache } from "./cache.js";
import compareVersions from "compare-versions";
import { logger } from "./logger.js";
import { request } from "./request.js";
import { exec } from "child_process";

export const queryPackage = async (name) => {
  const st = Date.now();
  const db = nano("https://replicate.npmjs.com/registry");
  const cache = createCache();

  const packages = await cache.getset(
    name + "-package",
    async () => {
      logger.info("Query NPMJS", name);
      try {
        return await db.get(name);
      } catch (e) {
        logger.warn("Error fetching", name, e);
        return {};
      }
    },
    24 * 3600 * 1000
  );
  logger.info("Query NPMJS done in", Date.now() - st, "ms");

  const allVersions = Object.keys(packages.versions || [])
    .filter(
      (v) =>
        !v.includes("canary") &&
        !v.includes("beta") &&
        !v.includes("alpha") &&
        !v.includes("-next-") &&
        !v.includes("-rc.")
    )
    .sort(compareVersions);

  const latest = allVersions[allVersions.length - 1];
  const older = allVersions[allVersions.length - 2];

  const olderPackages = Object.keys(packages.versions || [])
    .filter((v) => v === older)
    .map((ver) => ({
      ...packages.versions[ver],
    }));

  const olderPackage = olderPackages[0];
  const latestPackages = Object.keys(packages.versions || [])
    .filter((v) => v === latest)
    .map((ver) => ({
      ...packages.versions[ver],
    }));
  const latestPackage = latestPackages[0];

  let repoUrl = latestPackage?.repository?.url;
  if (repoUrl?.startsWith("git+https://")) {
    repoUrl = repoUrl.replace("git+https://", "https://");
  }
  if (repoUrl?.startsWith("git+ssh://")) {
    repoUrl = repoUrl.replace("git+ssh://", "https://");
  }
  if (repoUrl?.startsWith("git://")) {
    repoUrl = repoUrl.replace("git://", "https://");
  }
  if (repoUrl?.endsWith(".git")) {
    repoUrl = repoUrl.replace(/\.git$/, "");
  }

  let org = undefined;
  let repository = undefined;

  const repo = repoUrl ? new URL(repoUrl) : undefined;
  if (repo?.hostname === "github.com") {
    org = repo.pathname.split("/")[1];
    repository = repo.pathname.split("/")[2];
  }

  logger.info("Fetching releases for", repoUrl);
  const releases = await cache.getset(
    name + "-releases3",
    async () => {
      if (!org || !repository) {
        return [];
      }
      try {
        const r = await request(`https://api.github.com/repos/${org}/${repository}/releases?per_page=100`, {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: "token " + process.env.GITHUB_TOKEN,
          },
        });
        logger.info("Got releases", r.body.length);
        return r.body;
      } catch (e) {
        logger.warn("Failed to get releases", e);
        return [];
      }
    },
    24 * 3600 * 1000
  );

  const matchRelease = (version) => (r) =>
    r.name === version ||
    r.name === "v" + version ||
    r.tag_name === version ||
    r.tag_name === "v" + version ||
    r.tag_name === name + "@" + version ||
    r.tag_name === name + "@v" + version;

  logger.info("Releases", releases.length, "latest version", latest);
  const latestRelease = releases.find(matchRelease(latest));
  const latestVersions = allVersions.length > 15 ? allVersions.slice(allVersions.length - 15) : allVersions;

  logger.info("Fetching tree for", name, latest);
  const st2 = Date.now();
  const tree = await cache.getset(
    name + "_package_lock6_" + latest,
    async () => {
      try {
        const json = await new Promise((resolve, reject) => {
          exec(
            "./tree.sh " + name + "@" + latest,
            { maxBuffer: 16 * 1024 * 1024, timeout: 30000 },
            (err, stdout, stderr) => {
              if (err) {
                logger.warn("Fetch tree failed", name, latest, err?.code, stderr);
                reject(new Error("Fetch failed " + name + "@" + latest));
              } else {
                logger.info("Fetched tree", name, stderr);
                resolve(stdout);
              }
            }
          );
        });

        return json;
      } catch (e) {
        logger.warn("Fetch failed", e);
        return null;
      }
    },
    24 * 3600 * 1000
  );

  logger.info("Fetched tree in", Date.now() - st2, "ms, ", tree?.length, "bytes");
  const lock = tree ? JSON.parse(tree) : undefined;
  const dependencies = Object.keys(lock?.packages || [])
    .filter((name) => name.startsWith("node_modules/"))
    .filter((dname) => dname !== "node_modules/" + name)
    .filter((name) => {
      const p = lock?.packages[name];
      return !p.peer;
    });

  const response = {
    allVersions,
    latestVersions,
    latestPackage,
    olderPackage,
    releases: releases,
    latestRelease,
    older,
    latest,
    name: packages.name || name,
    url: repoUrl,
    npmUrl: "https://npmjs.com/package/" + name,
    packages: latestVersions.map((v) => packages.versions[v]),
    footprint: lock?.__size,
    dependencies,
  };

  logger.info("Package", name, "latest", latest, "footprint", lock?.__size, "dependencies", dependencies?.length);
  return response;
};

// https://2ality.com/2022/07/nodejs-esm-main.html
if (import.meta.url === "file://" + process.argv[1] + ".js") {
  queryPackage("swr").finally((_) => {
    closeCache();
  });
}
