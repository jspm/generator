import { JspmError } from '../common/err.js';
import { importedFrom } from '../common/url.js';
import { ExactPackage, LatestPackageTarget } from '../install/package.js';
import { Resolver } from '../trace/resolver.js';
import { Provider } from './index.js';
import { SemverRange } from 'sver';

export function createNpmLookupFunction (registryHost: `${string}/`): Provider['resolveLatestTarget'] {
  let resolveCache: Record<
    string,
    {
      latest: Promise<ExactPackage | null>;
      majors: Record<string, Promise<ExactPackage | null>>;
      minors: Record<string, Promise<ExactPackage | null>>;
      tags: Record<string, Promise<ExactPackage | null>>;
    }
  > = {};

  // function clearResolveCache() {
  //   resolveCache = {};
  // }

  async function resolveLatestTarget(
    this: Resolver,
    target: LatestPackageTarget,
    layer: string,
    parentUrl: string
  ): Promise<ExactPackage | null> {
    const { registry, name, range, unstable } = target;
  
    // exact version optimization
    if (range.isExact && !range.version.tag) {
      const pkg = { registry, name, version: range.version.toString() };
      return pkg;
    }
  
    const cache = (resolveCache[target.registry + ":" + target.name] =
      resolveCache[target.registry + ":" + target.name] || {
        latest: null,
        majors: Object.create(null),
        minors: Object.create(null),
        tags: Object.create(null),
      });
  
    if (range.isWildcard || (range.isExact && range.version.tag === "latest")) {
      let lookup = await (cache.latest ||
        (cache.latest = lookupRange.call(
          this,
          registry,
          name,
          "",
          unstable,
          parentUrl
        )));
      // Deno wat?
      if (lookup instanceof Promise) lookup = await lookup;
      if (!lookup) return null;
      this.log(
        "jspm/resolveLatestTarget",
        `${target.registry}:${target.name}@${range} -> WILDCARD ${
          lookup.version
        }${parentUrl ? " [" + parentUrl + "]" : ""}`
      );
      return lookup;
    }
    if (range.isExact && range.version.tag) {
      const tag = range.version.tag;
      let lookup = await (cache.tags[tag] ||
        (cache.tags[tag] = lookupRange.call(
          this,
          registry,
          name,
          tag,
          unstable,
          parentUrl
        )));
      // Deno wat?
      if (lookup instanceof Promise) lookup = await lookup;
      if (!lookup) return null;
      this.log(
        "jspm/resolveLatestTarget",
        `${target.registry}:${target.name}@${range} -> TAG ${tag}${
          parentUrl ? " [" + parentUrl + "]" : ""
        }`
      );
      return lookup;
    }
    let stableFallback = false;
    if (range.isMajor) {
      const major = range.version.major;
      let lookup = await (cache.majors[major] ||
        (cache.majors[major] = lookupRange.call(
          this,
          registry,
          name,
          major,
          unstable,
          parentUrl
        )));
      // Deno wat?
      if (lookup instanceof Promise) lookup = await lookup;
      if (!lookup) return null;
      // if the latest major is actually a downgrade, use the latest minor version (fallthrough)
      // note this might miss later major prerelease versions, which should strictly be supported via a pkg@X@ unstable major lookup
      if (range.version.gt(lookup.version)) {
        stableFallback = true;
      } else {
        this.log(
          "jspm/resolveLatestTarget",
          `${target.registry}:${target.name}@${range} -> MAJOR ${lookup.version}${
            parentUrl ? " [" + parentUrl + "]" : ""
          }`
        );
        return lookup;
      }
    }
    if (stableFallback || range.isStable) {
      const minor = `${range.version.major}.${range.version.minor}`;
      let lookup = await (cache.minors[minor] ||
        (cache.minors[minor] = lookupRange.call(
          this,
          registry,
          name,
          minor,
          unstable,
          parentUrl
        )));
      // in theory a similar downgrade to the above can happen for stable prerelease ranges ~1.2.3-pre being downgraded to 1.2.2
      // this will be solved by the pkg@X.Y@ unstable minor lookup
      // Deno wat?
      if (lookup instanceof Promise) lookup = await lookup;
      if (!lookup) return null;
      this.log(
        "jspm/resolveLatestTarget",
        `${target.registry}:${target.name}@${range} -> MINOR ${lookup.version}${
          parentUrl ? " [" + parentUrl + "]" : ""
        }`
      );
      return lookup;
    }
    return null;
  }
    
  async function lookupRange(
    this: Resolver,
    registry: string,
    name: string,
    range: string,
    unstable: boolean,
    parentUrl?: string
  ): Promise<ExactPackage | null> {
    const versions = await fetchVersions(name);
    const semverRange = new SemverRange(String(range) || "*", unstable);
    const version = semverRange.bestMatch(versions, unstable);

    if (version) {
      return { registry, name, version: version.toString() };
    }
    throw new JspmError(
      `Unable to resolve ${registry}:${name}@${range} to a valid version${importedFrom(
        parentUrl
      )}`
    );
  }
  
  const versionsCacheMap = new Map<string, string[]>();
  
  async function fetchVersions(name: string): Promise<string[]> {
    if (versionsCacheMap.has(name)) {
      return versionsCacheMap.get(name);
    }
    console.log(`${registryHost}${encodeURI(name)}`);
    const registryLookup = await (
      await fetch(`${registryHost}${encodeURI(name)}`, {})
    ).json();
    const versions = Object.keys(registryLookup.versions || {});
    versionsCacheMap.set(name, versions);
  
    return versions;
  }
  
  return resolveLatestTarget;
}
