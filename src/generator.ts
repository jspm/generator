import { baseUrl } from "./common/url.js";
import { toPackageTarget } from "./install/package.js";
import TraceMap from './tracemap/tracemap.js';
import { LockResolutions } from './install/installer.js';
// @ts-ignore
import { clearCache as clearFetchCache } from '#fetch';
import { createLogger, LogStream } from './common/log.js';
import { Resolver } from "./install/resolver.js";

export interface GeneratorOptions {
  mapUrl?: URL | string;
  defaultProvider?: string;
  env?: string[];
  cache?: string | boolean;
  stdlib?: string;
}

export interface Install {
  target: string;
  subpath?: '.' | `./${string}`;
  subpaths?: ('.' | `./${string}`)[];
  alias?: string;
}

export function clearCache () {
  clearFetchCache();
}

export class Generator {
  traceMap: TraceMap;
  mapUrl: URL;
  finishInstall: (success: boolean) => Promise<boolean | { pjsonChanged: boolean, lock: LockResolutions }> | null = null;
  installCnt = 0;

  logStream: LogStream;

  constructor ({
    mapUrl = baseUrl,
    env = ['browser', 'development', 'module'],
    defaultProvider = 'jspm',
    cache = true,
    stdlib = '@jspm/core'
  }: GeneratorOptions = {}) {
    let fetchOpts = undefined;
    if (cache === 'offline')
      fetchOpts = { cache: 'force-cache' };
    else if (!cache)
      fetchOpts = { cache: 'no-store' };
    const { log, logStream } = createLogger();
    const resolver = new Resolver(log, fetchOpts);
    this.logStream = logStream;
    this.mapUrl = typeof mapUrl === 'string' ? new URL(mapUrl) : mapUrl;
    if (!this.mapUrl.pathname.endsWith('/')) {
      try {
        this.mapUrl = new URL('./', this.mapUrl);
      } catch {
        this.mapUrl = new URL(this.mapUrl.href + '/');
      }
    }
    this.traceMap = new TraceMap(this.mapUrl, {
      stdlib,
      env,
      defaultProvider
    }, log, resolver);
  }

  async lookup (install: string | Install) {
    const { target, subpath } = await installToTarget.call(this, install);
    if (target instanceof URL)
      throw new Error('URL lookups not supported');
    const resolved = await this.traceMap.resolver.resolveLatestTarget(target, true, this.traceMap.installer.defaultProvider);
    return { subpath, ...resolved };
  }

  async install (install: string | Install | (string | Install)[]): Promise<{ staticDeps: string[], dynamicDeps: string[] }> {
    if (Array.isArray(install))
      return await Promise.all(install.map(install => this.install(install))).then(() => ({
        staticDeps: [...this.traceMap.staticList],
        dynamicDeps: [...this.traceMap.dynamicList]
      }));
    if (arguments.length !== 1)
      throw new Error('Install takes a single target string or object.');
    if (typeof install !== 'string' && install.subpaths !== undefined) {
      install.subpaths.every(subpath => {
        if (typeof subpath !== 'string' || (subpath !== '.' && !subpath.startsWith('./')))
          throw new Error(`Install subpath "${subpath}" must be equal to "." or start with "./".`);
      });
      return await Promise.all(install.subpaths.map(subpath => this.install({
        target: (install as Install).target,
        alias: (install as Install).alias,
        subpath
      }))).then(() => ({ staticDeps: [...this.traceMap.staticList], dynamicDeps: [...this.traceMap.dynamicList] }));
    }
    let error = false;
    if (this.installCnt++ === 0)
      this.finishInstall = await this.traceMap.startInstall();
    try {
      const { alias, target, subpath } = await installToTarget.call(this, install);
      await this.traceMap.add(alias, target);
      await this.traceMap.trace(alias + subpath.slice(1), this.mapUrl);
    }
    catch (e) {
      error = true;
      throw e;
    }
    finally {
      if (--this.installCnt === 0)
        await this.finishInstall(true);
      if (!error)
        return { staticDeps: [...this.traceMap.staticList], dynamicDeps: [...this.traceMap.dynamicList] };
    }
  }

  getMap () {
    const map = this.traceMap.map.clone();
    map.flatten();
    map.rebase();
    map.sort();
    return map.toJSON();
  }
}

async function installToTarget (this: Generator, install: Install | string) {
  if (typeof install === 'string')
    install = { target: install };
  if (typeof install.target !== 'string')
    throw new Error('All installs require a "target".');
  if (install.subpath !== undefined && (typeof install.subpath !== 'string' || (install.subpath !== '.' && !install.subpath.startsWith('./'))))
    throw new Error(`Install subpath "${install.subpath}" must be equal to "." or start with "./".`);
  const { alias, target, subpath } = await toPackageTarget(this.traceMap.resolver, install.target, this.mapUrl.href);
  return {
    alias: install.alias || alias,
    target,
    subpath: install.subpath || subpath
  };
}
