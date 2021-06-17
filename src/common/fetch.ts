import { version } from '../version.js';

declare global {
  var process: any;
}

let _fetch: typeof fetch;
let clearCache: () => void = function () {};
if (typeof fetch !== 'undefined') {
  _fetch = fetch;
}
else if (globalThis.process?.versions?.node) {
  let __fetch: (url: URL, ...args: any[]) => Promise<Response>;
  _fetch = async function (url: URL, ...args: any[]) {
    if (__fetch)
      return __fetch(url, ...args);
    // @ts-ignore
    const path = await import('path');
    // @ts-ignore
    const { homedir } = await import('os');
    // @ts-ignore
    const { default: process } = await import('process');
    // @ts-ignore
    const { default: rimraf } = await import('rimraf');
    // @ts-ignore
    const { default: makeFetchHappen } = await import('make-fetch-happen');
    // @ts-ignore
    const { readFileSync } = await import('fs');
    let cacheDir: string;
    if (process.platform === 'darwin')
      cacheDir = path.join(homedir(), 'Library', 'Caches', 'jspm');
    else if (process.platform === 'win32')
      cacheDir = path.join(process.env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local'), 'jspm-cache');
    else
      cacheDir = path.join(process.env.XDG_CACHE_HOME || path.join(homedir(), '.cache'), 'jspm');
    clearCache = function () {
      rimraf.sync(path.join(cacheDir, 'fetch-cache'));
    };
    __fetch = augmentFetchForFileUrls(makeFetchHappen.defaults({
      cacheManager: path.join(cacheDir, 'fetch-cache'),
      headers: { 'User-Agent': `jspm/generator@${version}` }
    }), readFileSync) as any;
    return __fetch(url, ...args);
  } as any as typeof fetch;
}
else {
  throw new Error('No fetch implementation found for this environment, please post an issue.');
}

function augmentFetchForFileUrls (_fetch: any, readFileSync: (path: string | URL) => string): Response {
  // @ts-ignore
  return async function (url: URL, ...args: any[]) {
    const urlString = url.toString();
    if (urlString.startsWith('file:') || urlString.startsWith('data:') || urlString.startsWith('node:')) {
      try {
        let source: string;
        if (urlString.startsWith('file:')) {
          source = readFileSync(new URL(urlString));
        }
        else if (urlString.startsWith('node:')) {
          source = '';
        }
        else {
          source = decodeURIComponent(urlString.slice(urlString.indexOf(',')));
        }
        return {
          status: 200,
          async text () {
            return source.toString();
          },
          async json () {
            return JSON.parse(source.toString());
          },
          arrayBuffer () {
            return source;
          }
        };
      }
      catch (e) {
        if (e.code === 'EISDIR' || e.code === 'ENOTDIR')
          return { status: 404, statusText: e.toString() };
        if (e.code === 'ENOENT')
          return { status: 404, statusText: e.toString() };
        return { status: 500, statusText: e.toString() };
      }
    }
    // @ts-ignore
    if (typeof Deno !== 'undefined' /*&& args[0]?.cache === 'only-if-cached' */) {
      const { cache } = await import(eval('"../../deps/cache/mod.ts"'));
      try {
        const file = await cache(urlString);
        return {
          status: 200,
          async text () {
            // @ts-ignore
            return (await Deno.readTextFile(file.path)).toString();
          },
          async json () {
            // @ts-ignore
            return JSON.parse((await Deno.readTextFile(file.path)).toString());
          },
          async arrayBuffer () {
            // @ts-ignore
            return (await Deno.readTextFile(file.path));
          }
        };
      }
      catch (e) {
        if (e.name === 'CacheError' && e.message.indexOf('Not Found !== -1')) {
          return { status: 404, statusText: e.toString() };
        }
        throw e;
      }
    }
    // @ts-ignore
    return _fetch(url, ...args);
  } as typeof fetch;
}

export { _fetch as fetch, clearCache };
