import { baseUrl } from "./common/url.js";
import { toPackageTarget } from "./install/package.js";
import TraceMap from './tracemap/tracemap.js';

export interface GeneratorOptions {
  mapUrl?: URL | string;
  defaultProvider?: string,
  env?: string[]
}

export interface Install {
  alias?: string;
  subpath?: '.' | `./${string}`;
  target: string;
}

export class Generator {
  private traceMap: TraceMap;
  private mapUrl: URL;

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

  async install (target: string): Promise<void>;
  async install (install: string | Install): Promise<void> {
    if (typeof install === 'string')
      install = { target: install };
    if (typeof install.target !== 'string')
      throw new Error('Install requires a "target".');
    if (install.subpath !== undefined && (typeof install.subpath !== 'string' || (install.subpath !== '.' && !install.subpath.startsWith('./'))))
      throw new Error('Install subpath must be equal to "." or start with "./".');
    const finishInstall = await this.traceMap.startInstall();
    try {
      const { alias, target, subpath } = await toPackageTarget(install.target, this.mapUrl.href);
      await this.traceMap.add(install.alias || alias, target);
      const module = (install.alias || alias) + (install.subpath || subpath).slice(1);
      await this.traceMap.trace(module, this.mapUrl);
    }
    finally {
      await finishInstall(true);
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
