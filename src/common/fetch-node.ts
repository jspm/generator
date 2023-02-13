// @ts-ignore
import version from "../version.js";
// @ts-ignore
import path from "path";
// @ts-ignore
import { homedir } from "os";
// @ts-ignore
import process from "process";
// @ts-ignore
import rimraf from "rimraf";
// @ts-ignore
import makeFetchHappen from "make-fetch-happen";
// @ts-ignore
import { readFileSync } from "fs";
// @ts-ignore
import { Buffer } from "buffer";

let cacheDir: string;
if (process.platform === "darwin")
  cacheDir = path.join(homedir(), "Library", "Caches", "jspm");
else if (process.platform === "win32")
  cacheDir = path.join(
    process.env.LOCALAPPDATA || path.join(homedir(), "AppData", "Local"),
    "jspm-cache"
  );
else
  cacheDir = path.join(
    process.env.XDG_CACHE_HOME || path.join(homedir(), ".cache"),
    "jspm"
  );

export function clearCache() {
  rimraf.sync(path.join(cacheDir, "fetch-cache"));
}

const _fetch = makeFetchHappen.defaults({
  cacheManager: path.join(cacheDir, "fetch-cache"),
  headers: { "User-Agent": `jspm/generator@${version}` },
});

function sourceResponse(buffer) {
  return {
    status: 200,
    async text() {
      return buffer.toString();
    },
    async json() {
      return JSON.parse(buffer.toString());
    },
    arrayBuffer() {
      return buffer.buffer || buffer;
    },
  };
}

const dirResponse = {
  status: 200,
  async text() {
    return "";
  },
  async json() {
    throw new Error("Not JSON");
  },
  arrayBuffer() {
    return new ArrayBuffer(0);
  },
};

export const fetch = async function (url: URL, opts?: Record<string, any>) {
  if (!opts) throw new Error("Always expect fetch options to be passed");
  const urlString = url.toString();
  const protocol = urlString.slice(0, urlString.indexOf(":") + 1);
  let source: string | Buffer;
  switch (protocol) {
    case "ipfs:":
      const { get } = await import("./ipfs.js");
      source = await get(urlString.slice(7), opts.ipfsAPI);
      if (source === null) return dirResponse;
      if (source === undefined) return { status: 404 };
      return sourceResponse(source);
    case "file:":
      if (urlString.endsWith("/")) {
        try {
          readFileSync(new URL(urlString));
          return { status: 404, statusText: "Directory does not exist" };
        } catch (e) {
          if (e.code === "EISDIR") return dirResponse;
          throw e;
        }
      }
      try {
        return sourceResponse(readFileSync(new URL(urlString)));
      } catch (e) {
        if (e.code === "EISDIR") return dirResponse;
        if (e.code === "ENOENT" || e.code === "ENOTDIR")
          return { status: 404, statusText: e.toString() };
        return { status: 500, statusText: e.toString() };
      }
    case "data:":
      return sourceResponse(
        decodeURIComponent(urlString.slice(urlString.indexOf(",")))
      );
    case "node:":
      return sourceResponse("");
    case "http:":
    case "https:":
      // @ts-ignore
      return _fetch(url, opts);
  }
};
