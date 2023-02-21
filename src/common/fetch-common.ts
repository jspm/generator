export interface Response {
  status: number;
  statusText?: string;
  text?(): Promise<string>;
  json?(): Promise<any>;
  arrayBuffer?(): ArrayBuffer;
}

export type FetchFn = (
  url: URL,
  ...args: any[]
) => Promise<Response | globalThis.Response>;

/**
 * Wraps a fetch request with retry logic on exceptions, which is useful for
 * spotty connections that may fail intermittently.
 */
export function wrapWithRetry(fetch: FetchFn): FetchFn {
  return async function (url: URL, ...args: any[]) {
    let retries = 0;
    while (true) {
      try {
        return await fetch(url, ...args);
      } catch (e) {
        if (retries++ > 3) throw e;
      }
    }
  };
}
