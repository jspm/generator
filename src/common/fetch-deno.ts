// @ts-ignore
import { fileURLToPath } from 'url';
// @ts-ignore
// Caching disabled due to not respecting cache headers...
// import { cache } from "https://deno.land/x/cache/mod.ts";

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
      if (e.name === 'NotFound')
        return { status: 404, statusText: e.toString() };
      return { status: 500, statusText: e.toString() };
    }
  }
  else {
    return globalThis.fetch(urlString, ...args);
    // let file;
    // try {
    //   file = await cache(urlString);
    // }
    // catch (e) {
    //   if (e.name === 'SyntaxError') {
    //     // Weird bug in Deno cache...
    //     // @ts-ignore
    //     return _fetch(url, ...args);
    //   }
    //   if (e.name === 'CacheError' && e.message === 'Not Found') {
    //     return { status: 404, statusText: e.toString() };
    //   }
    //   throw e;
    // }
    // @ts-ignore
    // const source = await Deno.readTextFile(fromFileUrl(urlString));
    // return {
    //   status: 200,
    //   async text () {
    //     return source.toString();
    //   },
    //   async json () {
    //     return JSON.parse(source.toString());
    //   },
    //   arrayBuffer () {
    //     return source;
    //   }
    // };
  }
}
