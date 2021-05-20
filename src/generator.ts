import { baseUrl } from "./common/url.js";
import { toPackageTarget } from "./install/package.js";
import TraceMap from './tracemap/tracemap.js';
import { LockResolutions } from './install/installer.js';
import { clearCache as clearFetchCache } from './common/fetch.js';

export interface GeneratorOptions {
  mapUrl?: URL | string;
  defaultProvider?: string,
  env?: string[]
}

export interface Install {
  target: string;
  subpath?: '.' | `./${string}`;
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

  constructor ({
    mapUrl = baseUrl,
    env = ['browser', 'development'],
    defaultProvider = 'jspm'
  }: GeneratorOptions = {}) {
    this.mapUrl = typeof mapUrl === 'string' ? new URL(mapUrl) : mapUrl;
    if (!this.mapUrl.pathname.endsWith('/'))
      this.mapUrl = new URL('./', this.mapUrl);
    this.traceMap = new TraceMap(this.mapUrl, {
      stdlib: '@jspm/core@2',
      env,
      defaultProvider
    });
  }

  async install (install: string | Install): Promise<void> {
    if (arguments.length !== 1)
      throw new Error('Install takes a single target string or object.');
    if (typeof install === 'string')
      install = { target: install };
    if (typeof install.target !== 'string')
      throw new Error('Install requires a "target".');
    if (install.subpath !== undefined && (typeof install.subpath !== 'string' || (install.subpath !== '.' && !install.subpath.startsWith('./'))))
      throw new Error('Install subpath must be equal to "." or start with "./".');
    if (this.installCnt++ === 0)
      this.finishInstall = await this.traceMap.startInstall();
    try {
      const { alias, target, subpath } = await toPackageTarget(install.target, this.mapUrl.href);
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
