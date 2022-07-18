import { ExactPackage, LatestPackageTarget } from "../install/package.js";
import { Resolver } from "../trace/resolver.js";
// @ts-ignore
import { fetch } from '#fetch';

const cdnUrl = 'https://deno.land/x/';
const stdlibUrl = 'https://deno.land/std';

export function pkgToUrl (pkg: ExactPackage) {
  if (pkg.registry === 'deno')
    return stdlibUrl + '@' + pkg.version + '/' + pkg.name + '/';
  if (pkg.registry === 'denoland')
    return cdnUrl + pkg.name + '@v' + pkg.version + '/';
  throw new Error(`Deno provider does not support the ${pkg.registry} registry`);
}

export function parseUrlPkg (url: string): ExactPackage | undefined {
  if (url.startsWith(stdlibUrl) && url[stdlibUrl.length] === '@') {
    const version = url.slice(stdlibUrl.length + 1, url.indexOf('/', stdlibUrl.length + 1));
    let name = url.slice(stdlibUrl.length + version.length + 2);
    if (name.endsWith('/mod.ts'))
      name = name.slice(0, -7);
    else if (name.endsWith('.ts'))
      name = name.slice(0, -3);
    return { registry: 'deno', name, version };
  }
  else if (url.startsWith(cdnUrl)) {
    const path = url.slice(cdnUrl.length);
    const versionIndex = path.indexOf('@v');
    if (versionIndex === -1)
      return;
    const sepIndex = path.indexOf('/', versionIndex);
    return { registry: 'denoland', name: path.slice(0, versionIndex), version: path.slice(versionIndex + 2, sepIndex === -1 ? path.length : sepIndex) };
  }
}

export async function resolveLatestTarget (this: Resolver, target: LatestPackageTarget, unstable: boolean, _layer: string, parentUrl: string): Promise<ExactPackage | null> {
  const { registry, name, range } = target;

  if (range.isExact)
    return { registry, name, version: range.version.toString() };

  if (!range.isWildcard)
    throw new Error(`Version ranges are not supported looking up in the Deno registry currently, until an API is available.`);

  const fetchOpts = { ...this.fetchOpts, headers: Object.assign({}, this.fetchOpts.headers || {}, { 'accept': 'text/html' }) };
  const res = await fetch((registry === 'denoland' ? cdnUrl : stdlibUrl + '/') + name, fetchOpts);
  if (!res.ok)
    throw new Error(`Deno: Unable to lookup ${(registry === 'denoland' ? cdnUrl : stdlibUrl + '/') + name}`);
  return parseUrlPkg(res.url);
}
