import { ExactPackage, LatestPackageTarget } from "../install/package.js";
import { Resolver } from "../trace/resolver.js";
// @ts-ignore
import { fetch } from '#fetch';

const cdnUrl = 'https://deno.land/x/';

export function pkgToUrl (pkg: ExactPackage) {
  return cdnUrl + pkg.name + '@v' + pkg.version + '/';
}

export function parseUrlPkg (url: string): ExactPackage | undefined {
  if (!url.startsWith(cdnUrl))
    return;
  const path = url.slice(cdnUrl.length);
  const versionIndex = path.indexOf('@v');
  if (versionIndex === -1)
    return;
  const sepIndex = path.indexOf('/', versionIndex);
  return { registry: 'deno', name: path.slice(0, versionIndex), version: path.slice(versionIndex + 2, sepIndex === -1 ? path.length : sepIndex) };
}

export async function resolveLatestTarget (this: Resolver, target: LatestPackageTarget, unstable: boolean, _layer: string, parentUrl: string): Promise<ExactPackage | null> {
  const { registry, name, range } = target;

  if (range.isExact)
    return { registry, name, version: range.version.toString() };

  if (!range.isWildcard)
    throw new Error(`Version ranges are not supported looking up in the Deno registry currently, until an API is available.`);

  const fetchOpts = { ...this.fetchOpts, headers: Object.assign({}, this.fetchOpts.headers || {}, { 'accept': 'text/html' }) };
  const res = await fetch(cdnUrl + name, fetchOpts);
  if (!res.ok)
    throw new Error(`Deno: Unable to lookup ${cdnUrl + name}`);
  return parseUrlPkg(res.url);
}
