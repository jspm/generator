// @ts-ignore
import sver from 'sver';
const { Semver, SemverRange } = sver;
import { Log } from '../common/log.js';
import { Resolver } from "../trace/resolver.js";
import { ExactPackage, newPackageTarget, PackageTarget } from "./package.js";
import { isURL, importedFrom } from "../common/url.js";
import { JspmError, throwInternalError } from "../common/err.js";
import { nodeBuiltinSet } from '../providers/node.js';
import { Provider } from '../providers/index.js';
import { parseUrlPkg } from '../providers/jspm.js';

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

export interface LockFile {
  exists: boolean;
  resolutions: LockResolutions;
}

export interface LockResolutions {
  [pkgUrl: string]: Record<string, string>;
}

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
  // default base for relative installs
  baseUrl: URL;
  // create a lockfile if it does not exist
  lock?: LockFile;
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
  providers?: Record<string, string>;
}

function pruneResolutions (resolutions: LockResolutions, to: [string, string][]): LockResolutions {
  const newResolutions: LockResolutions = {};
  for (const [name, parent] of to) {
    const resolution = resolutions[parent][name];
    newResolutions[parent] = newResolutions[parent] || {};
    newResolutions[parent][name] = resolution;
  }
  return newResolutions;
}

function getResolution (resolutions: LockResolutions, name: string, pkgUrl: string): string | undefined {
  if (!pkgUrl.endsWith('/'))
    throwInternalError(pkgUrl);
  resolutions[pkgUrl] = resolutions[pkgUrl] || {};
  return resolutions[pkgUrl][name];
}

export function setResolution (resolutions: LockResolutions, name: string, pkgUrl: string, resolution: string) {
  if (!pkgUrl.endsWith('/'))
    throwInternalError(pkgUrl);
  resolutions[pkgUrl] = resolutions[pkgUrl] || {};
  resolutions[pkgUrl][name] = resolution;
}

export class Installer {
  opts: InstallOptions;
  installedRanges: InstalledRanges = {};
  installs: LockResolutions;
  installing = false;
  newInstalls = false;
  currentInstall = Promise.resolve();
  // @ts-ignore
  stdlibTarget: InstallTarget;
  installBaseUrl: string;
  added = new Map<string, InstallTarget>();
  hasLock = false;
  defaultProvider = { provider: 'jspm', layer: 'default' };
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
    let resolutions: LockResolutions = {};
    if (opts.lock)
      ({ resolutions, exists: this.hasLock } = opts.lock);
    if (opts.defaultProvider)
      this.defaultProvider = {
        provider: opts.defaultProvider.split('.')[0],
        layer: opts.defaultProvider.split('.')[1] || 'default'
      };
    this.providers = opts.providers || {};

    this.installs = resolutions;

    if (opts.stdlib) {
      if (isURL(opts.stdlib) || opts.stdlib[0] === '.') {
        this.stdlibTarget = new URL(opts.stdlib, baseUrl);
        if (this.stdlibTarget.href.endsWith('/'))
          this.stdlibTarget.pathname = this.stdlibTarget.pathname.slice(0, -1);
      }
      else {
        this.stdlibTarget = newPackageTarget(opts.stdlib, this.installBaseUrl);
      }
    }
  }

  async startInstall (): Promise<(success: boolean) => Promise<false | { pjsonChanged: boolean, lock: LockResolutions }>> {
    if (this.installing)
      return this.currentInstall.then(() => this.startInstall());
    let finishInstall: (success: boolean) => Promise<false | { pjsonChanged: boolean, lock: LockResolutions }>;
    this.installing = true;
    this.newInstalls = false;
    this.added = new Map<string, InstallTarget>();
    this.currentInstall = new Promise(resolve => {
      finishInstall = async (success: boolean) => {
        if (!success) {
          this.installing = false;
          resolve();
          return false;
        }

        // const save = this.opts.save || this.opts.saveDev || this.opts.savePeer || this.opts.saveOptional || this.hasLock || this.opts.lock;

        // // update the package.json dependencies
        // let pjsonChanged = false;
        // const saveField: DependenciesField = this.opts.saveDev ? 'devDependencies' : this.opts.savePeer ? 'peerDependencies' : this.opts.saveOptional ? 'optionalDependencies' : 'dependencies';
        // if (saveField && save) {
        //   pjsonChanged = await updatePjson(this.resolver, this.installBaseUrl, async pjson => {
        //     pjson[saveField!] = pjson[saveField!] || {};
        //     for (const [name, target] of this.added) {
        //       if (target instanceof URL) {
        //         if (target.protocol === 'file:') {
        //           pjson[saveField!]![name] = 'file:' + path.relative(fileURLToPath(this.installBaseUrl), fileURLToPath(target));
        //         }
        //         else {
        //           pjson[saveField!]![name] = target.href;
        //         }
        //       }
        //       else {
        //         let versionRange = target.ranges.map(range => range.toString()).join(' || ');
        //         if (versionRange === '*') {
        //           const pcfg = await this.resolver.getPackageConfig(this.installs[this.installBaseUrl][target.name]);
        //           if (pcfg)
        //             versionRange = '^' + pcfg?.version;
        //         }
        //         pjson[saveField!]![name] = (target.name === name ? '' : target.registry + ':' + target.name + '@') + versionRange;
        //       }
        //     }
        //   });
        // }

        // // prune the lockfile to the include traces only
        // // this is done after pjson updates to include any adds
        // if (this.opts.prune || pjsonChanged) {
        //   const deps = await this.resolver.getDepList(this.installBaseUrl, true);
        //   // existing deps is any existing builtin resolutions
        //   const existingBuiltins = new Set(Object.keys(this.installs[this.installBaseUrl] || {}).filter(name => nodeBuiltinSet.has(name)));
        //   await this.lockInstall([...new Set([...deps, ...existingBuiltins])], this.installBaseUrl, true);
        // }

        this.installing = false;
        resolve();
        return { pjsonChanged: false, lock: this.installs };
      };
    });
    return finishInstall!;
  }

  async lockInstall (installs: string[], pkgUrl = this.installBaseUrl, prune = true) {
    const visited = new Set<string>();
    const visitInstall = async (name: string, pkgUrl: string): Promise<void> => {
      if (visited.has(name + '##' + pkgUrl))
        return;
      visited.add(name + '##' + pkgUrl);
      const installUrl = await this.install(name, pkgUrl);
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

  async installTarget (pkgName: string, target: InstallTarget, pkgScope: string, pjsonPersist: boolean, parentUrl = pkgScope): Promise<string> {
    if (this.opts.freeze)
      throw new JspmError(`"${pkgName}" is not installed in the jspm lockfile, imported from ${parentUrl}.`, 'ERR_NOT_INSTALLED');

    this.newInstalls = true;

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
      setResolution(this.installs, pkgName, pkgScope, pkgUrl);
      return pkgUrl;
    }

    let provider = this.defaultProvider;
    for (const name of Object.keys(this.providers)) {
      if (target.name.startsWith(name) && (target.name.length === name.length || target.name[name.length] === '/')) {
        provider = { provider: this.providers[name], layer: 'default' };
        const layerIndex = provider.provider.indexOf('.');
        if (layerIndex !== -1) {
          provider.layer = provider.provider.slice(layerIndex + 1);
          provider.provider = provider.provider.slice(0, layerIndex);
        }
        break;
      }
    }

    if (this.opts.freeze) {
      const existingInstall = this.getBestMatch(target);
      if (existingInstall) {
        this.log('install', `${pkgName} ${pkgScope} -> ${existingInstall.registry}:${existingInstall.name}@${existingInstall.version}`);
        const pkgUrl = this.resolver.pkgToUrl(existingInstall, provider);
        setResolution(this.installs, pkgName, pkgScope, pkgUrl);
        addInstalledRange(this.installedRanges, pkgName, pkgScope, target);
        return pkgUrl;
      }
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
      setResolution(this.installs, pkgName, pkgScope, pkgUrl);
      addInstalledRange(this.installedRanges, pkgName, pkgScope, target);
      return pkgUrl;
    }

    this.log('install', `${pkgName} ${pkgScope} -> ${latest.registry}:${latest.name}@${latest.version}`);
    const pkgUrl = this.resolver.pkgToUrl(latest, provider);
    setResolution(this.installs, pkgName, pkgScope, pkgUrl);
    addInstalledRange(this.installedRanges, pkgName, pkgScope, target);
    return pkgUrl;
  }

  async install (pkgName: string, pkgUrl: string, nodeBuiltins = true, parentUrl: string = this.installBaseUrl): Promise<string> {
    if (!this.installing)
      throwInternalError('Not installing');
    if (!this.opts.reset) {
      const existingUrl = this.installs[pkgUrl]?.[pkgName];
      if (existingUrl && !this.opts.reset)
        return existingUrl;
    }

    if (this.resolutions[pkgName]) {
      return this.installTarget(pkgName, newPackageTarget(this.resolutions[pkgName], this.opts.baseUrl.href, pkgName), pkgUrl, false, parentUrl);
    }

    const pcfg = await this.resolver.getPackageConfig(pkgUrl) || {};

    // node.js core
    if (nodeBuiltins && nodeBuiltinSet.has(pkgName)) {
      const target = this.stdlibTarget;
      const resolution = (await this.installTarget(pkgName, target, pkgUrl, false, parentUrl)).slice(0, -1) + '|nodelibs/' + pkgName;
      setResolution(this.installs, pkgName, pkgUrl, resolution);
      return resolution;
    }

    // package dependencies
    const installTarget = pcfg.dependencies?.[pkgName] || pcfg.peerDependencies?.[pkgName] || pcfg.optionalDependencies?.[pkgName] || pcfg.devDependencies?.[pkgName];
    if (installTarget) {
      const target = newPackageTarget(installTarget, pkgUrl, pkgName);
      return this.installTarget(pkgName, target, pkgUrl, false, parentUrl);
    }

    // import map "imports"
    if (this.installs[this.installBaseUrl]?.[pkgName])
      return this.installs[this.installBaseUrl][pkgName];

    // global install fallback
    const target = newPackageTarget('*', pkgUrl, pkgName);
    const exactInstall = await this.installTarget(pkgName, target, pkgUrl, true, parentUrl);
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
        const resolution = getResolution(this.installs, name, pkgUrl).split('|')[0];
        const parsed = parseUrlPkg(resolution);
        if (parsed) {
          const { pkg: { version } } = parseUrlPkg(resolution);
          if (version !== pkg.version)
            setResolution(this.installs, name, pkgUrl, this.resolver.pkgToUrl(pkg, provider));
        }
        else {
          setResolution(this.installs, name, pkgUrl, resolution);
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
          return new URL(resolution);
        }
      }
    }
  }
}
