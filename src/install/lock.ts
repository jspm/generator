import { IImportMap } from "@jspm/import-map";
import { throwInternalError } from "../common/err.js";
import { isPlain, relativeUrl, resolveUrl } from "../common/url.js";
import { getPackageBase } from "../generator.js";
import { Resolver } from "../trace/resolver.js";
import { parsePkg } from "./package.js";

export interface LockResolutions {
  primary: {
    [pkgName: string]: string
  },
  secondary: {
    [pkgUrl: string]: {
      [pkgName: string]: string;
    }
  }
}

export interface InstalledResolution {
  installUrl: string;
  installSubpath: `./${string}` | null;
}

export function normalizeLock (resolutions: LockResolutions, baseUrl: URL) {
  const outResolutions: LockResolutions = { primary: Object.create(null), secondary: Object.create(null) };
  for (const key of Object.keys(resolutions.primary)) {
    outResolutions.primary[key] = relativeUrl(new URL(resolutions.primary[key]), baseUrl);
  }
  for (const pkgUrl of Object.keys(resolutions.secondary)) {
    const normalizedPkgUrl = relativeUrl(new URL(pkgUrl), baseUrl);
    const pkgResolutions = outResolutions.secondary[normalizedPkgUrl] = {};
    for (const key of Object.keys(resolutions.secondary[pkgUrl])) {
      pkgResolutions[key] = relativeUrl(new URL(resolutions.secondary[pkgUrl][key]), baseUrl);
    }
  }
  return outResolutions;
}

export function resolveLock (resolutions: LockResolutions, baseUrl: URL) {
  const outResolutions: LockResolutions = { primary: Object.create(null), secondary: Object.create(null) };
  for (const key of Object.keys(resolutions.primary)) {
    outResolutions.primary[key] = new URL(resolutions.primary[key], baseUrl).href;
  }
  for (const pkgUrl of Object.keys(resolutions.secondary)) {
    const resolvedPkgUrl = new URL(pkgUrl, baseUrl).href;
    const pkgResolutions = outResolutions.secondary[resolvedPkgUrl] = {};
    for (const key of Object.keys(resolutions.secondary[pkgUrl])) {
      pkgResolutions[key] = new URL(resolutions.secondary[pkgUrl][key], baseUrl).href;
    }
  }
  return outResolutions;
}

export function pruneResolutions (resolutions: LockResolutions, to: [string, string | null][]): LockResolutions {
  const newResolutions: LockResolutions = { primary: Object.create(null), secondary: Object.create(null) };
  for (const [name, parent] of to) {
    if (!parent) {
      newResolutions.primary[name] = resolutions.primary[name];
    }
    else {
      newResolutions[parent] = newResolutions[parent] || {};
      newResolutions[parent][name] = resolutions.secondary[parent][name];
    }
  }
  return newResolutions;
}

export function getResolution (resolutions: LockResolutions, name: string, pkgScope: string | null = null): InstalledResolution | null {
  if (pkgScope && !pkgScope.endsWith('/'))
    throwInternalError(pkgScope);
  const resolution = (!pkgScope ? resolutions.primary : resolutions.secondary[pkgScope] || {})[name];
  if (!resolution)
    return null;
  let [installUrl, installSubpath = null] = resolution.split('|') as [string, `./${string}` | null];
  if (installSubpath) {
    installUrl += '/';
    if (!installSubpath.startsWith('./'))
      installSubpath = `./${installSubpath}`;
  }
  return { installUrl, installSubpath };
}

function stringResolution (resolution: string, subpath: string | null) {
  if (!resolution.endsWith('/'))
    throwInternalError(resolution);
  if (subpath && subpath.startsWith('./'))
    subpath = subpath.slice(2);
  return subpath ? resolution.slice(0, -1) + '|' + subpath : resolution;
}

export function setResolution (resolutions: LockResolutions, name: string, resolution: string, pkgScope: string | null = null, subpath: string | null = null) {
  if (pkgScope && !pkgScope.endsWith('/'))
    throwInternalError(pkgScope);
  const strResolution = stringResolution(resolution, subpath);
  if (pkgScope === null) {
    if (resolutions.primary[name] === strResolution)
      return false;
    resolutions.primary[name] = strResolution;
    return true;
  }
  resolutions.secondary[pkgScope] = resolutions.secondary[pkgScope] || {};
  if (resolutions.secondary[pkgScope][name] === strResolution)
    return false;
  resolutions.secondary[pkgScope][name] = strResolution;
  return true;
}

export function extendLock (resolutions: LockResolutions, newResolutions: LockResolutions) {
  for (const pkg of Object.keys(newResolutions.primary)) {
    resolutions.primary[pkg] = newResolutions.primary[pkg];
  }
  for (const pkgUrl of Object.keys(newResolutions.secondary)) {
    if (resolutions[pkgUrl])
      Object.assign(resolutions[pkgUrl] = {}, newResolutions[pkgUrl]);
    else
      resolutions.secondary[pkgUrl] = newResolutions.secondary[pkgUrl];
  }
}

export async function extractLockAndMap (map: IImportMap, preloadUrls: string[], mapUrl: URL, rootUrl: URL | null, resolver: Resolver): Promise<{ lock: LockResolutions, maps: IImportMap }> {
  const lock: LockResolutions = { primary: Object.create(null), secondary: Object.create(null) };
  const maps: IImportMap = { imports: Object.create(null), scopes: Object.create(null) };

  for (const key of Object.keys(map.imports || {})) {
    let resolvedKey, targetUrl;
    if (isPlain(key)) {
      const parsed = parsePkg(key);
      resolvedKey = parsed.pkgName;
      targetUrl = resolveUrl(map.imports[key], mapUrl, rootUrl);
      if (targetUrl) {
        const providerPkg = resolver.parseUrlPkg(targetUrl);
        const pkgUrl = providerPkg ? resolver.pkgToUrl(providerPkg.pkg, providerPkg.source) : await getPackageBase(targetUrl);
        const exportSubpath = await resolver.hasExportResolution(pkgUrl, parsed.subpath, targetUrl, key);
        if (exportSubpath) {
          if (key[0] !== '#') {
            setResolution(lock, resolvedKey, pkgUrl, null, exportSubpath === true ? null : exportSubpath);
          }
          continue;
        }
      }
    }
    else {
      resolvedKey = resolveUrl(key, mapUrl, rootUrl);
    }
    maps.imports[resolvedKey] = targetUrl ?? map.imports[key];
  }

  for (const scopeUrl of Object.keys(map.scopes || {})) {
    const resolvedScopeUrl = resolveUrl(scopeUrl, mapUrl, rootUrl) ?? scopeUrl;
    const scope = map.scopes[scopeUrl];
    for (const key of Object.keys(scope)) {
      let resolvedKey, targetUrl;
      if (isPlain(key)) {
        const parsed = parsePkg(key);
        resolvedKey = parsed.pkgName;
        targetUrl = resolveUrl(scope[key], mapUrl, rootUrl);
        if (targetUrl) {
          const providerPkg = resolver.parseUrlPkg(targetUrl);
          const pkgUrl = providerPkg ? resolver.pkgToUrl(providerPkg.pkg, providerPkg.source) : await getPackageBase(targetUrl);
          const exportSubpath = await resolver.hasExportResolution(pkgUrl, parsed.subpath, targetUrl, key);
          if (exportSubpath) {
            if (key[0] !== '#') {
              const scopePkgUrl = await resolver.getPackageBase(resolvedScopeUrl);
              setResolution(lock, resolvedKey, pkgUrl, scopePkgUrl, exportSubpath === true ? null : exportSubpath);
            }
            continue;
          }
        }  
      }
      else {
        resolvedKey = resolveUrl(key, mapUrl, rootUrl);
      }
      (maps.scopes[resolvedScopeUrl] = maps.scopes[resolvedScopeUrl] || Object.create(null))[key] = targetUrl ?? scope[key];
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