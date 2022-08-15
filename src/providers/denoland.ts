import { ExactPackage, LatestPackageTarget } from "../install/package.js";
import { Resolver } from "../trace/resolver.js";
// @ts-ignore
import { fetch } from '#fetch';

const cdnUrl = 'https://deno.land/x/';
const stdlibUrl = 'https://deno.land/std';

export function pkgToUrl (pkg: ExactPackage): `${string}/` {
  if (pkg.registry === 'deno')
    return `${stdlibUrl}@${pkg.version}/`;
  if (pkg.registry === 'denoland')
    return `${cdnUrl}${pkg.name}@v${pkg.version}/`;
  throw new Error(`Deno provider does not support the ${pkg.registry} registry`);
}

export function parseUrlPkg (url: string): { pkg: ExactPackage, subpath: `./${string}` | null, layer: string } | undefined {
  let subpath = null;
  if (url.startsWith(stdlibUrl) && url[stdlibUrl.length] === '@') {
    const version = url.slice(stdlibUrl.length + 1, url.indexOf('/', stdlibUrl.length + 1));
    subpath = url.slice(stdlibUrl.length + version.length + 2);
    if (subpath.endsWith('/mod.ts'))
      subpath = subpath.slice(0, -7);
    else if (subpath.endsWith('.ts'))
      subpath = subpath.slice(0, -3);
    return { pkg: { registry: 'deno', name: 'std', version }, layer: 'default', subpath: `./${subpath}/mod.ts` };
  }
  else if (url.startsWith(cdnUrl)) {
    const path = url.slice(cdnUrl.length);
    const versionIndex = path.indexOf('@v');
    if (versionIndex === -1)
      return;
    const sepIndex = path.indexOf('/', versionIndex);
    return { pkg: { registry: 'denoland', name: path.slice(0, versionIndex), version: path.slice(versionIndex + 2, sepIndex === -1 ? path.length : sepIndex) }, subpath: null, layer: 'default' };
  }
}

export async function resolveLatestTarget (this: Resolver, target: LatestPackageTarget, _layer: string, parentUrl: string): Promise<{ pkg: ExactPackage, subpath: `./${string}` | null } | null> {
  const { registry, name, range } = target;

  if (range.isExact)
    return { pkg: { registry, name, version: range.version.toString() }, subpath: null };

  if (!range.isWildcard)
    throw new Error(`Version ranges are not supported looking up in the Deno registry currently, until an API is available.`);

  const fetchOpts = {
    ...this.fetchOpts,
    headers: Object.assign({}, this.fetchOpts.headers || {}, {
      // For some reason, Deno provides different redirect behaviour for the server
      // Which requires us to use the text/html accept
      'accept': typeof document === 'undefined' ? 'text/html' : 'text/javascript'
    })
  };
  // "mod.ts" addition is necessary for the browser otherwise not resolving an exact module gives a CORS error
  const res = await fetch((registry === 'denoland' ? cdnUrl : stdlibUrl + '/') + name + '/mod.ts', fetchOpts);
  if (!res.ok)
    throw new Error(`Deno: Unable to lookup ${(registry === 'denoland' ? cdnUrl : stdlibUrl + '/') + name}`);
  return { pkg: parseUrlPkg(res.url).pkg, subpath: registry === 'deno' ? `./${name}/mod.ts` : null  };
}
