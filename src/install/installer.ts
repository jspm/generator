import sver from 'sver';
const { Semver } = sver;
import { Log } from '../common/log.js';
import { Resolver } from "../trace/resolver.js";
import { ExactPackage, newPackageTarget, PackageTarget } from "./package.js";
import { isURL, importedFrom } from "../common/url.js";
import { JspmError, throwInternalError } from "../common/err.js";
import { nodeBuiltinSet } from '../providers/node.js';
import { parseUrlPkg } from '../providers/jspm.js';
import { getResolution, LockResolutions, pruneResolutions, setResolution, stringResolution } from './lock.js';
import { registryProviders } from '../providers/index.js';

export interface PackageProvider {
  provider: string;
  layer: string;
}

export interface PackageInstall {
  name: string;
  pkgUrl: string;
}

export interface PackageInstallRange {
  name: string;
  pkgUrl: string;
  target: PackageTarget;
}

export type InstallTarget = PackageTarget | URL;

export interface InstalledRanges {
  [exactName: string]: PackageInstallRange[];
}

function addInstalledRange (installedRanges: InstalledRanges, name: string, pkgUrl: string, target: PackageTarget) {
  const ranges = getInstalledRanges(installedRanges, target);
  for (const range of ranges) {
    if (range.name === name && range.pkgUrl === pkgUrl)
      return;
  }
  ranges.push({ name, pkgUrl, target });
}
function getInstalledRanges (installedRanges: InstalledRanges, target: PackageTarget): PackageInstallRange[] {
  return installedRanges[target.registry + ':' + target.name] = installedRanges[target.registry + ':' + target.name] || [];
}

export interface InstallOptions {
  // import map URL
  mapUrl: URL;
  // default base for relative installs
  baseUrl: URL;
  // root URL for inport map root resolution
  rootUrl?: URL | null;
  // create a lockfile if it does not exist
  lock?: LockResolutions;
  // do not modify the lockfile
  freeze?: boolean;
  // force use latest versions for everything we touch
  latest?: boolean;

  // if a resolution is not in its expected range
  // / expected URL (usually due to manual user edits),
  // force override a new install
  reset?: boolean;
  // stdlib target
  stdlib?: string;
  
  // whether to prune the dependency installs
  prune?: boolean;

  // save flags
  save?: boolean;
  saveDev?: boolean;
  savePeer?: boolean;
  saveOptional?: boolean;

  // dependency resolutions overrides
  resolutions?: Record<string, string>;

  defaultProvider?: string;
  defaultRegistry?: string;
  providers?: Record<string, string>;
}

export class Installer {
  opts: InstallOptions;
  installedRanges: InstalledRanges = {};
  installs: LockResolutions;
  installing = false;
  newInstalls = false;
  // @ts-ignore
  stdlibTarget: InstallTarget;
  installBaseUrl: string;
  added = new Map<string, InstallTarget>();
  hasLock = false;
  defaultProvider = { provider: 'jspm', layer: 'default' };
  defaultRegistry = 'npm';
  providers: Record<string, string>;
  resolutions: Record<string, string>;
  log: Log;
  resolver: Resolver;

  constructor (baseUrl: URL, opts: InstallOptions, log: Log, resolver: Resolver) {
    this.log = log;
    this.resolver = resolver;
    this.resolutions = opts.resolutions || {};
    this.installBaseUrl = baseUrl.href;
    this.opts = opts;
    this.hasLock = !!opts.lock;
    this.installs = opts.lock || {};
    if (opts.defaultRegistry)
      this.defaultRegistry = opts.defaultRegistry;
    if (opts.defaultProvider)
      this.defaultProvider = {
        provider: opts.defaultProvider.split('.')[0],
        layer: opts.defaultProvider.split('.')[1] || 'default'
      };
    this.providers = registryProviders;
    if (opts.providers)
      Object.assign(this.providers, opts.providers);

    if (opts.stdlib) {
      if (isURL(opts.stdlib) || opts.stdlib[0] === '.') {
        this.stdlibTarget = new URL(opts.stdlib, baseUrl);
        if (this.stdlibTarget.href.endsWith('/'))
          this.stdlibTarget.pathname = this.stdlibTarget.pathname.slice(0, -1);
      }
      else {
        this.stdlibTarget = newPackageTarget(opts.stdlib, this.installBaseUrl, this.defaultRegistry);
      }
    }
  }

  startInstall () {
    if (this.installing)
      throw new Error('Internal error: already installing');
    this.installing = true;
    this.newInstalls = false;
    this.added = new Map<string, InstallTarget>();
  }

  finishInstall () {
    this.installing = false;
  }

  async lockInstall (installs: string[], pkgUrl = this.installBaseUrl, prune = true) {
    const visited = new Set<string>();
    const visitInstall = async (name: string, pkgUrl: string): Promise<void> => {
      if (visited.has(name + '##' + pkgUrl))
        return;
      visited.add(name + '##' + pkgUrl);
      const installUrl = await this.install(name, 'existing', pkgUrl);
      const installPkgUrl = installUrl.split('|')[0] + (installUrl.indexOf('|') === -1 ? '' : '/');
      const deps = await this.resolver.getDepList(installPkgUrl);
      const existingDeps = Object.keys(this.installs[installPkgUrl] || {});
      await Promise.all([...new Set([...deps, ...existingDeps])].map(dep => visitInstall(dep, installPkgUrl)));
    };
    await Promise.all(installs.map(install => visitInstall(install, pkgUrl)));
    if (prune) {
      const pruneList: [string, string][] = [...visited].map(item => {
        const [name, pkgUrl] = item.split('##');
        return [name, pkgUrl];
      });
      this.installs = pruneResolutions(this.installs, pruneList);
    }
  }

  replace (target: InstallTarget, replacePkgUrl: string, provider: PackageProvider): boolean {
    let targetUrl: string;
    if (target instanceof URL) {
      targetUrl = target.href;
    }
    else {
      const pkg = this.getBestMatch(target);
      if (!pkg) {
        if (this.installs[replacePkgUrl])
          return false;
        throw new Error('No installation found to replace.');
      }
      targetUrl = this.resolver.pkgToUrl(pkg, provider);
    }

    let replaced = false;
    for (const pkgUrl of Object.keys(this.installs)) {
      for (const name of Object.keys(this.installs[pkgUrl])) {
        if (this.installs[pkgUrl][name] === targetUrl) {
          this.installs[pkgUrl][name] = replacePkgUrl;
          replaced = true;
        }
      }
      if (pkgUrl === targetUrl) {
        this.installs[replacePkgUrl] = this.installs[pkgUrl];
        delete this.installs[pkgUrl];
        replaced = true;
      }
    }
    return replaced;
  }

  async installTarget (pkgName: string, target: InstallTarget, mode: 'new' | 'existing', pkgScope: string, pjsonPersist: boolean, subpath: string | null, parentUrl: string): Promise<string> {
    if (this.opts.freeze)
      throw new JspmError(`"${pkgName}" is not installed in the jspm lockfile, imported from ${parentUrl}.`, 'ERR_NOT_INSTALLED');

    if (pjsonPersist) {
      if (pkgScope === this.installBaseUrl && pkgScope.startsWith('file:')) {
        this.added.set(pkgName, target);
      }
      else {
        this.log('info', `Package ${pkgName} not declared in package.json dependencies${importedFrom(parentUrl)}.`);
      }
    }

    if (target instanceof URL) {
      this.log('install', `${pkgName} ${pkgScope} -> ${target.href}`);
      const pkgUrl = target.href + (target.href.endsWith('/') ? '' : '/');
      this.newInstalls = setResolution(this.installs, pkgName, pkgScope, pkgUrl, subpath);
      return stringResolution(pkgUrl, subpath);
    }

    let provider = this.defaultProvider;
    for (const name of Object.keys(this.providers)) {
      if (name.endsWith(':') && target.registry === name.slice(0, -1) || target.name.startsWith(name) && (target.name.length === name.length || target.name[name.length] === '/')) {
        provider = { provider: this.providers[name], layer: 'default' };
        const layerIndex = provider.provider.indexOf('.');
        if (layerIndex !== -1) {
          provider.layer = provider.provider.slice(layerIndex + 1);
          provider.provider = provider.provider.slice(0, layerIndex);
        }
        break;
      }
    }

    if (this.opts.freeze || mode === 'existing') {
      const existingInstall = this.getBestMatch(target);
      if (existingInstall) {
        this.log('install', `${pkgName} ${pkgScope} -> ${existingInstall.registry}:${existingInstall.name}@${existingInstall.version}`);
        const pkgUrl = this.resolver.pkgToUrl(existingInstall, provider);
        this.newInstalls = setResolution(this.installs, pkgName, pkgScope, pkgUrl, subpath);
        addInstalledRange(this.installedRanges, pkgName, pkgScope, target);
        return stringResolution(pkgUrl, subpath);
      }
    }

    // resolutions are authoritative at the top-level
    if (this.resolutions[pkgName]) {
      const resolutionTarget = newPackageTarget(this.resolutions[pkgName], this.opts.baseUrl.href, this.defaultRegistry, pkgName);
      if (JSON.stringify(target) !== JSON.stringify(resolutionTarget))
        return this.installTarget(pkgName, resolutionTarget, mode, pkgScope, pjsonPersist, subpath, parentUrl);
    }

    const latest = await this.resolver.resolveLatestTarget(target, false, provider, parentUrl);
    const installed = getInstalledRanges(this.installedRanges, target);
    const restrictedToPkg = this.tryUpgradePackagesTo(latest, target, installed, provider);

    // cannot upgrade to latest -> stick with existing resolution (if compatible)
    if (restrictedToPkg && !this.opts.latest) {
      if (restrictedToPkg instanceof URL)
        this.log('install', `${pkgName} ${pkgScope} -> ${restrictedToPkg.href}`);
      else
        this.log('install', `${pkgName} ${pkgScope} -> ${restrictedToPkg.registry}:${restrictedToPkg.name}@${restrictedToPkg.version}`);
      const pkgUrl = restrictedToPkg instanceof URL ? restrictedToPkg.href : this.resolver.pkgToUrl(restrictedToPkg, provider);
      this.newInstalls = setResolution(this.installs, pkgName, pkgScope, pkgUrl, subpath);
      addInstalledRange(this.installedRanges, pkgName, pkgScope, target);
      return stringResolution(pkgUrl, subpath);
    }

    this.log('install', `${pkgName} ${pkgScope} -> ${latest.registry}:${latest.name}@${latest.version}`);
    const pkgUrl = this.resolver.pkgToUrl(latest, provider);
    this.newInstalls = setResolution(this.installs, pkgName, pkgScope, pkgUrl, subpath);
    addInstalledRange(this.installedRanges, pkgName, pkgScope, target);
    return stringResolution(pkgUrl, subpath);
  }

  async install (pkgName: string, mode: 'new' | 'existing', pkgUrl: string, nodeBuiltins = true, parentUrl: string = this.installBaseUrl): Promise<string> {
    if (!this.installing)
      throwInternalError('Not installing');
    if (!this.opts.reset) {
      const existingUrl = this.installs[pkgUrl]?.[pkgName];
      if (existingUrl && !this.opts.reset)
        return existingUrl;
    }

    if (this.resolutions[pkgName]) {
      return this.installTarget(pkgName, newPackageTarget(this.resolutions[pkgName], this.opts.baseUrl.href, this.defaultRegistry, pkgName), mode, pkgUrl, false, null, parentUrl);
    }

    // resolution scope cascading for existing only
    if (mode === 'existing' && !this.opts.reset) {
      for (const parentScope of enumerateParentScopes(pkgUrl)) {
        const resolution = this.installs[parentScope]?.[pkgName];
        if (resolution)
          return resolution;
      }
    }

    const pcfg = await this.resolver.getPackageConfig(pkgUrl) || {};

    // node.js core
    if (nodeBuiltins && nodeBuiltinSet.has(pkgName)) {
      return this.installTarget(pkgName, this.stdlibTarget, mode, pkgUrl, false, 'nodelibs/' + pkgName, parentUrl);
    }

    // package dependencies
    const installTarget = pcfg.dependencies?.[pkgName] || pcfg.peerDependencies?.[pkgName] || pcfg.optionalDependencies?.[pkgName] || pkgUrl === this.installBaseUrl && pcfg.devDependencies?.[pkgName];
    if (installTarget) {
      const target = newPackageTarget(installTarget, pkgUrl, this.defaultRegistry, pkgName);
      return this.installTarget(pkgName, target, mode, pkgUrl, false, null, parentUrl);
    }

    // import map "imports"
    if (this.installs[this.installBaseUrl]?.[pkgName])
      return this.installs[this.installBaseUrl][pkgName];

    // global install fallback
    const target = newPackageTarget('*', pkgUrl, this.defaultRegistry, pkgName);
    const exactInstall = await this.installTarget(pkgName, target, mode, pkgUrl, true, null, parentUrl);
    return exactInstall;
  }

  private getBestMatch (matchPkg: PackageTarget): ExactPackage | null {
    let bestMatch: ExactPackage | null = null;
    for (const pkgUrl of Object.keys(this.installs)) {
      const pkg = this.resolver.parseUrlPkg(pkgUrl);
      if (pkg && this.inRange(pkg.pkg, matchPkg)) {
        if (bestMatch)
          bestMatch = Semver.compare(new Semver(bestMatch.version), pkg.pkg.version) === -1 ? pkg.pkg : bestMatch;
        else
          bestMatch = pkg.pkg;
      }
    }
    return bestMatch;
  }

  private inRange (pkg: ExactPackage, target: PackageTarget) {
    return pkg.registry === target.registry && pkg.name === target.name && target.ranges.some(range => range.has(pkg.version, true));
  }

  // upgrade any existing packages to this package if possible
  private tryUpgradePackagesTo (pkg: ExactPackage, target: PackageTarget, installed: PackageInstallRange[], provider: PackageProvider): ExactPackage | URL | undefined {
    if (this.opts.freeze) return;
    const pkgVersion = new Semver(pkg.version);

    let compatible = true;
    for (const { target } of installed) {
      if (target.ranges.every(range => !range.has(pkgVersion)))
        compatible = false;
    }

    if (compatible) {
      for (const { name, pkgUrl } of installed) {
        const [resolution, curSubpath] = getResolution(this.installs, name, pkgUrl).split('|');
        const parsed = parseUrlPkg(resolution);
        if (parsed) {
          const { pkg: { version } } = parseUrlPkg(resolution);
          if (version !== pkg.version)
            this.newInstalls = setResolution(this.installs, name, pkgUrl, this.resolver.pkgToUrl(pkg, provider), curSubpath);
        }
        else {
          this.newInstalls = setResolution(this.installs, name, pkgUrl, resolution, curSubpath);
        }
      }
    }
    else {
      // get the latest installed version instead that fulfills target (TODO: sort)
      for (const { name, pkgUrl } of installed) {
        const resolution = getResolution(this.installs, name, pkgUrl).split('|')[0];
        const parsed = parseUrlPkg(resolution);
        if (parsed) {
          const { pkg: { version } } = parseUrlPkg(resolution);
          if (target.ranges.some(range => range.has(version)))
            return { registry: pkg.registry, name: pkg.name, version };
        }
        else {
          return new URL(resolution.endsWith('/') ? resolution : resolution + '/');
        }
      }
    }
  }
}

function enumerateParentScopes (url: string): string[] {
  const parentScopes: string[] = [];
  let separatorIndex = url.lastIndexOf('/');
  const protocolIndex = url.indexOf('://') + 1;
  if (separatorIndex !== url.length - 1)
    throw new Error('Internal error: expected package URL');
  while ((separatorIndex = url.lastIndexOf('/', separatorIndex - 1)) !== protocolIndex) {
    parentScopes.push(url.slice(0, separatorIndex + 1));
  }
  return parentScopes;
}
