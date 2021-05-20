// @ts-ignore
import sver from 'sver';
const { Semver } = sver;
import { Log } from '../common/log.js';
// @ts-ignore
import { builtinModules } from 'module';
// @ts-ignore
import { fileURLToPath } from 'url';
import { Resolver } from "./resolver.js";
import { ExactPackage, newPackageTarget, PackageTarget } from "./package.js";
import { isURL, importedFrom } from "../common/url.js";
import { JspmError, throwInternalError } from "../common/err.js";
import { DependenciesField, updatePjson } from './pjson.js';
// @ts-ignore
import path from 'path';

export const builtinSet = new Set<string>(builtinModules);

export interface PackageInstall {
  name: string;
  pkgUrl: string;
}

export interface PackageInstallRange {
  pkg: ExactPackage;
  target: PackageTarget;
  install: PackageInstall;
}

export type InstallTarget = PackageTarget | URL;

export interface LockFile {
  exists: boolean;
  resolutions: LockResolutions;
}

export interface LockResolutions {
  [pkgUrl: string]: Record<string, string>;
}

export interface InstallOptions {
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

  defaultProvider?: string;
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

// function getResolution (resolutions: LockResolutions, name: string, pkgUrl: string): string | undefined {
//   if (!pkgUrl.endsWith('/'))
//     throwInternalError(pkgUrl);
//   resolutions[pkgUrl] = resolutions[pkgUrl] || {};
//   return resolutions[pkgUrl][name];
// }

function setResolution (resolutions: LockResolutions, name: string, pkgUrl: string, resolution: string) {
  if (!pkgUrl.endsWith('/'))
    throwInternalError(pkgUrl);
  resolutions[pkgUrl] = resolutions[pkgUrl] || {};
  resolutions[pkgUrl][name] = resolution;
}

export class Installer {
  opts: InstallOptions;
  installs: LockResolutions;
  installing = false;
  newInstalls = false;
  currentInstall = Promise.resolve();
  // @ts-ignore
  stdlibTarget: InstallTarget = new URL('../../core/dist', import.meta.url);
  installBaseUrl: string;
  lockfilePath: string;
  added = new Map<string, InstallTarget>();
  hasLock = false;
  defaultProvider = { provider: 'jspm', layer: 'default' };
  log: Log;
  resolver: Resolver;

  constructor (baseUrl: URL, opts: InstallOptions, log: Log, resolver: Resolver) {
    this.log = log;
    this.resolver = resolver;
    this.installBaseUrl = baseUrl.href;
    this.opts = opts;
    this.lockfilePath = fileURLToPath(this.installBaseUrl + 'jspm.lock');
    let resolutions: LockResolutions = {};
    if (opts.lock)
      ({ resolutions, exists: this.hasLock } = opts.lock);
    if (opts.defaultProvider)
      this.defaultProvider = {
        provider: opts.defaultProvider.split('.')[0],
        layer: opts.defaultProvider.split('.')[1] || 'default'
      };

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

        const save = this.opts.save || this.opts.saveDev || this.opts.savePeer || this.opts.saveOptional || this.hasLock || this.opts.lock;

        // update the package.json dependencies
        let pjsonChanged = false;
        const saveField: DependenciesField = this.opts.saveDev ? 'devDependencies' : this.opts.savePeer ? 'peerDependencies' : this.opts.saveOptional ? 'optionalDependencies' : 'dependencies';
        if (saveField && save) {
          pjsonChanged = await updatePjson(this.resolver, this.installBaseUrl, async pjson => {
            pjson[saveField!] = pjson[saveField!] || {};
            for (const [name, target] of this.added) {
              if (target instanceof URL) {
                if (target.protocol === 'file:') {
                  pjson[saveField!]![name] = 'file:' + path.relative(fileURLToPath(this.installBaseUrl), fileURLToPath(target));
                }
                else {
                  pjson[saveField!]![name] = target.href;
                }
              }
              else {
                let versionRange = target.ranges.map(range => range.toString()).join(' || ');
                if (versionRange === '*') {
                  const pcfg = await this.resolver.getPackageConfig(this.installs[this.installBaseUrl][target.name]);
                  if (pcfg)
                    versionRange = '^' + pcfg?.version;
                }
                pjson[saveField!]![name] = (target.name === name ? '' : target.registry + ':' + target.name + '@') + versionRange;
              }
            }
          });
        }

        // prune the lockfile to the include traces only
        // this is done after pjson updates to include any adds
        if (this.opts.prune || pjsonChanged) {
          const deps = await this.resolver.getDepList(this.installBaseUrl, true);
          // existing deps is any existing builtin resolutions
          const existingBuiltins = new Set(Object.keys(this.installs[this.installBaseUrl] || {}).filter(name => builtinSet.has(name)));
          await this.lockInstall([...new Set([...deps, ...existingBuiltins])], this.installBaseUrl, true);
        }

        this.installing = false;
        resolve();
        return { pjsonChanged, lock: this.installs };
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

  replace (target: InstallTarget, replacePkgUrl: string): boolean {
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
      targetUrl = this.resolver.pkgToUrl(pkg, this.defaultProvider);
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

    if (this.opts.freeze) {
      const existingInstall = this.getBestMatch(target);
      if (existingInstall) {
        this.log('install', `${pkgName} ${pkgScope} -> ${existingInstall.registry}:${existingInstall.name}@${existingInstall.version}`);
        const pkgUrl = this.resolver.pkgToUrl(existingInstall, this.defaultProvider);
        setResolution(this.installs, pkgName, pkgScope, pkgUrl);
        return pkgUrl;
      }
    }

    const latest = await this.resolver.resolveLatestTarget(target, false, this.defaultProvider, parentUrl);
    const installed = await this.getInstalledPackages(target);
    const restrictedToPkg = await this.tryUpgradePackagesTo(latest, installed);

    // cannot upgrade to latest -> stick with existing resolution (if compatible)
    if (restrictedToPkg && !this.opts.latest) {
      this.log('install', `${pkgName} ${pkgScope} -> ${restrictedToPkg.registry}:${restrictedToPkg.name}@${restrictedToPkg.version}`);
      const pkgUrl = this.resolver.pkgToUrl(restrictedToPkg, this.defaultProvider);
      setResolution(this.installs, pkgName, pkgScope, pkgUrl);
      return pkgUrl;
    }

    this.log('install', `${pkgName} ${pkgScope} -> ${latest.registry}:${latest.name}@${latest.version}`);
    const pkgUrl = this.resolver.pkgToUrl(latest, this.defaultProvider);
    setResolution(this.installs, pkgName, pkgScope, pkgUrl);
    return pkgUrl;
  }

  async install (pkgName: string, pkgUrl: string, parentUrl: string = this.installBaseUrl): Promise<string> {
    if (!this.installing)
      throwInternalError('Not installing');
    if (!this.opts.reset) {
      const existingUrl = this.installs[pkgUrl]?.[pkgName];
      if (existingUrl && !this.opts.reset)
        return existingUrl;
    }

    const pcfg = await this.resolver.getPackageConfig(pkgUrl) || {};

    // package dependencies
    const installTarget = pcfg.dependencies?.[pkgName] || pcfg.peerDependencies?.[pkgName] || pcfg.optionalDependencies?.[pkgName] || pcfg.devDependencies?.[pkgName];
    if (installTarget) {
      const target = newPackageTarget(installTarget, pkgUrl, pkgName);
      return this.installTarget(pkgName, target, pkgUrl, false, parentUrl);
    }

    // import map "imports"
    if (this.installs[this.installBaseUrl]?.[pkgName])
      return this.installs[this.installBaseUrl][pkgName];

    // node.js core
    if (builtinSet.has(pkgName)) {
      const target = this.stdlibTarget;
      const resolution = (await this.installTarget(pkgName, target, pkgUrl, false, parentUrl)).slice(0, -1) + '|nodelibs/' + pkgName;
      setResolution(this.installs, pkgName, pkgUrl, resolution);
      return resolution;
    }

    // global install fallback
    const target = newPackageTarget('*', pkgUrl, pkgName);
    const exactInstall = await this.installTarget(pkgName, target, pkgUrl, true, parentUrl);
    return exactInstall;
  }

  private async getInstalledPackages (_pkg: InstallTarget): Promise<PackageInstallRange[]> {
    // TODO: to finish up version deduping algorithm, we need this
    // operation to search for all existing installs in this.installs
    // that have a target matching the given package
    // This is done by checking their package.json and seeing if the package.json target range
    // contains this target range
    return [];
  }

  private getBestMatch (matchPkg: PackageTarget): ExactPackage | null {
    let bestMatch: ExactPackage | null = null;
    for (const pkgUrl of Object.keys(this.installs)) {
      const pkg = this.resolver.parseUrlPkg(pkgUrl);
      if (pkg && this.inRange(pkg, matchPkg)) {
        if (bestMatch)
          bestMatch = Semver.compare(new Semver(bestMatch.version), pkg.version) === -1 ? pkg : bestMatch;
        else
          bestMatch = pkg;
      }
    }
    return bestMatch;
  }

  private inRange (pkg: ExactPackage, target: PackageTarget) {
    return pkg.registry === target.registry && pkg.name === target.name && target.ranges.some(range => range.has(pkg.version, true));
  }

  // upgrade any existing packages to this package if possible
  private tryUpgradePackagesTo (pkg: ExactPackage, installed: PackageInstallRange[]): ExactPackage | undefined {
    if (this.opts.freeze) return;
    const pkgVersion = new Semver(pkg.version);
    let hasUpgrade = false;
    for (const version of new Set(installed.map(({ pkg }) => pkg.version))) {
      let hasVersionUpgrade = true;
      for (const { pkg, target } of installed) {
        if (pkg.version !== version) continue;
        // user out-of-version lock
        if (!this.opts.reset && !target.ranges.some(range => range.has(pkg.version, true))) {
          hasVersionUpgrade = false;
          continue;
        }
        if (pkgVersion.lt(pkg.version) || !target.ranges.some(range => range.has(pkgVersion, true))) {
          hasVersionUpgrade = false;
          continue;
        }
      }
      if (hasVersionUpgrade) hasUpgrade = true;
      if (hasUpgrade || this.opts.latest) {
        for (const { pkg, install } of installed) {
          if (pkg.version !== version) continue;
          setResolution(this.installs, install.name, install.pkgUrl, this.resolver.pkgToUrl(pkg, this.defaultProvider));
        }
      }
    }
  }
}
