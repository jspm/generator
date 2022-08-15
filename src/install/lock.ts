import { IImportMap } from "@jspm/import-map";
import { throwInternalError } from "../common/err.js";
import { isPlain, isURL, relativeUrl, resolveUrl } from "../common/url.js";
import { Resolver } from "../trace/resolver.js";
import { InstallTarget } from "./installer.js";
import { PackageTarget, newPackageTarget, PackageConfig, parsePkg, ExactPackage } from "./package.js";
// @ts-ignore
import sver from 'sver';
import { getPackageConfig } from "../generator.js";
const { Semver, SemverRange } = sver;

export interface LockEntry {
  pkgUrl: string;
  subpath: `./${string}` | null;
  target: PackageTarget;
}

export interface LockResolutions {
  primary: {
    [pkgName: string]: InstalledResolution;
  };
  secondary: {
    [pkgUrl: `${string}/`]: {
      [pkgName: string]: InstalledResolution;
    }
  };
  // resolutions on non-package boundaries due to scope flattening which conflate version information
  // for example you might have separate export subpaths resolving different versions of the same package
  // FlatInstalledResolution[] captures this flattened variation of install resolutions while still
  // being keyed by the root scope + package name lookup
  flattened: {
    [scopeUrl: `${string}/`]: {
      [pkgName: string]: FlatInstalledResolution[];
    }
  };
}

export interface VersionConstraints {
  primary: {
    [pkgName: string]: PackageTarget;
  };
  secondary: {
    [pkgUrl: `${string}/`]: {
      [pkgName: string]: PackageTarget;
    }
  }
}

export interface InstalledResolution {
  installUrl: `${string}/`;
  installSubpath: `./${string}` | null;
}

export interface FlatInstalledResolution {
  export: `.${string}`;
  resolution: InstalledResolution;
}

export function pruneResolutions (resolutions: LockResolutions, to: [string, string | null][]): LockResolutions {
  const newResolutions: LockResolutions = { primary: Object.create(null), secondary: Object.create(null), flattened: Object.create(null) };
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

export function getResolution (resolutions: LockResolutions, name: string, pkgScope: string | null, flattenedSubpath: `.${string}` | null): InstalledResolution | null {
  if (pkgScope && !pkgScope.endsWith('/'))
    throwInternalError(pkgScope);
  if (!pkgScope)
    return resolutions.primary[name] || null;
  const scope = resolutions.secondary[pkgScope];
  if (scope)
    return scope[name] || null;
  // no current scope -> check the flattened scopes
  if (flattenedSubpath) {
    for (const scopeUrl of Object.keys(resolutions.flattened).sort((a, b) => a.length > b.length ? -1 : 1) as `${string}/`[]) {
      if (!pkgScope.startsWith(scopeUrl))
        continue;
      const flatResolutions = resolutions.flattened[scopeUrl][name];
      if (!flatResolutions)
        continue;
      for (const flatResolution of flatResolutions) {
        if (flatResolution.export === flattenedSubpath ||
            flatResolution.export.endsWith('/') && flattenedSubpath.startsWith(flatResolution.export)) {
          return flatResolution.resolution;
        }
      }
    }
  }
}

export function setConstraint (constraints: VersionConstraints, name: string, target: PackageTarget, pkgScope: string | null = null) {
  if (pkgScope === null)
    constraints.primary[name] = target;
  else
    (constraints.secondary[pkgScope] = constraints.secondary[pkgScope] || Object.create(null))[name] = target;
}

export function setResolution (resolutions: LockResolutions, name: string, installUrl: `${string}/`, pkgScope: string | null = null, installSubpath: `./${string}` | null = null) {
  if (pkgScope && !pkgScope.endsWith('/'))
    throwInternalError(pkgScope);
  if (pkgScope === null) {
    const existing = resolutions.primary[name];
    if (existing && existing.installUrl === installUrl && existing.installSubpath === installSubpath)
      return false;
    resolutions.primary[name] = { installUrl, installSubpath };
    return true;
  }
  else {
    resolutions.secondary[pkgScope] = resolutions.secondary[pkgScope] || {};
    const existing = resolutions.secondary[pkgScope][name];
    if (existing && existing.installUrl === installUrl && existing.installSubpath === installSubpath)
      return false;
    resolutions.secondary[pkgScope][name] = { installUrl, installSubpath };
    return true;
  }
}

export function extendLock (resolutions: LockResolutions, newResolutions: LockResolutions) {
  for (const pkg of Object.keys(newResolutions.primary)) {
    resolutions.primary[pkg] = newResolutions.primary[pkg];
  }
  for (const pkgUrl of Object.keys(newResolutions.secondary)) {
    if (resolutions[pkgUrl])
      Object.assign(resolutions[pkgUrl] = Object.create(null), newResolutions[pkgUrl]);
    else
      resolutions.secondary[pkgUrl] = newResolutions.secondary[pkgUrl];
  }
  for (const scopeUrl of Object.keys(newResolutions.flattened)) {
    if (resolutions[scopeUrl])
      Object.assign(resolutions[scopeUrl], newResolutions[scopeUrl]);
    else
      resolutions.flattened[scopeUrl] = newResolutions.flattened[scopeUrl];
  }
}

export function extendConstraints (constraints: VersionConstraints, newConstraints: VersionConstraints) {
  for (const pkg of Object.keys(newConstraints.primary)) {
    constraints.primary[pkg] = newConstraints.primary[pkg];
  }
  for (const pkgUrl of Object.keys(newConstraints.secondary)) {
    if (constraints[pkgUrl])
      Object.assign(constraints[pkgUrl] = Object.create(null), newConstraints[pkgUrl]);
    else
      constraints.secondary[pkgUrl] = newConstraints.secondary[pkgUrl];
  }
}

function toVersionConstraints (pcfg: PackageConfig, pkgUrl: URL, defaultRegistry = 'npm', includeDev = false) {
  const constraints: Record<string, InstallTarget> = Object.create(null);
  
  if (pcfg.dependencies)
    for (const name of Object.keys(pcfg.dependencies)) {
      constraints[name] = newPackageTarget(pcfg.dependencies[name], pkgUrl, defaultRegistry, name);
    }

  if (pcfg.peerDependencies)
    for (const name of Object.keys(pcfg.peerDependencies)) {
      if (name in constraints) continue;
      constraints[name] = newPackageTarget(pcfg.peerDependencies[name], pkgUrl, defaultRegistry, name);
    }

  if (pcfg.optionalDependencies)
    for (const name of Object.keys(pcfg.optionalDependencies)) {
      if (name in constraints) continue;
      constraints[name] = newPackageTarget(pcfg.optionalDependencies[name], pkgUrl, defaultRegistry, name);
    }
  if (includeDev && pcfg.devDependencies)
    for (const name of Object.keys(pcfg.devDependencies)) {
      if (name in constraints) continue;
      constraints[name] = newPackageTarget(pcfg.devDependencies[name], pkgUrl, defaultRegistry, name);
    }
  return constraints;
}

function packageTargetFromExact (pkg: ExactPackage, permitDowngrades = false): PackageTarget {
  const { registry, name, version } = pkg;
  const v = new Semver(version);
  if (v.tag)
    return { registry, name, ranges: [new SemverRange(version)], unstable: false };;
  if (permitDowngrades) {
    if (v.major !== 0)
      return { registry, name, ranges: [new SemverRange(v.major) ], unstable: false};
    if (v.minor !== 0)
      return { registry, name, ranges: [new SemverRange(v.major + '.' + v.minor) ], unstable: false };
    return { registry, name, ranges: [new SemverRange(version) ], unstable: false };
  }
  else {
    return { registry, name, ranges: [new SemverRange('^' + version)], unstable: false };
  }
}

export interface PackageInstall {
  alias: string;
  pkgScope: string | null;
  ranges: any[];
}

export function getInstallsFor (constraints: VersionConstraints, registry: string, name: string) {
  const installs: PackageInstall[] = [];
  for (const alias of Object.keys(constraints.primary)) {
    const target = constraints.primary[alias];
    if (target.registry === registry && target.name === name)
      installs.push({ alias, pkgScope: null, ranges: target.ranges });
  }
  for (const pkgScope of Object.keys(constraints.secondary)) {
    const scope = constraints.secondary[pkgScope];
    for (const alias of Object.keys(scope)) {
      const target = scope[alias];
      if (target.registry === registry && target.name === name)
        installs.push({ alias, pkgScope, ranges: target.ranges });
    }
  }
  return installs;
}

export async function extractLockConstraintsAndMap (map: IImportMap, preloadUrls: string[], mapUrl: URL, rootUrl: URL | null, defaultRegistry: string, resolver: Resolver): Promise<{ lock: LockResolutions, constraints: VersionConstraints, maps: IImportMap }> {
  const lock: LockResolutions = { primary: Object.create(null), secondary: Object.create(null), flattened: Object.create(null) };
  const maps: IImportMap = { imports: Object.create(null), scopes: Object.create(null) };

  // Primary version constraints taken from the map configuration base (if found)
  const primaryBase = await resolver.getPackageBase(mapUrl.href);
  const primaryPcfg = await resolver.getPackageConfig(primaryBase);
  const constraints = {
    primary: primaryPcfg ? toVersionConstraints(primaryPcfg, new URL(primaryBase), defaultRegistry, true) : Object.create(null),
    secondary: Object.create(null)
  };

  const pkgUrls = new Set<string>();
  for (const key of Object.keys(map.imports || {})) {
    let resolvedKey, targetUrl;
    if (isPlain(key)) {
      const parsed = parsePkg(key);
      resolvedKey = parsed.pkgName;
      targetUrl = resolveUrl(map.imports[key], mapUrl, rootUrl);
      if (targetUrl) {
        const providerPkg = resolver.parseUrlPkg(targetUrl);
        const pkgUrl = providerPkg ? resolver.pkgToUrl(providerPkg.pkg, providerPkg.source) : await resolver.getPackageBase(targetUrl);
        pkgUrls.add(pkgUrl);
        const exportSubpath = await resolver.hasExportResolution(pkgUrl, parsed.subpath, targetUrl, key);
        if (exportSubpath) {
          if (key[0] !== '#') {
            // If there is no constraint, we just make one as the semver major on the current version
            if (!constraints.primary[resolvedKey])
              constraints.primary[resolvedKey] = providerPkg ? packageTargetFromExact(providerPkg.pkg) : pkgUrl;
            // In the case of subpaths having diverging versions, we force convergence on one version
            // Only scopes permit unpacking
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
    const scopePkgUrl = await resolver.getPackageBase(resolvedScopeUrl);
    const flattenedScope = new URL(scopePkgUrl).pathname === '/';
    pkgUrls.add(scopePkgUrl);
    const scope = map.scopes[scopeUrl];
    for (const key of Object.keys(scope)) {
      let resolvedKey, targetUrl;
      if (isPlain(key)) {
        const parsed = parsePkg(key);
        resolvedKey = parsed.pkgName;
        targetUrl = resolveUrl(scope[key], mapUrl, rootUrl);
        if (targetUrl) {
          const providerPkg = resolver.parseUrlPkg(targetUrl);
          const pkgUrl = providerPkg ? resolver.pkgToUrl(providerPkg.pkg, providerPkg.source) : await resolver.getPackageBase(targetUrl);
          pkgUrls.add(pkgUrl);
          const exportSubpath = await resolver.hasExportResolution(pkgUrl, parsed.subpath, targetUrl, key);
          if (exportSubpath) {
            if (key[0] !== '#') {
              if (flattenedScope) {
                const flattened = (lock.flattened[scopePkgUrl] = lock.flattened[scopePkgUrl] || {});
                flattened[resolvedKey] = flattened[resolvedKey] || [];
                flattened[resolvedKey].push({
                  export: parsed.subpath,
                  resolution: {
                    installUrl: pkgUrl,
                    installSubpath: exportSubpath === true ? null : exportSubpath
                  }
                })
              }
              else {
                setResolution(lock, resolvedKey, pkgUrl, scopePkgUrl, exportSubpath === true ? null : exportSubpath);
              }
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

  // for every package we resolved, add their package constraints into the list of constraints
  await Promise.all([...pkgUrls].map(async pkgUrl => {
    if (!isURL(pkgUrl)) return;
    const pcfg = await getPackageConfig(pkgUrl);
    if (pcfg)
      constraints.secondary[pkgUrl] = toVersionConstraints(pcfg, new URL(pkgUrl), defaultRegistry, false);
  }));

  // TODO: allow preloads to inform used versions somehow
  // for (const url of preloadUrls) {
  //   const resolved = resolveUrl(url, mapUrl, rootUrl).href;
  //   const providerPkg = resolver.parseUrlPkg(resolved);
  //   if (providerPkg) {
  //     const pkgUrl = await resolver.getPackageBase(mapUrl.href);
  //   }
  // }

  return { lock, constraints, maps };
}
