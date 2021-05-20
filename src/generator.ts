import { baseUrl } from "./common/url.js";
import { toPackageTarget } from "./install/package.js";
import TraceMap from './tracemap/tracemap.js';
import { LockResolutions } from './install/installer.js';
import { clearCache as clearFetchCache } from './common/fetch.js';
import { createLogger, LogStream } from './common/log.js';
import { Resolver } from "./install/resolver.js";

export interface GeneratorOptions {
  mapUrl?: URL | string;
  defaultProvider?: string;
  env?: string[];
  cache?: string | boolean;
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
  private traceMap: TraceMap;
  private mapUrl: URL;
  private finishInstall: (success: boolean) => Promise<boolean | { pjsonChanged: boolean, lock: LockResolutions }> | null = null;
  private installCnt = 0;

  logStream: LogStream;

  constructor ({
    mapUrl = baseUrl,
    env = ['browser', 'development'],
    defaultProvider = 'jspm',
    cache = true
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
    if (!this.mapUrl.pathname.endsWith('/'))
      this.mapUrl = new URL('./', this.mapUrl);
    this.traceMap = new TraceMap(this.mapUrl, {
      stdlib: '@jspm/core@2',
      env,
      defaultProvider
    }, log, resolver);
  }

  async install (install: string | Install | (string | Install)[]): Promise<void> {
    if (Array.isArray(install))
      return await Promise.all(install.map(install => this.install(install))).then(() => {});
    if (arguments.length !== 1)
      throw new Error('Install takes a single target string or object.');
    if (typeof install === 'string')
      install = { target: install };
    if (typeof install.target !== 'string')
      throw new Error('All installs require a "target".');
    if (install.subpaths !== undefined) {
      install.subpaths.every(subpath => {
        if (typeof subpath !== 'string' || (subpath !== '.' && !subpath.startsWith('./')))
          throw new Error(`Install subpath "${subpath}" must be equal to "." or start with "./".`);
      });
      return await Promise.all(install.subpaths.map(subpath => this.install({
        target: (install as Install).target,
        alias: (install as Install).alias,
        subpath
      }))).then(() => {});
    }
    if (install.subpath !== undefined && (typeof install.subpath !== 'string' || (install.subpath !== '.' && !install.subpath.startsWith('./')))) {
      throw new Error(`Install subpath "${install.subpath}" must be equal to "." or start with "./".`);
    }
    if (this.installCnt++ === 0)
      this.finishInstall = await this.traceMap.startInstall();
    try {
      const { alias, target, subpath } = await toPackageTarget(this.traceMap.resolver, install.target, this.mapUrl.href);
      await this.traceMap.add(install.alias || alias, target);
      const module = (install.alias || alias) + (install.subpath || subpath).slice(1);
      await this.traceMap.trace(module, this.mapUrl);
    }
    finally {
      if (--this.installCnt === 0)
        await this.finishInstall(true);
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
