import { throwInternalError } from "../common/err.js";
import { JspmError } from "../common/err.js";
import { importedFrom } from "../common/url.js";
import { LatestPackageTarget } from "../install/package.js";
import { pkgToStr } from "../install/package.js";
import { ExactPackage } from "../install/package.js";
import { Resolver } from "../trace/resolver.js";
// @ts-ignore
import { fetch } from '#fetch';

const cdnUrl = 'https://ga.jspm.io/';
const systemCdnUrl = 'https://ga.system.jspm.io/';
const apiUrl = 'https://api.jspm.io/';

const BUILD_POLL_TIME = 5 * 60 * 1000;
const BUILD_POLL_INTERVAL = 5 * 1000;

export function pkgToUrl (pkg: ExactPackage, layer: string) {
  return (layer === 'system' ? systemCdnUrl : cdnUrl) + pkgToStr(pkg) + '/';
}

const exactPkgRegEx = /^(([a-z]+):)?((?:@[^/\\%@]+\/)?[^./\\%@][^/\\%@]*)@([^\/]+)(\/.*)?$/;
export function parseUrlPkg (url: string): { pkg: ExactPackage, layer: string, subpath: `./${string}` | null } | undefined {
  let subpath = null;
  let layer: string;
  if (url.startsWith(cdnUrl))
    layer = 'default';
  else if (url.startsWith(systemCdnUrl))
    layer = 'system';
  else
    return;
  const [,, registry, name, version] = url.slice((layer === 'default' ? cdnUrl : systemCdnUrl).length).match(exactPkgRegEx) || [];
  if (registry && name && version) {
    if (registry === 'npm' && name === '@jspm/core' && url.includes('/nodelibs/')) {
      subpath = `./nodelibs/${url.slice(url.indexOf('/nodelibs/') + 10).split('/')[1]}`;
      if (subpath && subpath.endsWith('.js'))
        subpath = subpath.slice(0, -3);
      else
        subpath = null;
    }
    return { pkg: { registry, name, version }, layer, subpath };
  }
}

let resolveCache: Record<string, {
  latest: Promise<ExactPackage | null>;
  majors: Record<string, Promise<ExactPackage | null>>;
  minors: Record<string, Promise<ExactPackage | null>>;
  tags: Record<string, Promise<ExactPackage | null>>;
}> = {};

export function clearResolveCache () {
  resolveCache = {};
}

async function checkBuildOrError (pkg: ExactPackage, fetchOpts: any): Promise<boolean> {
  const pkgStr = pkgToStr(pkg);
  const pjsonRes = await fetch(`${cdnUrl}${pkgStr}/package.json`, fetchOpts);
  if (pjsonRes.ok)
    return true;
  // no package.json! Check if there's a build error:
  const errLogRes = await fetch(`${cdnUrl}${pkgStr}/_error.log`, fetchOpts);
  if (errLogRes.ok) {
    const errLog = await errLogRes.text();
    throw new JspmError(`Resolved dependency ${pkgStr} with error:\n\n${errLog}\nPlease post an issue at jspm/project on GitHub, or by following the link below:\n\nhttps://github.com/jspm/project/issues/new?title=CDN%20build%20error%20for%20${encodeURIComponent(pkg.name + '@' + pkg.version)}&body=_Reporting%20CDN%20Build%20Error._%0A%0A%3C!--%20%20No%20further%20description%20necessary,%20just%20click%20%22Submit%20new%20issue%22%20--%3E`);
  }
  console.error(`Unable to request ${cdnUrl}${pkgStr}/package.json - ${pjsonRes.status} ${pjsonRes.statusText || 'returned'}`);
  return false;
}

async function ensureBuild (pkg: ExactPackage, fetchOpts: any) {
  const pkgStr = pkgToStr(pkg);
  if (await checkBuildOrError(pkg, fetchOpts))
    return;

  // no package.json AND no build error -> post a build request
  // once the build request has been posted, try polling for up to 2 mins
  const buildRes = await fetch(`${apiUrl}build/${pkg.name}@${pkg.version}`, fetchOpts);
  if (!buildRes.ok && buildRes.status !== 403) {
    const err = (await buildRes.json()).error;
    throw new JspmError(`Unable to request the JSPM API for a build of ${pkgStr}, with error: ${err}.`);
  }

  // build requested -> poll on that
  let startTime = Date.now();
  while (true) {
    await new Promise(resolve => setTimeout(resolve, BUILD_POLL_INTERVAL));

    if (await checkBuildOrError(pkg, fetchOpts))
      return;

    if (Date.now() - startTime >= BUILD_POLL_TIME)
      throw new JspmError(`Timed out waiting for the build of ${pkgStr} to be ready on the JSPM CDN. Try again later, or post a JSPM project issue if the issue persists.`);
  }
}

export async function resolveLatestTarget (this: Resolver, target: LatestPackageTarget, _layer: string, parentUrl: string): Promise<ExactPackage | { pkg: ExactPackage, subpath: `./${string}` | null } | null> {
  const { registry, name, range, unstable } = target;

  // exact version optimization
  if (range.isExact && !range.version.tag) {
    const pkg = { registry, name, version: range.version.toString() };
    await ensureBuild(pkg, this.fetchOpts);
    return pkg;
  }

  const cache = resolveCache[target.registry + ':' + target.name] = resolveCache[target.registry + ':' + target.name] || {
    latest: null,
    majors: Object.create(null),
    minors: Object.create(null),
    tags: Object.create(null)
  };

  if (range.isWildcard || range.isExact && range.version.tag === 'latest') {
    let lookup = await (cache.latest || (cache.latest = lookupRange.call(this, registry, name, '', unstable, parentUrl)));
    // Deno wat?
    if (lookup instanceof Promise)
      lookup = await lookup;
    if (!lookup)
      return null;
    this.log('resolve', `${target.registry}:${target.name}@${range} -> WILDCARD ${lookup.version}${parentUrl ? ' [' + parentUrl + ']' : ''}`);
    await ensureBuild(lookup, this.fetchOpts);
    return lookup;
  }
  if (range.isExact && range.version.tag) {
    const tag = range.version.tag;
    let lookup = await (cache.tags[tag] || (cache.tags[tag] = lookupRange.call(this, registry, name, tag, unstable, parentUrl)));
    // Deno wat?
    if (lookup instanceof Promise)
      lookup = await lookup;
    if (!lookup)
      return null;
    this.log('resolve', `${target.registry}:${target.name}@${range} -> TAG ${tag}${parentUrl ? ' [' + parentUrl + ']' : ''}`);
    await ensureBuild(lookup, this.fetchOpts);
    return lookup;
  }
  let stableFallback = false;
  if (range.isMajor) {
    const major = range.version.major;
    let lookup = await (cache.majors[major] || (cache.majors[major] = lookupRange.call(this, registry, name, major, unstable, parentUrl)));
    // Deno wat?
    if (lookup instanceof Promise)
      lookup = await lookup;
    if (!lookup)
      return null;
    // if the latest major is actually a downgrade, use the latest minor version (fallthrough)
    // note this might miss later major prerelease versions, which should strictly be supported via a pkg@X@ unstable major lookup
    if (range.version.gt(lookup.version)) {
      stableFallback = true;
    }
    else {
      this.log('resolve', `${target.registry}:${target.name}@${range} -> MAJOR ${lookup.version}${parentUrl ? ' [' + parentUrl + ']' : ''}`);
      await ensureBuild(lookup, this.fetchOpts);
      return lookup;
    }
  }
  if (stableFallback || range.isStable) {
    const minor = `${range.version.major}.${range.version.minor}`;
    let lookup = await (cache.minors[minor] || (cache.minors[minor] = lookupRange.call(this, registry, name, minor, unstable, parentUrl)));
    // in theory a similar downgrade to the above can happen for stable prerelease ranges ~1.2.3-pre being downgraded to 1.2.2
    // this will be solved by the pkg@X.Y@ unstable minor lookup
    // Deno wat?
    if (lookup instanceof Promise)
      lookup = await lookup;
    if (!lookup)
      return null;
    this.log('resolve', `${target.registry}:${target.name}@${range} -> MINOR ${lookup.version}${parentUrl ? ' [' + parentUrl + ']' : ''}`);
    await ensureBuild(lookup, this.fetchOpts);
    return lookup;
  }
  return null;
}

function pkgToLookupUrl (pkg: ExactPackage, edge = false) {
  return `${cdnUrl}${pkg.registry}:${pkg.name}${pkg.version ? '@' + pkg.version : edge ? '@' : ''}`;
}
async function lookupRange (this: Resolver, registry: string, name: string, range: string, unstable: boolean, parentUrl?: string): Promise<ExactPackage | null> {
  const res = await fetch(pkgToLookupUrl({ registry, name, version: range }, unstable), this.fetchOpts);
  switch (res.status) {
    case 304:
    case 200:
      return { registry, name, version: (await res.text()).trim() };
    case 404:
      return null;
    default:
      throw new JspmError(`Invalid status code ${res.status} looking up "${registry}:${name}" - ${res.statusText}${importedFrom(parentUrl)}`);
  }
}
