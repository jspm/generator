import { baseUrl } from "./common/url.js";
import { isPackageTarget, toPackageTarget } from "./install/package.js";
import TraceMap from './tracemap/tracemap.js';

export interface GeneratorOptions {
  mapUrl?: URL | string;
  defaultProvider?: string,
  env?: string[]
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

  async install (name: string, targetStr?: string): Promise<void> {
    const finishInstall = await this.traceMap.startInstall();
    try {
      let module: string;
      if (isPackageTarget(targetStr || name)) {
        const { alias, target, subpath } = await toPackageTarget(targetStr || name, this.mapUrl.href);
        await this.traceMap.add(alias, target);
        module = targetStr ? name : alias + subpath.slice(1);
        await this.traceMap.trace(module, this.mapUrl);
      }
      else {
        await this.traceMap.add(name, new URL(targetStr || name, baseUrl));
        module = name;
      }
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
