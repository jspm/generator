import { baseUrl } from "./common/url.js";
import { ExactPackage, toPackageTarget } from "./install/package.js";
import TraceMap from './trace/tracemap.js';
import { LockResolutions } from './install/installer.js';
// @ts-ignore
import { clearCache as clearFetchCache, fetch as _fetch } from '#fetch';
import { createLogger, LogStream } from './common/log.js';
import { Resolver } from "./trace/resolver.js";
import { IImportMap } from "@jspm/import-map";
import { Provider } from "./providers/index.js";
import { JspmError } from "./common/err.js";

export interface GeneratorOptions {
  mapUrl?: URL | string;
  rootUrl?: URL | string;
  /**
   * The initial state of the import map that generator operations work on top of.
   */
  inputMap?: IImportMap;
  defaultProvider?: string;
  env?: string[];
  cache?: 'offline' | boolean;
  stdlib?: string;
  customProviders?: Record<string, Provider>;
}

export interface ModuleAnalysis {
  format: 'commonjs' | 'esm' | 'system';
  staticDeps: string[];
  dynamicDeps: string[];
  cjsLazyDeps: string[] | null;
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
  rootUrl: URL | null;
  finishInstall: (success: boolean) => Promise<boolean | { pjsonChanged: boolean, lock: LockResolutions }> | null = null;
  installCnt = 0;

  logStream: LogStream;

  constructor ({
    mapUrl = baseUrl,
    rootUrl = undefined,
    inputMap = undefined,
    env = ['browser', 'development', 'module'],
    defaultProvider = 'jspm',
    customProviders = undefined,
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
    if (customProviders) {
      for (const provider of Object.keys(customProviders)) {
        resolver.addCustomProvider(provider, customProviders[provider]);
      }
    }
    this.logStream = logStream;
    this.mapUrl = typeof mapUrl === 'string' ? new URL(mapUrl, baseUrl) : mapUrl;
    this.rootUrl = typeof rootUrl === 'string' ? new URL(rootUrl, baseUrl) : rootUrl || null;
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
      defaultProvider,
      inputMap,
    }, log, resolver);
  }

  async install (install: string | Install | (string | Install)[]): Promise<{ staticDeps: string[], dynamicDeps: string[] }> {
    this.traceMap.clearLists();
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

  // resolver that uses the internal import map
  resolve (specifier: string, parentUrl: URL | string = baseUrl) {
    if (typeof parentUrl === 'string')
      parentUrl = new URL(parentUrl, baseUrl);
    const resolved = this.traceMap.map.resolve(specifier, parentUrl);
    if (resolved === null)
      throw new JspmError(`Unable to resolve "${specifier}" from ${parentUrl.href}`, 'MODULE_NOT_FOUND');
    return resolved;
  }

  get importMap () {
    return this.traceMap.map;
  }

  getAnalysis (url: string | URL): ModuleAnalysis {
    if (typeof url !== 'string')
      url = url.href;
    const trace = this.traceMap.tracedUrls[url];
    if (!trace)
      throw new Error(`The URL ${url} has not been traced by this generator instance.`);
    return {
      format: trace.format,
      staticDeps: Object.keys(trace.deps),
      dynamicDeps: Object.keys(trace.dynamicDeps),
      cjsLazyDeps: trace.cjsLazyDeps
    };
  }

  getMap () {
    const map = this.traceMap.map.clone();
    // this can be moved to the end on next update (using getMapInstance)
    map.flatten();
    if (this.rootUrl)
      map.rebase(this.rootUrl.href, true);
    else
      map.rebase();
    map.sort();
    return map.toJSON();
  }
}

export interface LookupOptions {
  provider?: string;
  cache?: 'offline' | boolean;
}

export async function fetch (url: string, opts: any) {
  // @ts-ignore
  return _fetch(url, opts);
}

export async function lookup (install: string | Install, { provider, cache }: LookupOptions = {}) {
  const generator = new Generator({ cache: !cache, defaultProvider: provider });
  const { target, subpath, alias } = await installToTarget.call(generator, install);
  if (target instanceof URL)
    throw new Error('URL lookups not supported');
  const resolved = await generator.traceMap.resolver.resolveLatestTarget(target, true, generator.traceMap.installer.defaultProvider);
  return {
    install: {
      target: {
        registry: target.registry,
        name: target.name,
        range: target.ranges.map(range => range.toString()).join(' || ')
      },
      subpath,
      alias
    },
    resolved
  };
}

export async function getPackageConfig (pkg: string | URL | ExactPackage, { provider, cache }: LookupOptions = {}) {
  const generator = new Generator({ cache: !cache, defaultProvider: provider });
  if (typeof pkg === 'object' && 'name' in pkg)
    pkg = generator.traceMap.resolver.pkgToUrl(pkg, generator.traceMap.installer.defaultProvider);
  else if (typeof pkg === 'string')
    pkg = new URL(pkg).href;
  else
    pkg = pkg.href;
  return generator.traceMap.resolver.getPackageConfig(pkg);
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
