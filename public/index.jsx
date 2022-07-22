import React, { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import useSWR, { SWRConfig, useSWRConfig } from "swr";
import { SWRLocalStorageCache } from "./SWRLocalStorageCache";
import { useStorage } from "./useStorage";
import { ErrorBoundary } from "react-error-boundary";
import { compiler as markdown } from "markdown-to-jsx";
import { logger } from "../logger";
import { detailedDiff } from "deep-object-diff";
import { BrowserRouter } from "react-router-dom";
import { useRouter } from "./useRouter";
import numeral from "numeral";
const container = document.querySelector("#root");
const root = ReactDOM.createRoot(container);

const urls = (s, url) => {
  // Urls already
  if (s.indexOf(url + "/issues") > 0) {
    return s;
  }
  s = s.replace(/\(([0-9abcdef]{8})\)/gi, "([$1](" + url + "/commit/$1))");
  s = s.replace(/\#([0-9]+)/g, "[#$1](" + url + "/issues/$1)");
  s = s.replace(/\@([0-9a-zA-Z_]+)/gi, "[@$1](https://github.com/$1)");
  return s;
};

const Dependencies = ({ ignore, older, newer, title }) => {
  const diff = useMemo(() => detailedDiff(older, newer), [older, newer]);

  const changes = useMemo(
    () =>
      Object.keys(diff)
        .map((action) => {
          const o = diff[action];
          return Object.keys(o || {}).filter((name) => !ignore.find((prefix) => name.startsWith(prefix)));
        })
        .flat(1)
        .filter((o) => Object.keys(o || {}).length > 0),
    [diff]
  );

  return changes.length > 0 ? (
    <div>
      <h4>{title}</h4>
      <ul>
        {Object.keys(diff).map((action) =>
          Object.keys(diff[action])
            .filter((name) => !ignore.find((prefix) => name.startsWith(prefix)))
            .map((name, index) => (
              <li key={index}>
                <b>
                  {action}{" "}
                  <a href={"?package=" + name} rel="noreferrer">
                    {name}
                  </a>
                </b>
                {action === "deleted" ? (
                  ""
                ) : (
                  <>
                    : {older ? <code>{older[name]}</code> : "?"} =&gt; {newer ? <code>{newer[name]}</code> : "?"}
                  </>
                )}
              </li>
            ))
        )}
      </ul>
    </div>
  ) : null;
};

const ShowPackage = ({ name }) => {
  const [refresh, setRefresh] = useStorage("json_refresh_" + name);
  const [older, setOlder, key] = useStorage(name + "_older_version", undefined);
  const [latest, setLatest] = useStorage(name + "_latest_version", undefined);

  const { data, isValidating, mutate, error } = useSWR(
    "/json?package=" + name,
    (key) => fetch(key).then((key) => key.json()),
    {
      revalidateIfStale: false,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateOnMount: false,
      dedupingInterval: 10000,
      onFailure: () => {},
      onSuccess: () => {
        logger.info("Got data");
        setRefresh(Date.now());
      },
    }
  );

  const latestPackage = useMemo(() => {
    return latest ? data?.packages.find((c) => c.version === latest) : data?.latestPackage;
  }, [latest, data]);

  const olderPackage = useMemo(() => {
    return older ? data?.packages.find((c) => c.version === older) : data?.olderPackage;
  }, [older, data]);

  const latestRelease = useMemo(() => {
    return latest
      ? data?.releases.find(
          // Keep in sync with index.js
          (r) =>
            r.name === latest ||
            r.name === "v" + latest ||
            r.tag_name === latest ||
            r.tag_name === "v" + latest ||
            r.tag_name === name + "@" + latest ||
            r.tag_name === name + "@v" + latest
        )
      : data?.latestRelease;
  }, [data, latest]);

  return (
    <div>
      <h2>
        {name}{" "}
        <a href={data?.url}>
          <img src="/github.svg" height="24" />
        </a>{" "}
        <a href={data?.npmUrl}>
          <img src="/npm.svg" height="18" />
        </a>
      </h2>
      <div>
        <sub>
          {latestPackage?.description ? markdown(latestPackage?.description) : ""} (last updated{" "}
          {refresh ? new Date(refresh).toISOString() : "unknown"}){error && <div>Error {error?.message}</div>}{" "}
          <a
            href="#"
            onClick={(event) => {
              event.preventDefault();
              mutate();
            }}
          >
            Refresh
          </a>{" "}
          {isValidating ? "Loading..." : ""}
        </sub>
      </div>
      <h3>Previous {older || data?.older}</h3>
      <sub>
        Pick previous version{" "}
        {data?.latestVersions.map((v, index) => (
          <span key={index}>
            {index > 0 ? ", " : ""}
            <a
              href="#"
              onClick={(event) => {
                event.preventDefault();
                setOlder(v);
              }}
            >
              {v}
            </a>
          </span>
        ))}
      </sub>
      <p>
        {olderPackage?.dist?.fileCount} files, {numeral(olderPackage?.dist?.unpackedSize).format("0b")}
      </p>
      <h3>Latest {latest || data?.latest}</h3>
      <sub>
        Pick latest version{" "}
        {data?.latestVersions.map((v, index) => (
          <span key={index}>
            {index > 0 ? ", " : ""}
            <a
              href="#"
              onClick={(event) => {
                event.preventDefault();
                setLatest(v);
              }}
            >
              {v}
            </a>
          </span>
        ))}
      </sub>
      <p>
        {latestPackage?.dist?.fileCount} files (Δ{" "}
        {Math.round((100.0 * latestPackage?.dist?.fileCount) / olderPackage?.dist?.fileCount) - 100.0}%),{" "}
        {numeral(latestPackage?.dist?.unpackedSize).format("0b")} (Δ{" "}
        {Math.round((100.0 * latestPackage?.dist?.unpackedSize) / olderPackage?.dist?.unpackedSize) - 100.0}
        %),{" "}
      </p>

      <Dependencies
        title="Update to dependencies"
        older={olderPackage?.dependencies}
        newer={latestPackage?.dependencies}
        ignore={["@" + latestPackage?.name + "/"]}
      />

      <Dependencies
        title="Update to peer dependencies"
        older={olderPackage?.peerDependencies}
        newer={latestPackage?.peerDependencies}
        ignore={["@" + latestPackage?.name + "/"]}
      />

      <h3>Latest version footprint</h3>
      <div>
        <b>{numeral(data?.footprint).format("0b")}</b>, <b>{data?.dependencies?.length}</b> packages
      </div>

      <div>
        <h4>
          GitHub release ChangeLog {latestRelease?.name || latestRelease?.tag_name} published{" "}
          {latestRelease?.published_at}
        </h4>
        <a href={data?.url + "/releases/tag/" + latestRelease?.tag_name}>Open release</a>{" "}
        <a href={data?.url + "/compare/v" + olderPackage?.version + "..v" + latestPackage?.version}>Got diff!</a>
        <div>{latestRelease?.body ? markdown(urls(latestRelease?.body, data?.url)) : undefined}</div>
      </div>
    </div>
  );
};

function ErrorFallback({ error, resetErrorBoundary }) {
  logger.warn("Error", error);
  return (
    <div role="alert error">
      <h2>React Error</h2>
      <pre>{error.message}</pre>
      <button onClick={resetErrorBoundary}>Try again</button>
    </div>
  );
}

const Page = () => {
  const router = useRouter();
  const [name, setName] = useState(router.query?.package || "next");
  const [typed, setTyped] = useState();

  useEffect(() => {
    if (name != router.query.package) {
      setName(router.query.package);
    }
  }, [name, setName, router]);

  return (
    <div>
      <h1>
        <a href="">gotdiff?</a>{" "}
        <button onClick={(_) => (window.location = "https://www.producthunt.com/posts/gotdiff")}>
          Check my project
        </button>
      </h1>
      <div>
        Check dependencies, updates and new releases. Popular packages:{" "}
        {["next", "next-auth", "react", "sharp", "date-fns", "ramda", "swr"].map((name, index) => (
          <span key={name}>
            {index > 0 ? ", " : ""}
            <a
              href={"?package=" + name}
              onClick={(event) => {
                event.preventDefault();
                router.push("?package=" + name);
                setName(name);
              }}
            >
              {name}
            </a>
          </span>
        ))}
      </div>
      <div>
        <input
          type="text"
          size={12}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder="Package name"
          onKeyDown={(event) => {
            if (event.key === "Enter" && typed) {
              router.push("?package=" + typed);
              setName(typed);
            }
          }}
        />

        <button
          onClick={(event) => {
            event.preventDefault();
            if (typed) {
              setName(typed);
              router.push("?package=" + typed);
            }
          }}
        >
          Check
        </button>
      </div>
      <hr />
      <ShowPackage name={name || "next"} />
    </div>
  );
};

root.render(
  <ErrorBoundary FallbackComponent={ErrorFallback}>
    <SWRConfig
      value={{
        provider: SWRLocalStorageCache,
      }}
    >
      <BrowserRouter>
        <Page />
      </BrowserRouter>
    </SWRConfig>
  </ErrorBoundary>
);
