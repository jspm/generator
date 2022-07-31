import sver from 'sver';
const { Semver, SemverRange } = sver;
import { Log } from '../common/log.js';
import { Resolver } from "../trace/resolver.js";
import { ExactPackage, newPackageTarget, PackageTarget } from "./package.js";
import { isURL } from "../common/url.js";
import { JspmError, throwInternalError } from "../common/err.js";
import { nodeBuiltinSet } from '../providers/node.js';
import { parseUrlPkg } from '../providers/jspm.js';
import { getResolution, InstalledResolution, LockResolutions, pruneResolutions, setResolution } from './lock.js';
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
  pkgScope: string | null;
  target: PackageTarget;
}

export type InstallTarget = PackageTarget | URL;

export interface InstalledRanges {
  [exactName: string]: PackageInstallRange[];
}

function addInstalledRange (installedRanges: InstalledRanges, name: string, target: PackageTarget, pkgScope: string | null) {
  const ranges = getInstalledRanges(installedRanges, target);
  for (const range of ranges) {
    if (range.name === name && range.pkgScope === pkgScope)
      return;
  }
  ranges.push({ name, pkgScope, target });
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
    this.installs = opts.lock || { primary: Object.create(null), secondary: Object.create(null) };
    if (opts.defaultRegistry)
      this.defaultRegistry = opts.defaultRegistry;
    if (opts.defaultProvider)
      this.defaultProvider = {
        provider: opts.defaultProvider.split('.')[0],
        layer: opts.defaultProvider.split('.')[1] || 'default'
      };
    this.providers = Object.assign({}, registryProviders);
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

  visitInstalls (visitor: (scope: Record<string, string>, scopeUrl: string | null) => boolean | void) {
    if (visitor(this.installs.primary, null))
      return;
    for (const scopeUrl of Object.keys(this.installs.secondary)) {
      if (visitor(this.installs.secondary[scopeUrl], scopeUrl))
        return;
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
      const { installUrl } = await this.install(name, pkgUrl === this.installBaseUrl ? 'existing-primary' : 'existing-secondary', pkgUrl);
      const deps = await this.resolver.getDepList(installUrl);
      const existingDeps = Object.keys(this.installs.secondary[installUrl] || {});
      await Promise.all([...new Set([...deps, ...existingDeps])].map(dep => visitInstall(dep, installUrl)));
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
        if (this.installs.secondary[replacePkgUrl])
          return false;
        throw new Error('No installation found to replace.');
      }
      targetUrl = this.resolver.pkgToUrl(pkg, provider);
    }

    let replaced = false;
    this.visitInstalls((scope, pkgUrl) => {
      for (const name of Object.keys(scope)) {
        if (scope[name] === targetUrl) {
          scope[name] = replacePkgUrl;
          replaced = true;
        }
      }
      if (pkgUrl === targetUrl) {
        this.installs.secondary[replacePkgUrl] = this.installs.secondary[pkgUrl];
        delete this.installs.secondary[pkgUrl];
        replaced = true;
      }
    });
    return replaced;
  }

  getProvider (target: PackageTarget) {
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
    return provider;
  }

  async installTarget (pkgName: string, target: InstallTarget, mode: 'new-primary' | 'existing-primary' | 'new-secondary' | 'existing-secondary', pkgScope: string | null, parentUrl: string): Promise<InstalledResolution> {
    if (mode.endsWith('-primary') && pkgScope !== null) {
      throw new Error('Should have null scope for primary');
    }
    if (mode.endsWith('-secondary') && pkgScope === null) {
      throw new Error('Should not have null scope for secondary');
    }
    if (this.opts.freeze && mode.startsWith('existing'))
      throw new JspmError(`"${pkgName}" is not installed in the jspm lockfile, imported from ${parentUrl}.`, 'ERR_NOT_INSTALLED');

    if (target instanceof URL) {
      this.log('install', `${pkgName} ${pkgScope} -> ${target.href}`);
      const installUrl = target.href + (target.href.endsWith('/') ? '' : '/');
      this.newInstalls = setResolution(this.installs, pkgName, installUrl, pkgScope);
      return { installUrl, installSubpath: null };
    }

    const provider = this.getProvider(target);

    if ((this.opts.freeze || mode.startsWith('existing') || mode.endsWith('secondary')) && !this.opts.latest) {
      const pkgUrl = this.getBestMatch(target);
      if (pkgUrl) {
        this.log('install', `${pkgName} ${pkgScope} -> ${pkgUrl} (existing match)`);
        const installUrl = this.resolver.pkgToUrl(pkgUrl, provider);
        this.newInstalls = setResolution(this.installs, pkgName, installUrl, pkgScope);
        addInstalledRange(this.installedRanges, pkgName, target, pkgScope);
        // if (!(this.stdlibTarget instanceof URL) && this.inRange(existingInstall, this.stdlibTarget)) {
        //   console.log('Matched stdlib');
        // }
        return { installUrl, installSubpath: null };
      }
    }

    // resolutions are authoritative at the top-level
    if (this.resolutions[pkgName]) {
      const resolutionTarget = newPackageTarget(this.resolutions[pkgName], this.opts.baseUrl.href, this.defaultRegistry, pkgName);
      if (JSON.stringify(target) !== JSON.stringify(resolutionTarget))
        return this.installTarget(pkgName, resolutionTarget, mode, pkgScope, parentUrl);
    }

    const latest = await this.resolver.resolveLatestTarget(target, false, provider, parentUrl);
    const installed = getInstalledRanges(this.installedRanges, target);
    const restrictedToPkg = this.tryUpgradePackagesTo(latest.pkg, installed, provider);

    // cannot upgrade to latest -> stick with existing resolution (if compatible)
    if (!mode.endsWith('-primary') && restrictedToPkg && !this.opts.latest) {
      if (restrictedToPkg instanceof URL)
        this.log('install', `${pkgName} ${pkgScope} -> ${restrictedToPkg.href} (existing match custom package)`);
      else
        this.log('install', `${pkgName} ${pkgScope} -> ${restrictedToPkg.registry}:${restrictedToPkg.name}@${restrictedToPkg.version} (existing match not latest)`);
      const installUrl = restrictedToPkg instanceof URL ? restrictedToPkg.href : this.resolver.pkgToUrl(restrictedToPkg, provider);
      this.newInstalls = setResolution(this.installs, pkgName, installUrl, pkgScope, latest.subpath);
      addInstalledRange(this.installedRanges, pkgName, target, pkgScope);
      return { installUrl, installSubpath: latest.subpath };
    }

    this.log('install', `${pkgName} ${pkgScope} -> ${latest.pkg.registry}:${latest.pkg.name}@${latest.pkg.version} ${latest.subpath ? latest.subpath : '<no-subpath>'} (latest)`);
    const installUrl = this.resolver.pkgToUrl(latest.pkg, provider);
    this.newInstalls = setResolution(this.installs, pkgName, installUrl, pkgScope, latest.subpath);
    addInstalledRange(this.installedRanges, pkgName, target, pkgScope);
    return { installUrl, installSubpath: latest.subpath };
  }

  async install (pkgName: string, mode: 'new-primary' | 'new-secondary' | 'existing-primary' | 'existing-secondary', pkgScope: string | null = null, nodeBuiltins = true, parentUrl: string = this.installBaseUrl): Promise<InstalledResolution> {
    if (mode.endsWith('-primary') && pkgScope !== null) {
      throw new Error('Should have null scope for primary');
    }
    if (mode.endsWith('-secondary') && pkgScope === null) {
      throw new Error('Should not have null scope for secondary');
    }
    if (!this.installing)
      throwInternalError('Not installing');
    if (!this.opts.reset) {
      const existingUrl = getResolution(this.installs, pkgName, pkgScope);
      if (existingUrl && !this.opts.reset)
        return existingUrl;
    }

    if (this.resolutions[pkgName]) {
      return this.installTarget(pkgName, newPackageTarget(this.resolutions[pkgName], this.opts.baseUrl.href, this.defaultRegistry, pkgName), mode, pkgScope, parentUrl);
    }

    // resolution scope cascading for existing only
    if (mode === 'existing-secondary' && !this.opts.reset) {
      for (const parentScope of enumerateParentScopes(pkgScope)) {
        const resolution = getResolution(this.installs, pkgName, parentScope);
        if (resolution)
          return resolution;
      }
    }

    if (!pkgScope)
      pkgScope = await this.resolver.getPackageBase(parentUrl);

    const pcfg = await this.resolver.getPackageConfig(pkgScope) || {};

    if (mode.endsWith('-primary'))
      mode = mode.replace('-primary', '-secondary') as 'new-secondary' | 'existing-secondary';

    // node.js core
    if (nodeBuiltins && nodeBuiltinSet.has(pkgName)) {
      return this.installTarget(pkgName, { registry: 'node', name: pkgName, ranges: [new SemverRange('*')] }, mode, pkgScope, parentUrl);
    }

    // package dependencies
    const installTarget = pcfg.dependencies?.[pkgName] || pcfg.peerDependencies?.[pkgName] || pcfg.optionalDependencies?.[pkgName] || pkgScope === this.installBaseUrl && pcfg.devDependencies?.[pkgName];
    if (installTarget) {
      const target = newPackageTarget(installTarget, pkgScope, this.defaultRegistry, pkgName);
      return this.installTarget(pkgName, target, mode, pkgScope, parentUrl);
    }

    // import map "imports"
    if (this.installs.primary[pkgName])
      return getResolution(this.installs, pkgName, null);

    // global install fallback
    const target = newPackageTarget('*', pkgScope, this.defaultRegistry, pkgName);
    const exactInstall = await this.installTarget(pkgName, target, mode, pkgScope, parentUrl);
    return exactInstall;
  }

  private pkgUrls () {
    const pkgUrls = new Set<string>();
    for (const pkgUrl of Object.values(this.installs.primary)) {
      pkgUrls.add(pkgUrl.split('|')[0]);
    }
    for (const scope of Object.keys(this.installs.secondary)) {
      for (const pkgUrl of Object.values(this.installs.secondary[scope])) {
        pkgUrls.add(pkgUrl.split('|')[0]);
      }
    }
    return pkgUrls;
  }

  private getBestMatch (matchPkg: PackageTarget): ExactPackage | null {
    let bestMatch: ExactPackage | null = null;
    for (const pkgUrl of this.pkgUrls()) {
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
  private tryUpgradePackagesTo (pkg: ExactPackage, installed: PackageInstallRange[], provider: PackageProvider): ExactPackage | URL | null {
    if (this.opts.freeze) return;
    const pkgVersion = new Semver(pkg.version);

    let compatible = true;
    for (const { target } of installed) {
      if (target.ranges.every(range => !range.has(pkgVersion)))
        compatible = false;
    }

    if (compatible) {
      for (const { name, pkgScope } of installed) {
        const { installUrl, installSubpath } = getResolution(this.installs, name, pkgScope);
        const parsed = parseUrlPkg(installUrl);
        if (parsed) {
          const { pkg: { version } } = parseUrlPkg(installUrl);
          if (version !== pkg.version)
            this.newInstalls = setResolution(this.installs, name, this.resolver.pkgToUrl(pkg, provider), pkgScope, installSubpath);
        }
        else {
          this.newInstalls = setResolution(this.installs, name, installUrl, pkgScope, installSubpath);
        }
      }
    }
    else {
      // get the latest installed version instead that fulfills target (TODO: sort)
      for (const { name, pkgScope } of installed) {
        const { installUrl } = getResolution(this.installs, name, pkgScope);
        const parsed = parseUrlPkg(installUrl);
        if (parsed) {
          const { pkg: { version } } = parseUrlPkg(installUrl);
          return{ registry: pkg.registry, name: pkg.name, version };
        }
        else {
          return new URL(installUrl.endsWith('/') ? installUrl : installUrl + '/');
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
