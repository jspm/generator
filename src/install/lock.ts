import { IImportMap } from "@jspm/import-map";
import { throwInternalError } from "../common/err.js";
import { isPlain, relativeUrl, resolveUrl } from "../common/url.js";
import { getPackageBase } from "../generator.js";
import { Resolver } from "../trace/resolver.js";
import { parsePkg } from "./package.js";

export interface LockResolutions {
  [pkgUrl: string]: Record<string, string>;
}

export function normalizeLock (resolutions: LockResolutions, baseUrl: URL) {
  const outResolutions: LockResolutions = {};
  for (const pkgUrl of Object.keys(resolutions)) {
    const normalizedPkgUrl = relativeUrl(new URL(pkgUrl), baseUrl);
    const pkgResolutions = outResolutions[normalizedPkgUrl] = {};
    for (const key of Object.keys(resolutions[pkgUrl])) {
      pkgResolutions[key] = relativeUrl(new URL(resolutions[pkgUrl][key]), baseUrl);
    }
  }
  return outResolutions;
}

export function resolveLock (resolutions: LockResolutions, baseUrl: URL) {
  const outResolutions: LockResolutions = {};
  for (const pkgUrl of Object.keys(resolutions)) {
    const resolvedPkgUrl = new URL(pkgUrl, baseUrl).href;
    const pkgResolutions = outResolutions[resolvedPkgUrl] = {};
    for (const key of Object.keys(resolutions[pkgUrl])) {
      pkgResolutions[key] = new URL(resolutions[pkgUrl][key], baseUrl).href;
    }
  }
  return outResolutions;
}

export function pruneResolutions (resolutions: LockResolutions, to: [string, string][]): LockResolutions {
  const newResolutions: LockResolutions = {};
  for (const [name, parent] of to) {
    const resolution = resolutions[parent][name];
    newResolutions[parent] = newResolutions[parent] || {};
    newResolutions[parent][name] = resolution;
  }
  return newResolutions;
}

export function getResolution (resolutions: LockResolutions, name: string, pkgUrl: string): string | undefined {
  if (!pkgUrl.endsWith('/'))
    throwInternalError(pkgUrl);
  resolutions[pkgUrl] = resolutions[pkgUrl] || {};
  return resolutions[pkgUrl][name];
}

export function stringResolution (resolution: string, subpath: string | null) {
  if (!resolution.endsWith('/'))
    throwInternalError(resolution);
  return subpath ? resolution.slice(0, -1) + '|' + subpath : resolution;
}

export function setResolution (resolutions: LockResolutions, name: string, pkgUrl: string, resolution: string, subpath: string | null) {
  if (!pkgUrl.endsWith('/'))
    throwInternalError(pkgUrl);
  resolutions[pkgUrl] = resolutions[pkgUrl] || {};
  const strResolution = stringResolution(resolution, subpath);
  if (resolutions[pkgUrl][name] === strResolution)
    return false;
  resolutions[pkgUrl][name] = strResolution;
  return true;
}

export async function extractLockAndMap (map: IImportMap, preloadUrls: string[], mapUrl: URL, rootUrl: URL, resolver: Resolver): Promise<{ lock: LockResolutions, maps: IImportMap }> {
  const lock: LockResolutions = {};
  const maps: IImportMap = { imports: Object.create(null), scopes: Object.create(null) };

  const mapBase = await resolver.getPackageBase(mapUrl.href);

  for (const key of Object.keys(map.imports || {})) {
    const targetUrl = resolveUrl(map.imports[key], mapUrl, rootUrl).href;
    const providerPkg = resolver.parseUrlPkg(targetUrl);
    const resolvedKey = isPlain(key) ? key : resolveUrl(key, mapUrl, rootUrl).href;
    const pkgUrl = providerPkg ? resolver.pkgToUrl(providerPkg.pkg, providerPkg.source) : await getPackageBase(targetUrl);
    const parsed = isPlain(key) ? parsePkg(key) : null;
    if (parsed && await resolver.hasExportResolution(pkgUrl, parsed.subpath, targetUrl, key)) {
      // TODO: lockfile should really now be based on primary and scoped
      if (key[0] !== '#') {
        setResolution(lock, resolvedKey, mapBase, pkgUrl, '');
      }
    }
    else {
      maps.imports[resolvedKey] = targetUrl;
    }
  }

  for (const scopeUrl of Object.keys(map.scopes || {})) {
    const resolvedScopeUrl = resolveUrl(scopeUrl, mapUrl, rootUrl).href;
    const scope = map.scopes[scopeUrl];
    for (const key of Object.keys(scope)) {
      const targetUrl = resolveUrl(scope[key], mapUrl, rootUrl).href;
      const providerPkg = resolver.parseUrlPkg(targetUrl);
      const resolvedKey = isPlain(key) ? key : resolveUrl(key, mapUrl, rootUrl).href;
      const pkgUrl = providerPkg ? resolver.pkgToUrl(providerPkg.pkg, providerPkg.source) : await getPackageBase(targetUrl);
      const parsed = isPlain(key) ? parsePkg(key) : null;
      if (parsed && await resolver.hasExportResolution(pkgUrl, parsed.subpath, targetUrl, key)) {
        if (key[0] !== '#') {
          const scopePkgUrl = await resolver.getPackageBase(resolvedScopeUrl);
          // Should this support the /|nodelibs/process style core syntax?
          setResolution(lock, resolvedKey, scopePkgUrl, pkgUrl, '');
        }
      }
      else {
        (maps.scopes[resolvedScopeUrl] = maps.scopes[resolvedScopeUrl] || Object.create(null))[key] = targetUrl;
      }
    }
  }

  // TODO: allow preloads to inform used versions somehow
  // for (const url of preloadUrls) {
  //   const resolved = resolveUrl(url, mapUrl, rootUrl).href;
  //   const providerPkg = resolver.parseUrlPkg(resolved);
  //   if (providerPkg) {
  //     const pkgUrl = await resolver.getPackageBase(mapUrl.href);
  //   }
  // }

  return { lock, maps };
}