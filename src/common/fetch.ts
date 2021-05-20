import { version } from '../version.js';
// @ts-ignore
import { readFileSync } from 'fs';
// @ts-ignore
import { fileURLToPath } from 'url';
// @ts-ignore
import { createRequire } from 'module';

declare global {
  var process: any;
}

let _fetch: typeof fetch;
let clearCache: () => void = function () {};
if (typeof fetch !== 'undefined') {
  _fetch = augmentFetchForFileUrls(fetch);
}
else if (globalThis?.process?.versions?.node) {
  const require = createRequire(import.meta.url);
  const path = require('path') as any;
  const home = require('os').homedir();
  const process = require('process');
  const rimraf = require('rimraf');
  const makeFetchHappen = require('make-fetch-happen');
  let cacheDir: string;
  if (process.platform === 'darwin')
    cacheDir = path.join(home, 'Library', 'Caches', 'jspm');
  else if (process.platform === 'win32')
    cacheDir = path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'jspm-cache');
  else
    cacheDir = path.join(process.env.XDG_CACHE_HOME || path.join(home, '.cache'), 'jspm');
  clearCache = function () {
    rimraf.sync(path.join(cacheDir, 'fetch-cache'));
  };
  _fetch = augmentFetchForFileUrls(makeFetchHappen.defaults({
    cacheManager: path.join(cacheDir, 'fetch-cache'),
    headers: { 'User-Agent': `jspm/generator@${version}` }
  }));
}
else {
  throw new Error('No fetch implementation found for this environment, please post an issue.');
}

function augmentFetchForFileUrls (_fetch: any): typeof fetch {
  // @ts-ignore
  return async function (url: URL, ...args: any[]) {
    const urlString = url.toString();
    if (urlString.startsWith('file:') || urlString.startsWith('data:') || urlString.startsWith('node:')) {
      try {
        let source: string;
        if (urlString.startsWith('file:')) {
          source = readFileSync(fileURLToPath(urlString));
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
