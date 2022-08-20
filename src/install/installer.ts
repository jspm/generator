import sver from 'sver';
const { Semver, SemverRange } = sver;
import { Log } from '../common/log.js';
import { Resolver } from "../trace/resolver.js";
import { ExactPackage, newPackageTarget, PackageTarget, pkgToStr } from "./package.js";
import { isURL } from "../common/url.js";
import { JspmError, throwInternalError } from "../common/err.js";
import { nodeBuiltinSet } from '../providers/node.js';
import { parseUrlPkg } from '../providers/jspm.js';
import { getFlattenedResolution, getInstallsFor, getResolution, InstalledResolution, LockResolutions, PackageInstall, pruneResolutions, setConstraint, setResolution, VersionConstraints } from './lock.js';
import { registryProviders } from '../providers/index.js';

export interface PackageProvider {
  provider: string;
  layer: string;
}

export type InstallTarget = PackageTarget | URL;

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
  installs: LockResolutions;
  constraints: VersionConstraints;
  installing = false;
  newInstalls = false;
  // @ts-ignore
  stdlibTarget: InstallTarget;
  installBaseUrl: `${string}/`;
  added = new Map<string, InstallTarget>();
  hasLock = false;
  defaultProvider = { provider: 'jspm', layer: 'default' };
  defaultRegistry = 'npm';
  providers: Record<string, string>;
  resolutions: Record<string, string>;
  log: Log;
  resolver: Resolver;

  constructor (baseUrl: `${string}/`, opts: InstallOptions, log: Log, resolver: Resolver) {
    this.log = log;
    this.resolver = resolver;
    this.resolutions = opts.resolutions || {};
    this.installBaseUrl = baseUrl;
    this.opts = opts;
    this.hasLock = !!opts.lock;
    this.installs = opts.lock || { primary: Object.create(null), secondary: Object.create(null), flattened: Object.create(null) };
    this.constraints = { primary: Object.create(null), secondary: Object.create(null) };
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
        this.stdlibTarget = newPackageTarget(opts.stdlib, new URL(this.installBaseUrl), this.defaultRegistry);
      }
    }
  }

  visitInstalls (visitor: (scope: Record<string, InstalledResolution>, scopeUrl: string | null) => boolean | void) {
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
    const visitInstall = async (name: string, pkgUrl: `${string}/`): Promise<void> => {
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

  replace (target: InstallTarget, replacePkgUrl: `${string}/`, provider: PackageProvider): boolean {
    let targetUrl: string;
    if (target instanceof URL) {
      targetUrl = target.href;
    }
    else {
      const pkg = this.getBestExistingMatch(target);
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
        if (scope[name].installUrl === targetUrl) {
          scope[name].installUrl = replacePkgUrl;
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

  async installTarget (pkgName: string, target: InstallTarget, mode: 'new-primary' | 'existing-primary' | 'new-secondary' | 'existing-secondary', pkgScope: `${string}/` | null, parentUrl: string): Promise<InstalledResolution> {
    if (mode.endsWith('-primary') && pkgScope !== null) {
      throw new Error('Should have null scope for secondary');
    }
    if (mode.endsWith('-secondary') && pkgScope === null) {
      // throw new Error('Should not have null scope for secondary');
    }
    if (this.opts.freeze && mode.startsWith('existing'))
      throw new JspmError(`"${pkgName}" is not installed in the current map to freeze install, imported from ${parentUrl}.`, 'ERR_NOT_INSTALLED');

    // resolutions are authoritative at the top-level
    if (this.resolutions[pkgName]) {
      const resolutionTarget = newPackageTarget(this.resolutions[pkgName], this.opts.baseUrl, this.defaultRegistry, pkgName);
      if (JSON.stringify(target) !== JSON.stringify(resolutionTarget))
        return this.installTarget(pkgName, resolutionTarget, mode, pkgScope, parentUrl);
    }

    if (target instanceof URL) {
      this.log('install', `${pkgName} ${pkgScope} -> ${target.href}`);
      const installUrl = target.href + (target.href.endsWith('/') ? '' : '/') as `${string}/`;
      this.newInstalls = setResolution(this.installs, pkgName, installUrl, pkgScope);
      return { installUrl, installSubpath: null };
    }

    const provider = this.getProvider(target);

    if ((this.opts.freeze || mode.startsWith('existing') || mode.endsWith('secondary')) && !this.opts.latest) {
      const pkg = this.getBestExistingMatch(target);
      if (pkg) {
        this.log('install', `${pkgName} ${pkgScope} -> ${pkg} (existing match)`);
        const installUrl = this.resolver.pkgToUrl(pkg, provider);
        this.newInstalls = setResolution(this.installs, pkgName, installUrl, pkgScope);
        setConstraint(this.constraints, pkgName, target, pkgScope);
        return { installUrl, installSubpath: null };
      }
    }

    const latest = await this.resolver.resolveLatestTarget(target, provider, parentUrl);
    const latestUrl = this.resolver.pkgToUrl(latest.pkg, provider);
    const installed = getInstallsFor(this.constraints, latest.pkg.registry, latest.pkg.name);
    if (!this.opts.freeze && !this.tryUpgradeAllTo(latest.pkg, latestUrl, installed)) {
      if (!mode.endsWith('-primary') && !this.opts.latest) {
        const pkg = this.getBestExistingMatch(target);
        // cannot upgrade to latest -> stick with existing resolution (if compatible)
        if (pkg) {
          this.log('install', `${pkgName} ${pkgScope} -> ${pkg.registry}:${pkg.name}@${pkg.version} (existing match not latest)`);
          const installUrl = this.resolver.pkgToUrl(pkg, provider);
          this.newInstalls = setResolution(this.installs, pkgName, installUrl, pkgScope, latest.subpath);
          setConstraint(this.constraints, pkgName, target, pkgScope);
          return { installUrl, installSubpath: latest.subpath };
        }
      }
    }

    this.log('install', `${pkgName} ${pkgScope} -> ${latest.pkg.registry}:${latest.pkg.name}@${latest.pkg.version} ${latest.subpath ? latest.subpath : '<no-subpath>'} (latest)`);
    this.newInstalls = setResolution(this.installs, pkgName, latestUrl, pkgScope, latest.subpath);
    setConstraint(this.constraints, pkgName, target, pkgScope);
    this.upgradeSupportedTo(latest.pkg, latestUrl, installed);
    return { installUrl: latestUrl, installSubpath: latest.subpath };
  }

  async install (pkgName: string, mode: 'new-primary' | 'new-secondary' | 'existing-primary' | 'existing-secondary', pkgScope: `${string}/` | null = null, flattenedSubpath: `.${string}` | null = null, nodeBuiltins = true, parentUrl: string = this.installBaseUrl): Promise<InstalledResolution> {
    if (mode.endsWith('-primary') && pkgScope !== null) {
      throw new Error('Should have null scope for primary');
    }
    if (mode.endsWith('-secondary') && pkgScope === null) {
      // throw new Error('Should not have null scope for secondary');
    }
    if (!this.installing)
      throwInternalError('Not installing');

    if (this.resolutions[pkgName])
      return this.installTarget(pkgName, newPackageTarget(this.resolutions[pkgName], this.opts.baseUrl, this.defaultRegistry, pkgName), mode, pkgScope, parentUrl);

    if (!this.opts.reset) {
      const existingResolution = getResolution(this.installs, pkgName, pkgScope);
      if (existingResolution)
        return existingResolution;
      // flattened resolution cascading for secondary
      if (mode === 'existing-secondary' && !this.opts.latest || mode === 'new-secondary' && this.opts.freeze) {
        const flattenedResolution = getFlattenedResolution(this.installs, pkgName, pkgScope, flattenedSubpath);
        // resolved flattened resolutions become real resolutions as they get picked up
        if (flattenedResolution) {
          this.newInstalls = setResolution(this.installs, pkgName, flattenedResolution.installUrl, pkgScope, flattenedResolution.installSubpath);
          return flattenedResolution;
        }
      }
    }

    const definitelyPkgScope = pkgScope || await this.resolver.getPackageBase(parentUrl);
    const pcfg = await this.resolver.getPackageConfig(definitelyPkgScope) || {};

    // node.js core
    if (nodeBuiltins && nodeBuiltinSet.has(pkgName)) {
      return this.installTarget(pkgName, { registry: 'node', name: pkgName, ranges: [new SemverRange('*')], unstable: true }, mode, pkgScope, parentUrl);
    }

    // package dependencies
    const installTarget = pcfg.dependencies?.[pkgName] || pcfg.peerDependencies?.[pkgName] || pcfg.optionalDependencies?.[pkgName] || pkgScope === this.installBaseUrl && pcfg.devDependencies?.[pkgName];
    if (installTarget) {
      const target = newPackageTarget(installTarget, new URL(definitelyPkgScope), this.defaultRegistry, pkgName);
      return this.installTarget(pkgName, target, mode, pkgScope, parentUrl);
    }

    // import map "imports"
    if (this.installs.primary[pkgName])
      return getResolution(this.installs, pkgName, null);

    // global install fallback
    const target = newPackageTarget('*', new URL(definitelyPkgScope), this.defaultRegistry, pkgName);
    const exactInstall = await this.installTarget(pkgName, target, mode, pkgScope, parentUrl);
    return exactInstall;
  }

  // Note: maintain this live instead of recomputing
  private get pkgUrls () {
    const pkgUrls = new Set<string>();
    for (const pkgUrl of Object.values(this.installs.primary)) {
      pkgUrls.add(pkgUrl.installUrl);
    }
    for (const scope of Object.keys(this.installs.secondary) as `${string}/`[]) {
      for (const { installUrl } of Object.values(this.installs.secondary[scope])) {
        pkgUrls.add(installUrl);
      }
    }
    for (const flatScope of Object.keys(this.installs.flattened) as `${string}/`[]) {
      for (const { resolution: { installUrl }} of Object.values(this.installs.flattened[flatScope]).flat()) {
        pkgUrls.add(installUrl);
      }
    }
    return pkgUrls;
  }

  private getBestExistingMatch (matchPkg: PackageTarget): ExactPackage | null {
    let bestMatch: ExactPackage | null = null;
    for (const pkgUrl of this.pkgUrls) {
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

  // upgrade all existing packages to this package if possible
  private tryUpgradeAllTo (pkg: ExactPackage, pkgUrl: `${string}/`, installed: PackageInstall[]): boolean {
    const pkgVersion = new Semver(pkg.version);

    let allCompatible = true;
    for (const { ranges } of installed) {
      if (ranges.every(range => !range.has(pkgVersion)))
        allCompatible = false;
    }

    if (!allCompatible)
      return false;

    // if every installed version can support this new version, update them all
    for (const { alias, pkgScope } of installed) {
      const resolution = getResolution(this.installs, alias, pkgScope);
      if (!resolution)
        continue;
      const { installSubpath } = resolution;
      this.newInstalls = setResolution(this.installs, alias, pkgUrl, pkgScope, installSubpath);
    }

    return true;
  }

  // upgrade some exsiting packages to the new install
  private upgradeSupportedTo (pkg: ExactPackage, pkgUrl: `${string}/`, installed: PackageInstall[]) {
    const pkgVersion = new Semver(pkg.version);
    for (const { alias, pkgScope, ranges } of installed) {
      const resolution = getResolution(this.installs, alias, pkgScope);
      if (!resolution)
        continue;
      if (!ranges.some(range => range.has(pkgVersion, true)))
        continue;
      const { installSubpath } = resolution;
      this.newInstalls = setResolution(this.installs, alias, pkgUrl, pkgScope, installSubpath);
    }
  }
}
