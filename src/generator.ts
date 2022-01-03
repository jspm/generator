import { baseUrl as _baseUrl, isPlain } from "./common/url.js";
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
import { analyzeHtml } from "./html/analyze.js";
import { SemverRange } from 'sver';
import { Replacer } from "./common/str.js";
import { getIntegrity } from "./common/integrity.js";

export { analyzeHtml }

export interface GeneratorOptions {
  /**
   * The URL to use for resolutions without a parent context.
   * 
   * Defaults to mapUrl or the process base URL.
   * 
   * Also determines the default scoping base for the import map when flattening.
   */
  baseUrl?: URL | string;

  /**
   * The URL of the import map itself, used to construct relative import map URLs.
   * 
   * Defaults to the base URL.
   * 
   * The `mapUrl` is used in order to output relative URLs for modules located on the same
   * host as the import map.
   * 
   * E.g. for `mapUrl: 'file:///path/to/project/map.importmap'`, installing local file packages
   * will be output as relative URLs to their file locations from the map location, since all URLs in an import
   * map are relative to the URL of the import map.
   */
  mapUrl?: URL | string;

  /**
   * The URL to treat as the root of the serving protocol of the
   * import map, used to construct absolute import map URLs.
   * 
   * When set, `rootUrl` takes precendence over `mapUrl` and is used to normalize all import map URLs
   * as absolute paths against this URL.
   *
   * E.g. for `rootUrl: 'file:///path/to/project/public'`, any local module `public/local/mod.js` within the `public` folder
   * will be normalized to `/local/mod.js` in the output map.
   */
  rootUrl?: URL | string;
  /**
   * An authoritative initial import map.
   * 
   * An initial import map to start with - can be from a previous
   * install or to provide custom mappings.
   */
  inputMap?: IImportMap;
  /**
   * The default provider to use for a new install, defaults to 'jspm'.
   * 
   * Supports: 'jspm' | 'jspm.system' | 'nodemodules' | 'skypack' | 'jsdelivr' | 'unpkg';
   * 
   * Providers are responsible for resolution from abstract package names and version ranges to exact URL locations.
   * 
   * Providers resolve package names and semver ranges to exact CDN package URL paths using provider hooks.
   *
   * These hooks include version resolution and converting package versions into URLs and back again.
   * 
   * See `src/providers/[name].ts` for how to define a custom provider.
   * 
   * New providers can be provided via the `customProviders` option. PRs to merge in providers are welcome as well.
   */
  defaultProvider?: string;
  /**
   * The conditional environment resolutions to apply.
   * 
   * The conditions passed to the `env` option are environment conditions, as [supported by Node.js](https://nodejs.org/dist/latest-v16.x/docs/api/packages.html#packages_conditions_definitions) in the package exports field.
   *
   * By default the `"default"`, `"require"` and `"import"` conditions are always supported regardless of what `env` conditions are provided.
   * 
   * In addition the default conditions applied if no `env` option is set are `"browser"`, `"development"` and `"module"`.
   * 
   * Webpack and RollupJS support a custom `"module"` condition as a bundler-specific solution to the [dual package hazard](https://nodejs.org/dist/latest-v16.x/docs/api/packages.html#packages_dual_package_hazard), which is by default included in the JSPM resolution as well although
   * can be turned off if needed.
   * 
   * Note when providing custom conditions like setting `env: ["production"]` that the `"browser"` and `"module"` conditions still need to be
   * applied as well via `env: ["production", "browser", "module"]`. Ordering does not matter though.
   * 
   * Any other custom condition strings can also be provided.
   */
  env?: string[];
  /**
   * Whether to use a local FS cache for fetched modules. Set to 'offline' to use the offline cache.
   * 
   * By default a global fetch cache is maintained between runs on the file system.
   * 
   * This caching can be disabled by setting `cache: false`.
   * 
   * When running offline, setting `cache: 'offline'` will only use the local cache and not touch the network at all,
   * making fully offline workflows possible provided the modules have been seen before.
   */
  cache?: 'offline' | boolean;
  /**
   * Package to use for JSPM Core std library.
   * 
   * Defaults to '@jspm/core'
   * 
   * Any package dependency target is supported, including local folders.
   */
  stdlib?: string;
  /**
   * Custom provider definitions.
   * 
   * When installing from a custom CDN it can be advisable to define a custom provider in order to be able to get version deduping against that CDN.
   * 
   * Custom provider definitions define a provider name, and the provider instance consisting of three main hooks:
   * 
   * * `pkgToUrl({ registry: string, name: string, version: string }, layer: string) -> String URL`: Returns the URL for a given exact package registry, name and version to use for this provider. If the provider is using layers, the `layer` string can be used to determine the URL layer (where the `defaultProvider: '[name].[layer]'` form is used to determine the layer, eg minified v unminified etc). It is important that package URLs always end in `/`, because packages must be treated as folders not files. An error will be thrown for package URLs returned not ending in `/`.
   * * `parsePkgUrl(url: string) -> { { registry: string, name: string, version: string }, layer: string } | undefined`: Defines the converse operation to `pkgToUrl`, converting back from a string URL
   * into the exact package registry, name and version, as well as the layer. Should always return `undefined` for unknown URLs as the first matching provider is treated as authoritative when dealing with
   * multi-provider installations.
   * * `resolveLatestTarget(target: { registry: string, name: string, range: SemverRange }, unstable: boolean, layer: string, parentUrl: string) -> Promise<{ registry: string, name: string, version: string } | null>`: Resolve the latest version to use for a given package target. `unstable` indicates that prerelease versions can be matched. The definition of `SemverRange` is as per the [sver package](https://www.npmjs.com/package/sver#semverrange). Returning `null` corresponds to a package not found error.
   * 
   * The use of `pkgToUrl` and `parsePkgUrl` is what allows the JSPM Generator to dedupe package versions internally based on their unique internal identifier `[registry]:[name]@[version]` regardless of what CDN location is used. URLs that do not support `parsePkgUrl` can still be installed and used fine, they just do not participate in version deduping operations.
   * 
   * For example, a custom unpkg provider can be defined as:
   * 
   * ```js
   * const unpkgUrl = 'https://unpkg.com/';
   * const exactPkgRegEx = /^((?:@[^/\\%@]+\/)?[^./\\%@][^/\\%@]*)@([^\/]+)(\/.*)?$/;
   * 
   * const generator = new Generator({
   *   defaultProvider: 'custom',
   *   customProviders: {
   *     custom: {
   *       pkgToUrl ({ registry, name, version }) {
   *         return `${unpkgUrl}${name}@${version}/`;
   *       },
   *       parseUrlPkg (url) {
   *         if (url.startsWith(unpkgUrl)) {
   *           const [, name, version] = url.slice(unpkgUrl.length).match(exactPkgRegEx) || [];
   *           return { registry: 'npm', name, version };
   *         }
   *       },
   *       resolveLatestTarget ({ registry, name, range }, unstable, layer, parentUrl) {
   *         return { registry, name, version: '3.6.0' };
   *       }
   *     }
   *   }
   * });
   * 
   * await generator.install('custom:jquery');
   * ```
   */
  customProviders?: Record<string, Provider>;
  /**
   * A map of custom scoped providers.
   * 
   * The provider map allows setting custom providers for specific package names or package scopes.
   * For example, an organization with private packages with names like `npmpackage` and `@orgscope/...` can define the custom providers to reference these from a custom source:
   * 
   * ```js
   *   providers: {
   *     'npmpackage': 'nodemodules',
   *     '@orgscope': 'nodemodules'
   *   }
   * ```
   * 
   * Alternatively a custom provider can be referenced this way for eg private CDN / registry support.
   */
  providers?: Record<string, string>;
  /**
   * Custom dependency resolution overrides for all installs.
   * 
   * The resolutions option allows configuring a specific dependency version to always be used overriding all version resolution
   * logic for that dependency for all nestings.
   * 
   * It is a map from package name to package version target just like the package.json "dependencies" map, but that applies and overrides universally.
   * 
   * For example to lock a specific package version:
   * 
   * ```js
   * const generator = new Generator({
   *   resolutions: {
   *     dep: '1.2.3'
   *   }
   * });
   * ```
   * 
   * It is also useful for local monorepo patterns where all local packages should be located locally.
   * When referencing local paths, the baseUrl configuration option is used as the URL parent.
   * 
   * ```js
   * const generator = new Generator({
   *   mapUrl: new URL('./app.html', import.meta.url),
   *   baseUrl: new URL('../', import.meta.url),
   *   resolutions: {
   *     '@company/pkgA': `./pkgA`,
   *     '@company/pkgB': `./pkgB`
   *     '@company/pkgC': `./pkgC`
   *   }
   * })
   * ```
   * 
   * All subpath and main resolution logic will follow the package.json definitions of the resolved package, unlike `inputMap`
   * which only maps specific specifiers.
   */
  resolutions?: Record<string, string>;
  /**
   * Allows ignoring certain module specifiers during the tracing process.
   * It can be useful, for example, when you provide an `inputMap`
   * that contains a mapping that can't be traced in current context,
   * but you know it will work in the context where the generated map
   * is going to be used.
   * ```js
   * const generator = new Generator({
   *   inputMap: {
   *       imports: {
   *           "react": "./my/own/react.js",
   *       }
   *   },
   *   ignore: ["react"]
   * });
   * 
   * // Even though `@react-three/fiber@7` depends upon `react`,
   * // `generator` will not try to trace and resolve `react`,
   * // so the mapping provided in `inputMap` will end up in the resulting import map. 
   * await generator.install("@react-three/fiber@7")
   * ```
   */
  ignore?: string[];
  /**
   * When installing packages over IPFS, sets the IPFS node API HTTP interface to use,
   * or a list of API URLs to try connect to.
   * 
   * Default: ['/ip4/127.0.0.1/tcp/45005', '/ip4/127.0.0.1/tcp/5001']
   * 
   * Defaults to the Brave Browser interface at /ip4/127.0.0.1/tcp/45005, when IPFS is
   * enabled in Brave Browser via brave://ipfs-internals/, followed by trying the local
   * IPFS node.
   */
  ipfsAPI?: string | string[];
}

export interface ModuleAnalysis {
  format: 'commonjs' | 'esm' | 'system' | 'json' | 'typescript';
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

/**
 * Supports clearing the global fetch cache in Node.js.
 * 
 * Example:
 * 
 * ```js
 * import { clearCache } from '@jspm/generator';
 * clearCache();
 * ```
 */
export function clearCache () {
  clearFetchCache();
}

export class Generator {
  traceMap: TraceMap;
  baseUrl: URL;
  mapUrl: URL;
  rootUrl: URL | null;
  finishInstall: (success: boolean) => Promise<boolean | { pjsonChanged: boolean, lock: LockResolutions }> | null = null;
  installCnt = 0;

  logStream: LogStream;

  /**
   * @param options GeneratorOptions
   * 
   * For example:
   * 
   * ```js
   * const generator = new Generator({
   *   mapUrl: import.meta.url,
   *   inputMap: {
   *     "imports": {
   *       "react": "https://cdn.skypack.dev/react"
   *     }
   *   },
   *   defaultProvider: 'jspm',
   *   providers: {
   *     '@orgscope': 'nodemodules'
   *   },
   *   customProviders: {},
   *   env: ['production', 'browser'],
   *   cache: false,
   * });
   * ```
   */
  constructor ({
    baseUrl,
    mapUrl,
    rootUrl = undefined,
    inputMap = undefined,
    env = ['browser', 'development', 'module'],
    defaultProvider = 'jspm',
    customProviders = undefined,
    providers = {},
    resolutions = {},
    cache = true,
    stdlib = '@jspm/core',
    ignore = [],
    ipfsAPI
  }: GeneratorOptions = {}) {
    let fetchOpts = undefined;
    if (cache === 'offline')
      fetchOpts = { cache: 'force-cache' };
    else if (!cache)
      fetchOpts = { cache: 'no-store' };
    else
      fetchOpts = {};
    if (ipfsAPI)
      fetchOpts.ipfsAPI = ipfsAPI;
    const { log, logStream } = createLogger();
    const resolver = new Resolver(log, fetchOpts, true);
    if (customProviders) {
      for (const provider of Object.keys(customProviders)) {
        resolver.addCustomProvider(provider, customProviders[provider]);
      }
    }
    this.logStream = logStream;

    if (mapUrl && !baseUrl) {
      mapUrl = typeof mapUrl === 'string' ? new URL(mapUrl, _baseUrl) : mapUrl;
      try {
        baseUrl = new URL('./', mapUrl);
      } catch {
        baseUrl = new URL(mapUrl + '/');
      }
    }
    else if (baseUrl && !mapUrl) {
      mapUrl = baseUrl;
    }
    else if (!mapUrl && !baseUrl) {
      baseUrl = mapUrl = _baseUrl;
    }
    this.baseUrl = typeof baseUrl === 'string' ? new URL(baseUrl, _baseUrl) : baseUrl;
    if (!this.baseUrl.pathname.endsWith('/')) {
      this.baseUrl = new URL(this.baseUrl.href);
      this.baseUrl.pathname += '/';
    }
    this.mapUrl = typeof mapUrl === 'string' ? new URL(mapUrl, this.baseUrl) : mapUrl;
    this.rootUrl = typeof rootUrl === 'string' ? new URL(rootUrl, this.baseUrl) : rootUrl || null;
    if (!this.mapUrl.pathname.endsWith('/')) {
      try {
        this.mapUrl = new URL('./', this.mapUrl);
      } catch {
        this.mapUrl = new URL(this.mapUrl.href + '/');
      }
    }
    this.traceMap = new TraceMap(this.mapUrl, {
      baseUrl: this.baseUrl,
      stdlib,
      env,
      defaultProvider,
      providers,
      inputMap,
      ignore,
      resolutions
    }, log, resolver);
  }

  /**
   * Trace a module and install all dependencies necessary into the map
   * to support its execution including static and dynamic module imports.
   * 
   * @param specifier Import specifier to trace
   * @param parentUrl Parent URL to trace this specifier from
   */
  async traceInstall (specifier: string, parentUrl?: string | URL): Promise<{
    staticDeps: string[];
    dynamicDeps: string[];
  }> {
    if (typeof parentUrl === 'string')
      parentUrl = new URL(parentUrl);
    let error = false;
    if (this.installCnt++ === 0)
      this.finishInstall = await this.traceMap.startInstall();
    try {
      await this.traceMap.trace(specifier, parentUrl || this.baseUrl);
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
  
  /*
   * Generate and inject an import map for an HTML file
   *
   * Traces the module scripts of the HTML via traceInstall and install
   * for URL-like specifiers and bare specifiers respectively.
   * 
   * Injects the final generated import map returning the injected HTML
   * 
   * Input Options control the input HTML and URL
   */
  async htmlGenerate (html: string, {
    htmlUrl, preload = false, integrity = false, whitespace = true, esModuleShims = true
  }: {
    htmlUrl?: string | URL,
    preload?: boolean,
    integrity?: boolean,
    whitespace?: boolean,
    esModuleShims?: string | boolean
  } = {}): Promise<string> {
    if (typeof htmlUrl === 'string')
      htmlUrl = new URL(htmlUrl);
    if (integrity)
      preload = true;
    const analysis = analyzeHtml(html, htmlUrl);
    let preloadDeps: string[] = [];
    // TODO:
    // extract lockfile from map
    await Promise.all([...new Set([...analysis.staticImports, ...analysis.dynamicImports])].map(async impt => {
      if (isPlain(impt)) {
        var { staticDeps } = await this.install(impt);
      }
      else {
        var { staticDeps } = await this.traceInstall(impt, analysis.base);
      }
      preloadDeps = preloadDeps.concat(staticDeps);
    }));

    const replacer = new Replacer(html);

    let esms = '';
    if (esModuleShims) {
      const esmsPkg = await this.traceMap.resolver.resolveLatestTarget({ name: 'es-module-shims', registry: 'npm', ranges: [new SemverRange('*')] }, false, this.traceMap.installer.defaultProvider);
      const esmsUrl = this.traceMap.resolver.pkgToUrl(esmsPkg, this.traceMap.installer.defaultProvider) + 'dist/es-module-shims.js';
      esms = `<script async src="${esmsUrl}" crossorigin="anonymous"${integrity ? ` integrity="${await getIntegrity(esmsUrl, this.traceMap.resolver.fetchOpts)}"` : ''}></script>${analysis.map.newlineTab}`;
    }

    if (esModuleShims !== undefined && analysis.esModuleShims) {
      replacer.remove(analysis.esModuleShims.start, analysis.esModuleShims.end, true);
    }

    let preloads = '';
    if (preload && preloadDeps.length) {
      let first = true;
      for (let dep of preloadDeps) {
        if (first || whitespace)
          preloads += analysis.map.newlineTab;
        if (first) first = false;
        if (integrity) {
          preloads += `<link rel="modulepreload" href="${dep}" integrity="${await getIntegrity(dep, this.traceMap.resolver.fetchOpts)}" />`;
        }
        else {
          preloads += `<link rel="modulepreload" href="${dep}" />`;
        }
      }
    }

    if (preload !== undefined) {
      for (const preload of analysis.preloads) {
        replacer.remove(preload.start, preload.end, true);
      }
    }

    replacer.replace(analysis.map.start, analysis.map.end,
      esms +
      '<script type="importmap">' +
      (whitespace ? '\n' : '') +
      JSON.stringify(this.getMap(), null, whitespace ? 2 : 0) +
      (whitespace ? analysis.map.newlineTab : '') +
      '</script>' +
      preloads +
      (analysis.map.newScript ? analysis.map.newlineTab : '')
    );

    return replacer.source;
  }

  /**
   * Install a package target into the import map, including all its dependency resolutions via tracing.
   * @param install Package to install
   * 
   * For example:
   * 
   * ```js
   * // Install a new package into the import map
   * await generator.install('react-dom');
   * 
   * // Install a package version and subpath into the import map (installs lit/decorators.js)
   * await generator.install('lit@2/decorators.js');
   * 
   * // Install a package version to a custom alias
   * await generator.install({ alias: 'react16', target: 'react@16' });
   * 
   * // Install a specific subpath of a package
   * await generator.install({ target: 'lit@2', subpath: './html.js' });
   * 
   * // Install an export from a locally located package folder into the map
   * // The package.json is used to determine the exports and dependencies.
   * await generator.install({ alias: 'mypkg', target: './packages/local-pkg', subpath: './feature' });
   * ```
   * 
   */
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

  /**
   * Resolve a specifier using the import map.
   * 
   * @param specifier Module to resolve
   * @param parentUrl ParentURL of module to resolve
   * @returns Resolved URL string
   */
  resolve (specifier: string, parentUrl: URL | string = this.baseUrl) {
    if (typeof parentUrl === 'string')
      parentUrl = new URL(parentUrl, this.baseUrl);
    const resolved = this.traceMap.map.resolve(specifier, parentUrl);
    if (resolved === null)
      throw new JspmError(`Unable to resolve "${specifier}" from ${parentUrl.href}`, 'MODULE_NOT_FOUND');
    return resolved;
  }

  /**
   * Get the import map JSON
   */
  get importMap () {
    return this.traceMap.map;
  }

  /**
   * 
   * @param url 
   * @returns 
   */
  getAnalysis (url: string | URL): ModuleAnalysis {
    if (typeof url !== 'string')
      url = url.href;
    const trace = this.traceMap.tracedUrls[url];
    if (!trace)
      throw new Error(`The URL ${url} has not been traced by this generator instance.`);
    return {
      format: trace.format,
      staticDeps: trace.deps,
      dynamicDeps: trace.dynamicDeps,
      cjsLazyDeps: trace.cjsLazyDeps || []
    };
  }

  getMap () {
    const map = this.traceMap.map.clone();
    map.flatten(this.rootUrl ? this.rootUrl : this.baseUrl);
    if (this.rootUrl)
      map.rebase(this.rootUrl.href, true);
    map.sort();
    return map.toJSON();
  }
}

export interface HtmlInjector {
  setMap: (map: any) => void;
  clearPreloads: () => void;
  
  toString: () => string;
}

export interface LookupOptions {
  provider?: string;
  cache?: 'offline' | boolean;
}

/**
 * _Use the internal fetch implementation, useful for hooking into the same shared local fetch cache._
 * 
 * ```js
 * import { fetch } from '@jspm/generator';
 * 
 * const res = await fetch(url);
 * console.log(await res.text());
 * ```
 * 
 * Use the `{ cache: 'no-store' }` option to disable the cache, and the `{ cache: 'force-cache' }` option to enforce the offline cache.
 */
export async function fetch (url: string, opts: any = {}) {
  // @ts-ignore
  return _fetch(url, opts);
}

/**
 * Get the lookup resolution information for a specific install.
 * 
 * @param install The install object
 * @param lookupOptions Provider and cache defaults for lookup
 * @returns The resolved install and exact package { install, resolved }
 */
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

/**
 * Get the package.json configuration for a specific URL or package.
 * 
 * @param pkg Package to lookup configuration for
 * @param lookupOptions Optional provider and cache defaults for lookup
 * @returns Package JSON configuration
 * 
 * Example:
 * ```js
 * import { getPackageConfig } from '@jspm/generator';
 * 
 * // Supports a resolved package
 * {
 *   const packageJson = await getPackageConfig({ registry: 'npm', name: 'lit-element', version: '2.5.1' });
 * }
 * 
 * // Or alternatively provide any URL
 * {
 *   const packageJson = await getPackageConfig('https://ga.jspm.io/npm:lit-element@2.5.1/lit-element.js');
 * }
 * ```
 */
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

/**
 * Get the package base URL for the given module URL.
 * 
 * @param url module URL
 * @param lookupOptions Optional provider and cache defaults for lookup
 * @returns Base package URL
 * 
 * Modules can be remote CDN URLs or local file:/// URLs.
 * 
 * All modules in JSPM are resolved as within a package boundary, which is the
 * parent path of the package containing a package.json file.
 * 
 * For JSPM CDN this will always be the base of the package as defined by the
 * JSPM CDN provider. For non-provider-defined origins it is always determined
 * by trying to fetch the package.json in each parent path until the root is reached
 * or one is found. On file:/// URLs this exactly matches the Node.js resolution
 * algorithm boundary lookup.
 * 
 * This package.json file controls the package name, imports resolution, dependency
 * resolutions and other package information.
 * 
 * getPackageBase will return the folder containing the package.json,
 * with a trailing '/'.
 * 
 * This URL will either be the root URL of the origin, or it will be a
 * path "pkgBase" such that fetch(`${pkgBase}package.json`) is an existing
 * package.json file.
 * 
 * For example:
 * 
 * ```js
 *   import { getPackageBase } from '@jspm/generator'; 
 *   const pkgUrl = await getPackageBase('https://ga.jspm.io/npm:lit-element@2.5.1/lit-element.js');
 *   // Returns: https://ga.jspm.io/npm:lit-element@2.5.1/
 * ```
 */
export async function getPackageBase (url: string | URL, { provider, cache }: LookupOptions = {}): Promise<string> {
  const generator = new Generator({ cache: !cache, defaultProvider: provider });
  return generator.traceMap.resolver.getPackageBase(typeof url === 'string' ? url : url.href);
}

async function installToTarget (this: Generator, install: Install | string) {
  if (typeof install === 'string')
    install = { target: install };
  if (typeof install.target !== 'string')
    throw new Error('All installs require a "target" string.');
  if (install.subpath !== undefined && (typeof install.subpath !== 'string' || (install.subpath !== '.' && !install.subpath.startsWith('./'))))
    throw new Error(`Install subpath "${install.subpath}" must be a string equal to "." or starting with "./".${typeof install.subpath === 'string' ? `\nTry setting the subpath to "./${install.subpath}"` : ''}`);
  const { alias, target, subpath } = await toPackageTarget(this.traceMap.resolver, install.target, this.baseUrl.href);
  return {
    alias: install.alias || alias,
    target,
    subpath: install.subpath || subpath
  };
}
