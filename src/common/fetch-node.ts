import { version } from '../version.js';
// @ts-ignore
import path from 'path';
// @ts-ignore
import { homedir } from 'os';
// @ts-ignore
import process from 'process';
// @ts-ignore
import rimraf from 'rimraf';
// @ts-ignore
import makeFetchHappen from 'make-fetch-happen';
// @ts-ignore
import { readFileSync } from 'fs';

let cacheDir: string;
if (process.platform === 'darwin')
  cacheDir = path.join(homedir(), 'Library', 'Caches', 'jspm');
else if (process.platform === 'win32')
  cacheDir = path.join(process.env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local'), 'jspm-cache');
else
  cacheDir = path.join(process.env.XDG_CACHE_HOME || path.join(homedir(), '.cache'), 'jspm');

export function clearCache () {
  rimraf.sync(path.join(cacheDir, 'fetch-cache'));
};

const _fetch = makeFetchHappen.defaults({
  cacheManager: path.join(cacheDir, 'fetch-cache'),
  headers: { 'User-Agent': `jspm/generator@${version}` }
});

export const fetch = async function (url: URL, ...args: any[]) {
  const urlString = url.toString();
  if (urlString.startsWith('file:') || urlString.startsWith('data:') || urlString.startsWith('node:')) {
    try {
      let source: string;
      if (urlString.startsWith('file:')) {
        if (urlString.endsWith('/')) {
          try {
            readFileSync(new URL(urlString));
            return { status: 404, statusText: 'Directory does not exist' };
          }
          catch (e) {
            if (e.code === 'EISDIR') {
              return {
                status: 200,
                async text () {
                  return '';
                },
                async json () {
                  throw new Error('Not JSON');
                },
                arrayBuffer () {
                  return new ArrayBuffer(0);
                }
              };
            }
            throw e;
          }
        }
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
      if (e.code === 'EISDIR')
        return {
          status: 200,
          async text () {
            return '';
          },
          async json () {
            throw new Error('Not JSON');
          },
          arrayBuffer () {
            return new ArrayBuffer(0);
          }
        };
      if (e.code === 'ENOENT' || e.code === 'ENOTDIR')
        return { status: 404, statusText: e.toString() };
      return { status: 500, statusText: e.toString() };
    }
  }
  // @ts-ignore
  return _fetch(url, ...args);
}
