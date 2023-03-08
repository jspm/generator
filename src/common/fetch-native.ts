import { FetchFn, wrapWithRetry } from "./fetch-common.js";

// Browser native fetch doesn't deal well with high contention
// restrict in-flight fetches to a pool of 100
let p = [];
let c = 0;
function pushFetchPool() {
  if (++c > 100) return new Promise((r) => p.push(r));
}
function popFetchPool() {
  c--;
  if (p.length) p.shift()();
}

export const fetch: FetchFn = wrapWithRetry(async function fetch(url, opts) {
  const poolQueue = pushFetchPool();
  if (poolQueue) await poolQueue;
  try {
    return await globalThis.fetch(url as any, opts);
  } catch (e) {
    // CORS errors throw a fetch type error
    // Instead, treat this as an actual unauthorized response
    if (e instanceof TypeError) {
      return {
        status: 401,
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
    }
  } finally {
    popFetchPool();
  }
});

export const clearCache = () => {};
