// Browser native fetch doesn't deal well with high contention
// restrict in-flight fetches to a pool of 100
let p = [];
let c = 0;
function pushFetchPool () {
  if (++c > 100)
    return new Promise(r => p.push(r));
}
function popFetchPool () {
  c--;
  if (p.length)
    p.shift()();
}

export async function fetch (url, opts) {
  const poolQueue = pushFetchPool();
  if (poolQueue) await poolQueue;
  try {
    return await globalThis.fetch(url, opts);
  }
  finally {
    popFetchPool();
  }
}
export const clearCache = () => {};
