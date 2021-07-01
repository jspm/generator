// @ts-ignore
import { fetch as _fetch } from './fetch-native.js';
// @ts-ignore
import { fileURLToPath } from 'url';
// @ts-ignore
import { cache } from "https://deno.land/x/cache/mod.ts";

export function clearCache () {
};

export const fetch = async function (url: URL, ...args: any[]) {
  const urlString = url.toString();
  if (urlString.startsWith('file:') || urlString.startsWith('data:') || urlString.startsWith('node:')) {
    try {
      let source: string;
      if (urlString.startsWith('file:')) {
        // @ts-ignore
        source = await Deno.readTextFile(fileURLToPath(urlString));
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
      console.log(e.name === 'NotFound');
      if (e.name === 'NotFound')
        return { status: 404, statusText: e.toString() };
      return { status: 500, statusText: e.toString() };
    }
  }
  else {
    const file = await cache(urlString);
    // @ts-ignore
    const source = await Deno.readTextFile(file.path);
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
  // @ts-ignore
  return _fetch(url, ...args);
}
