import { baseUrl as _baseUrl, relativeUrl, resolveUrl } from "./common/url.js";
import {
  ExactPackage,
  PackageConfig,
  parseTarget,
  validatePkgName,
} from "./install/package.js";
import TraceMap from "./trace/tracemap.js";
// @ts-ignore
import { clearCache as clearFetchCache, fetch as _fetch } from "#fetch";
import { createLogger, Log, LogStream } from "./common/log.js";
import { Resolver } from "./trace/resolver.js";
import { IImportMap, ImportMap } from "@jspm/import-map";
import { type Provider } from "./providers/index.js";
import { JspmError } from "./common/err.js";
import { analyzeHtml } from "./html/analyze.js";
import { SemverRange } from "sver";
import { Replacer } from "./common/str.js";
import { getIntegrity } from "./common/integrity.js";
import { LockResolutions } from "./install/lock.js";
import process from "process";
import { InstallTarget } from "./install/installer.js";
import * as nodemodules from "./providers/nodemodules.js";

export { analyzeHtml };

// Type exports for users:
export { Provider };

/**
 * @interface GeneratorOptions.
 */
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
  rootUrl?: URL | string | null;
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
   * The default registry to use when no registry is provided to an install.
   * Defaults to 'npm:'.
   *
   * Registries are separated from providers because multiple providers can serve
   * any public registry.
   *
   * Internally, the default providers for registries are handled by the providers object
   */
  defaultRegistry?: string;
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
  cache?: "offline" | boolean;
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
   * The provider map allows setting custom providers for specific package names, package scopes or registries.
   * For example, an organization with private packages with names like `npmpackage` and `@orgscope/...` can define the custom providers to reference these from a custom source:
   *
   * ```js
   *   providers: {
   *     'npmpackage': 'nodemodules',
   *     '@orgscope': 'nodemodules',
   *     'npm:': 'nodemodules'
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
  /**
   * Lockfile data to use for resolutions
   */
  lock?: LockResolutions;
  /**
   * When using a lockfile, do not modify existing resolutions
   */
  freeze?: boolean;
  /**
   * When using a lockfile, force update touched resolutions to latest
   */
  latest?: boolean;

  /**
   * Support tracing CommonJS dependencies locally. This is necessary if you
   * are using the "nodemodules" provider and have CommonJS dependencies.
   */
  commonJS?: boolean;
}

export interface ModuleAnalysis {
  format: "commonjs" | "esm" | "system" | "json" | "typescript";
  staticDeps: string[];
  dynamicDeps: string[];
  cjsLazyDeps: string[] | null;
}

export interface Install {
  target: string | InstallTarget;
  alias?: string;
  installSubpath?: null | `./${string}`;
  subpath?: "." | `./${string}`;
  subpaths?: ("." | `./${string}`)[];
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
export function clearCache() {
  clearFetchCache();
}

/**
 * Generator.
 */
export class Generator {
  traceMap: TraceMap;
  baseUrl: URL;
  mapUrl: URL;
  rootUrl: URL | null;
  map: ImportMap;
  logStream: LogStream;
  log: Log;

  /**
   * The number of concurrent installs the generator is busy processing.
   */
  installCnt = 0;

  /**
   * Constructs a new Generator instance.
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
   *   defaultRegistry: 'npm',
   *   providers: {
   *     '@orgscope': 'nodemodules'
   *   },
   *   customProviders: {},
   *   env: ['production', 'browser'],
   *   cache: false,
   * });
   * ```
   */
  constructor({
    baseUrl,
    mapUrl,
    rootUrl = undefined,
    inputMap = undefined,
    env = ["browser", "development", "module", "import"],
    defaultProvider = "jspm",
    defaultRegistry = "npm",
    customProviders = undefined,
    providers,
    resolutions = {},
    cache = true,
    ignore = [],
    freeze,
    latest,
    ipfsAPI,
    commonJS = false,
  }: GeneratorOptions = {}) {
    // Initialise the debug logger:
    const { log, logStream } = createLogger();
    this.log = log;
    this.logStream = logStream;
    if (process.env.JSPM_GENERATOR_LOG) {
      (async () => {
        for await (const { type, message } of this.logStream()) {
          console.log(`\x1b[1m${type}:\x1b[0m ${message}`);
        }
      })();
    }

    // Initialise the resource fetcher:
    let fetchOpts = undefined;
    if (cache === "offline")
      fetchOpts = {
        cache: "force-cache",
        headers: { "Accept-Encoding": "gzip, br" },
      };
    else if (!cache)
      fetchOpts = {
        cache: "no-store",
        headers: { "Accept-Encoding": "gzip, br" },
      };
    else fetchOpts = { headers: { "Accept-Encoding": "gzip, br" } };
    if (ipfsAPI) fetchOpts.ipfsAPI = ipfsAPI;

    // Default logic for the mapUrl, baseUrl and rootUrl:
    if (mapUrl && !baseUrl) {
      mapUrl = typeof mapUrl === "string" ? new URL(mapUrl, _baseUrl) : mapUrl;
      try {
        baseUrl = new URL("./", mapUrl);
      } catch {
        baseUrl = new URL(mapUrl + "/");
      }
    } else if (baseUrl && !mapUrl) {
      mapUrl = baseUrl;
    } else if (!mapUrl && !baseUrl) {
      baseUrl = mapUrl = _baseUrl;
    }
    this.baseUrl =
      typeof baseUrl === "string" ? new URL(baseUrl, _baseUrl) : baseUrl;
    if (!this.baseUrl.pathname.endsWith("/")) {
      this.baseUrl = new URL(this.baseUrl.href);
      this.baseUrl.pathname += "/";
    }
    this.mapUrl =
      typeof mapUrl === "string" ? new URL(mapUrl, this.baseUrl) : mapUrl;
    this.rootUrl =
      typeof rootUrl === "string"
        ? new URL(rootUrl, this.baseUrl)
        : rootUrl || null;
    if (this.rootUrl && !this.rootUrl.pathname.endsWith("/"))
      this.rootUrl.pathname += "/";
    if (!this.mapUrl.pathname.endsWith("/")) {
      try {
        this.mapUrl = new URL("./", this.mapUrl);
      } catch {
        this.mapUrl = new URL(this.mapUrl.href + "/");
      }
    }

    // Initialise the resolver:
    const resolver = new Resolver(env, log, fetchOpts, true);
    if (customProviders) {
      for (const provider of Object.keys(customProviders)) {
        resolver.addCustomProvider(provider, customProviders[provider]);
      }
    }

    // The node_modules provider is special, because it needs to be rooted to
    // perform resolutions against the local node_modules directory:
    const nmProvider = nodemodules.createProvider(this.baseUrl.href);
    resolver.addCustomProvider("nodemodules", nmProvider);

    // Initialise the tracer:
    this.traceMap = new TraceMap(
      {
        mapUrl: this.mapUrl,
        rootUrl: this.rootUrl,
        baseUrl: this.baseUrl,
        defaultProvider,
        defaultRegistry,
        providers,
        ignore,
        resolutions,
        freeze,
        latest,
        commonJS,
      },
      log,
      resolver
    );

    // Reconstruct constraints and locks from the input map:
    this.map = new ImportMap({ mapUrl: this.mapUrl, rootUrl: this.rootUrl });
    if (inputMap) this.addMappings(inputMap);
  }

  /**
   * Add new custom mappings and lock resolutions to the input map
   * of the generator, which are then applied in subsequent installs.
   *
   * @param jsonOrHtml The mappings are parsed as a JSON data object or string, falling back to reading an inline import map from an HTML file.
   * @param mapUrl An optional URL for the map to handle relative resolutions, defaults to generator mapUrl.
   * @param rootUrl An optional root URL for the map to handle root resolutions, defaults to generator rootUrl.
   * @returns The list of modules pinned by this import map or HTML.
   *
   */
  async addMappings(
    jsonOrHtml: string | IImportMap,
    mapUrl: string | URL = this.mapUrl,
    rootUrl: string | URL = this.rootUrl,
    preloads?: string[]
  ): Promise<string[]> {
    if (typeof mapUrl === "string") mapUrl = new URL(mapUrl, this.baseUrl);
    if (typeof rootUrl === "string") rootUrl = new URL(rootUrl, this.baseUrl);
    let htmlModules: string[] | undefined;
    if (typeof jsonOrHtml === "string") {
      try {
        jsonOrHtml = JSON.parse(jsonOrHtml) as IImportMap;
      } catch {
        const analysis = analyzeHtml(jsonOrHtml as string, mapUrl);
        jsonOrHtml = (analysis.map.json || {}) as IImportMap;
        preloads = (preloads || []).concat(
          analysis.preloads
            .map((preload) => preload.attrs.href?.value)
            .filter((x) => x)
        );
        htmlModules = [
          ...new Set([...analysis.staticImports, ...analysis.dynamicImports]),
        ];
      }
    }
    await this.traceMap.addInputMap(jsonOrHtml, mapUrl, rootUrl, preloads);
    return htmlModules || [...this.traceMap.pins];
  }

  /**
   * Retrieve the lockfile data from the installer
   */
  getLock(): LockResolutions {
    return JSON.parse(JSON.stringify(this.traceMap.installer.installs));
  }

  /**
   * Trace and pin a module, installing all dependencies necessary into the map
   * to support its execution including static and dynamic module imports.
   *
   * @deprecated Use "link" instead.
   */
  async pin(
    specifier: string,
    parentUrl?: string
  ): Promise<{
    staticDeps: string[];
    dynamicDeps: string[];
  }> {
    return this.link(specifier, parentUrl);
  }

  /**
   * Trace a module, installing all dependencies necessary into the map
   * to support its execution including static and dynamic module imports.
   *
   * @param specifier Module to trace
   * @param parentUrl Optional parent URL
   * @deprecated Use "link" instead.
   */
  async traceInstall(
    specifier: string | string[],
    parentUrl?: string
  ): Promise<{ staticDeps: string[]; dynamicDeps: string[] }> {
    return this.link(specifier, parentUrl);
  }

  /**
   * Link a module, installing all dependencies necessary into the map
   * to support its execution including static and dynamic module imports.
   *
   * @param specifier Module to trace
   * @param parentUrl Optional parent URL
   */
  async link(
    specifier: string | string[],
    parentUrl?: string
  ): Promise<{ staticDeps: string[]; dynamicDeps: string[] }> {
    if (typeof specifier === "string") specifier = [specifier];
    let error = false;
    if (this.installCnt++ === 0) this.traceMap.startInstall();
    specifier = specifier.map((specifier) => specifier.replace(/\\/g, "/"));
    await this.traceMap.processInputMap;
    try {
      await Promise.all(
        specifier.map((specifier) =>
          this.traceMap.visit(
            specifier,
            { mode: "new-prefer-existing", toplevel: true },
            parentUrl || this.baseUrl.href
          )
        )
      );
      for (const s of specifier) {
        if (!this.traceMap.pins.includes(s)) this.traceMap.pins.push(s);
      }
    } catch (e) {
      error = true;
      throw e;
    } finally {
      if (--this.installCnt === 0) {
        const { map, staticDeps, dynamicDeps } =
          await this.traceMap.finishInstall();
        this.map = map;
        if (!error) return { staticDeps, dynamicDeps };
      }
    }
  }

  /**
   * Generate and inject an import map for an HTML file
   *
   * @deprecated Instead use:
   *   const pins = await generator.addMappings(html, mapUrl, rootUrl);
   *   return await generator.htmlInject(html, { pins, htmlUrl: mapUrl, rootUrl, preload, integrity, whitespace, esModuleShims, comment });
   *
   * Traces the module scripts of the HTML via link and install
   * for URL-like specifiers and bare specifiers respectively.
   *
   * Injects the final generated import map returning the injected HTML
   *
   * @param html String
   * @param injectOptions Injection options
   *
   * Injection options are: `htmlUrl`, `preload`, `integrity`, `whitespace`
   * and `esModuleShims`. The default is `{ esModuleShims: true, whitespace: true }`.
   *
   * ES Module shims will be resolved to the latest version against the provider
   *
   * Example:
   *
   * ```js
   *  const outputHtml = await generator.htmlGenerate(`
   *    <!doctype html>
   *    <script type="module">import 'react'</script>
   *  `);
   * ```
   *
   * which outputs:
   *
   * ```
   *   <!doctype html>
   *   <!-- Generated by @jspm/generator - https://github.com/jspm/generator -->
   *   <script async src="https://ga.jspm.io/npm:es-module-shims@1.4.1/dist/es-module-shims.js"></script>
   *   <script type="importmap">
   *   {...}
   *   </script>
   *   <script type="module">import 'react'</script>
   * ```
   *
   */
  async htmlGenerate(
    html: string,
    {
      mapUrl,
      rootUrl,
      preload = false,
      integrity = false,
      whitespace = true,
      esModuleShims = true,
      comment = true,
    }: {
      mapUrl?: string | URL;
      rootUrl?: string | URL | null;
      preload?: boolean | "all" | "static";
      integrity?: boolean;
      whitespace?: boolean;
      esModuleShims?: string | boolean;
      comment?: boolean | string;
    } = {}
  ): Promise<string> {
    if (typeof mapUrl === "string") mapUrl = new URL(mapUrl);
    const pins = await this.addMappings(html, mapUrl, rootUrl);
    return await this.htmlInject(html, {
      pins,
      htmlUrl: mapUrl,
      rootUrl,
      preload,
      integrity,
      whitespace,
      esModuleShims,
      comment,
    });
  }

  /**
   * Inject the import map into the provided HTML source
   *
   * @param html HTML source to inject into
   * @param opts Injection options
   * @returns HTML source with import map injection
   */
  async htmlInject(
    html: string,
    {
      trace = false,
      pins = !trace,
      htmlUrl,
      rootUrl,
      preload = false,
      integrity = false,
      whitespace = true,
      esModuleShims = true,
      comment = true,
    }: {
      pins?: string[] | boolean;
      trace?: string[] | boolean;
      htmlUrl?: string | URL;
      rootUrl?: string | URL | null;
      preload?: boolean | "all" | "static";
      integrity?: boolean;
      whitespace?: boolean;
      esModuleShims?: string | boolean;
      comment?: boolean | string;
    } = {}
  ): Promise<string> {
    if (comment === true)
      comment =
        " Generated by @jspm/generator - https://github.com/jspm/generator ";
    if (typeof htmlUrl === "string") htmlUrl = new URL(htmlUrl);
    if (integrity) preload = true;
    if (this.installCnt !== 0)
      throw new JspmError(
        "htmlGenerate cannot run alongside other install ops"
      );

    const analysis = analyzeHtml(html, htmlUrl);

    let modules =
      pins === true ? this.traceMap.pins : Array.isArray(pins) ? pins : [];
    if (trace) {
      const impts = [
        ...new Set([...analysis.staticImports, ...analysis.dynamicImports]),
      ];
      await Promise.all(
        impts.map((impt) => this.link(impt, (htmlUrl as URL | undefined)?.href))
      );
      modules = [...new Set([...modules, ...impts])];
    }

    const { map, staticDeps, dynamicDeps } = await this.extractMap(
      modules,
      htmlUrl,
      rootUrl
    );

    const preloadDeps =
      (preload === true && integrity) || preload === "all"
        ? [...new Set([...staticDeps, ...dynamicDeps])]
        : staticDeps;

    const newlineTab = !whitespace
      ? analysis.newlineTab
      : analysis.newlineTab.includes("\n")
      ? analysis.newlineTab
      : "\n" + analysis.newlineTab;

    const replacer = new Replacer(html);

    let esms = "";
    if (esModuleShims) {
      let esmsPkg: ExactPackage;
      try {
        esmsPkg = await this.traceMap.resolver.resolveLatestTarget(
          {
            name: "es-module-shims",
            registry: "npm",
            ranges: [new SemverRange("*")],
            unstable: false,
          },
          this.traceMap.installer.defaultProvider,
          this.baseUrl.href
        );
      } catch (err) {
        // This usually happens because the user is trying to use their
        // node_modules as the provider but has not installed the shim:
        let errMsg = `Unable to resolve "es-module-shims@*" under current provider "${this.traceMap.installer.defaultProvider.provider}".`;
        if (
          this.traceMap.installer.defaultProvider.provider === "nodemodules"
        ) {
          errMsg += `\n\nJspm automatically injects a shim so that the import map in your HTML file will be usable by older browsers.\nYou may need to run "npm install es-module-shims" to install the shim if you want to link against your local node_modules folder.`;
        }
        errMsg += `\nTo disable the import maps polyfill injection, set esModuleShims: false.`;
        throw new JspmError(errMsg);
      }

      const esmsUrl =
        (await this.traceMap.resolver.pkgToUrl(
          esmsPkg,
          this.traceMap.installer.defaultProvider
        )) + "dist/es-module-shims.js";
      esms = `<script async src="${esmsUrl}" crossorigin="anonymous"${
        integrity
          ? ` integrity="${await getIntegrity(
              esmsUrl,
              this.traceMap.resolver.fetchOpts
            )}"`
          : ""
      }></script>${newlineTab}`;

      if (analysis.esModuleShims)
        replacer.remove(
          analysis.esModuleShims.start,
          analysis.esModuleShims.end,
          true
        );
    }

    for (const preload of analysis.preloads) {
      replacer.remove(preload.start, preload.end, true);
    }

    let preloads = "";
    if (preload && preloadDeps.length) {
      let first = true;
      for (let dep of preloadDeps.sort()) {
        if (first || whitespace) preloads += newlineTab;
        if (first) first = false;
        if (integrity) {
          preloads += `<link rel="modulepreload" href="${relativeUrl(
            new URL(dep),
            this.rootUrl || this.baseUrl,
            !!this.rootUrl
          )}" integrity="${await getIntegrity(
            dep,
            this.traceMap.resolver.fetchOpts
          )}" />`;
        } else {
          preloads += `<link rel="modulepreload" href="${relativeUrl(
            new URL(dep),
            this.rootUrl || this.baseUrl,
            !!this.rootUrl
          )}" />`;
        }
      }
    }

    // when applying integrity, all existing script tags have their integrity updated
    if (integrity) {
      for (const module of analysis.modules) {
        if (!module.attrs.src) continue;
        if (module.attrs.integrity) {
          replacer.remove(
            module.attrs.integrity.start -
              (replacer.source[
                replacer.idx(module.attrs.integrity.start - 1)
              ] === " "
                ? 1
                : 0),
            module.attrs.integrity.end + 1
          );
        }
        const lastAttr = Object.keys(module.attrs)
          .filter((attr) => attr !== "integrity")
          .sort((a, b) =>
            module.attrs[a].end > module.attrs[b].end ? -1 : 1
          )[0];
        replacer.replace(
          module.attrs[lastAttr].end + 1,
          module.attrs[lastAttr].end + 1,
          ` integrity="${await getIntegrity(
            resolveUrl(module.attrs.src.value, this.mapUrl, this.rootUrl),
            this.traceMap.resolver.fetchOpts
          )}"`
        );
      }
    }

    if (comment) {
      const existingComment = analysis.comments.find((c) =>
        replacer.source
          .slice(replacer.idx(c.start), replacer.idx(c.end))
          .includes(comment as string)
      );
      if (existingComment) {
        replacer.remove(existingComment.start, existingComment.end, true);
      }
    }

    replacer.replace(
      analysis.map.start,
      analysis.map.end,
      (comment ? "<!--" + comment + "-->" + newlineTab : "") +
        esms +
        '<script type="importmap">' +
        (whitespace ? newlineTab : "") +
        JSON.stringify(map, null, whitespace ? 2 : 0).replace(
          /\n/g,
          newlineTab
        ) +
        (whitespace ? newlineTab : "") +
        "</script>" +
        preloads +
        (analysis.map.newScript ? newlineTab : "")
    );

    return replacer.source;
  }

  /**
   * Install a package target into the import map, including all its dependency resolutions via tracing.
   *
   * @param install Package or list of packages to install into the import map.
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
   */
  async install(
    install: string | Install | (string | Install)[]
  ): Promise<void | { staticDeps: string[]; dynamicDeps: string[] }> {
    if (arguments.length !== 1)
      throw new Error("Install takes a single target string or object.");

    // Split the case of multiple install targets:
    if (Array.isArray(install))
      return await Promise.all(
        install.map((install) => this.install(install))
      ).then((installs) => installs.find((i) => i));

    // Split the case of multiple install subpaths:
    if (typeof install !== "string" && install.subpaths !== undefined) {
      install.subpaths.every((subpath) => {
        if (
          typeof subpath !== "string" ||
          (subpath !== "." && !subpath.startsWith("./"))
        )
          throw new Error(
            `Install subpath "${subpath}" must be equal to "." or start with "./".`
          );
      });
      return await Promise.all(
        install.subpaths.map((subpath) =>
          this.install({
            target: (install as Install).target,
            alias: (install as Install).alias,
            subpath,
          })
        )
      ).then((installs) => installs.find((i) => i));
    }

    // Handle case of a single install target with at most one subpath:
    let error = false;
    if (this.installCnt++ === 0) this.traceMap.startInstall();
    await this.traceMap.processInputMap; // don't race input processing
    try {
      // Resolve input information to a target package:
      let alias, target, subpath;
      if (typeof install === "string" || typeof install.target === "string") {
        ({ alias, target, subpath } = await installToTarget.call(
          this,
          install,
          this.traceMap.installer.defaultRegistry
        ));
      } else {
        ({ alias, target, subpath } = install);
        validatePkgName(alias);
      }

      // Trace the target package and it's secondary dependencies:
      this.log(
        "generator/install",
        `Adding primary constraint for ${alias}: ${JSON.stringify(target)}`
      );
      await this.traceMap.add(alias, target);
      await this.traceMap.visit(
        alias + subpath.slice(1),
        { mode: "new", toplevel: true },
        this.mapUrl.href
      );

      // Add the target package as a top-level pin:
      if (!this.traceMap.pins.includes(alias + subpath.slice(1)))
        this.traceMap.pins.push(alias + subpath.slice(1));
    } catch (e) {
      error = true;
      throw e;
    } finally {
      if (--this.installCnt === 0) {
        const { map, staticDeps, dynamicDeps } =
          await this.traceMap.finishInstall();
        this.map = map;
        if (!error) return { staticDeps, dynamicDeps };
      }
    }
  }

  async reinstall() {
    if (this.installCnt++ === 0) this.traceMap.startInstall();
    await this.traceMap.processInputMap;
    if (--this.installCnt === 0) {
      const { map, staticDeps, dynamicDeps } =
        await this.traceMap.finishInstall();
      this.map = map;
      return { staticDeps, dynamicDeps };
    }
  }

  async update(pkgNames?: string | string[]) {
    if (typeof pkgNames === "string") pkgNames = [pkgNames];
    if (this.installCnt++ === 0) this.traceMap.startInstall();
    await this.traceMap.processInputMap;
    const primaryResolutions = this.traceMap.installer.installs.primary;
    const primaryConstraints = this.traceMap.installer.constraints.primary;
    if (!pkgNames) pkgNames = Object.keys(primaryResolutions);
    const installs: Install[] = [];
    for (const name of pkgNames) {
      const resolution = primaryResolutions[name];
      if (!resolution) {
        this.installCnt--;
        throw new JspmError(
          `No "imports" package entry for "${name}" to update. Note update takes package names not package specifiers.`
        );
      }
      const { installUrl, installSubpath } = resolution;
      const subpaths = this.traceMap.pins
        .filter(
          (pin) =>
            pin === name || (pin.startsWith(name) && pin[name.length] === "/")
        )
        .map((pin) => `.${pin.slice(name.length)}` as "." | `./${string}`);
      // use package.json range if present
      if (primaryConstraints[name]) {
        installs.push({
          alias: name,
          subpaths,
          target: { pkgTarget: primaryConstraints[name], installSubpath },
        });
      }
      // otherwise synthetize a range from the current package version
      else {
        const pkg = await this.traceMap.resolver.parseUrlPkg(installUrl);
        if (!pkg)
          throw new Error(
            `Unable to determine a package version lookup for ${name}. Make sure it is supported as a provider package.`
          );
        const target = {
          pkgTarget: {
            registry: pkg.pkg.registry,
            name: pkg.pkg.name,
            ranges: [new SemverRange("^" + pkg.pkg.version)],
            unstable: false,
          },
          installSubpath,
        };
        installs.push({ alias: name, subpaths, target });
      }
    }

    await this.install(installs);
    if (--this.installCnt === 0) {
      const { map, staticDeps, dynamicDeps } =
        await this.traceMap.finishInstall();
      this.map = map;
      return { staticDeps, dynamicDeps };
    }
  }

  async uninstall(names: string | string[]) {
    if (typeof names === "string") names = [names];
    if (this.installCnt++ === 0) {
      this.traceMap.startInstall();
    }
    await this.traceMap.processInputMap;
    let pins = this.traceMap.pins;
    const unusedNames = new Set([...names]);
    for (let i = 0; i < pins.length; i++) {
      const pin = pins[i];
      const pinNames = names.filter(
        (name) => name === pin || (name.endsWith("/") && pin.startsWith(name))
      );
      if (pinNames.length) {
        pins.splice(i--, 1);
        for (const name of pinNames) unusedNames.delete(name);
      }
    }
    if (unusedNames.size) {
      this.installCnt--;
      throw new JspmError(
        `No "imports" entry for "${[...unusedNames][0]}" to uninstall.`
      );
    }
    this.traceMap.pins = pins;
    if (--this.installCnt === 0) {
      const { map } = await this.traceMap.finishInstall();
      this.map = map;
    }
  }

  async extractMap(
    pins: string | string[],
    mapUrl?: URL | string,
    rootUrl?: URL | string | null
  ) {
    if (typeof mapUrl === "string") mapUrl = new URL(mapUrl, this.baseUrl);
    if (typeof rootUrl === "string") rootUrl = new URL(rootUrl, this.baseUrl);
    if (!Array.isArray(pins)) pins = [pins];
    if (this.installCnt++ !== 0)
      throw new JspmError(`Cannot run extract map during installs`);
    this.traceMap.startInstall();
    await this.traceMap.processInputMap;
    if (--this.installCnt !== 0)
      throw new JspmError(`Another install was started during extract map.`);
    const { map, staticDeps, dynamicDeps } = await this.traceMap.finishInstall(
      pins
    );
    map.rebase(mapUrl, rootUrl);
    map.flatten();
    map.sort();
    map.combineSubpaths();
    return { map: map.toJSON(), staticDeps, dynamicDeps };
  }

  /**
   * Resolve a specifier using the import map.
   *
   * @param specifier Module to resolve
   * @param parentUrl ParentURL of module to resolve
   * @returns Resolved URL string
   */
  resolve(specifier: string, parentUrl: URL | string = this.baseUrl) {
    if (typeof parentUrl === "string")
      parentUrl = new URL(parentUrl, this.baseUrl);
    const resolved = this.map.resolve(specifier, parentUrl);
    if (resolved === null)
      throw new JspmError(
        `Unable to resolve "${specifier}" from ${parentUrl.href}`,
        "MODULE_NOT_FOUND"
      );
    return resolved;
  }

  /**
   * Get the import map JSON
   */
  get importMap() {
    return this.map;
  }

  /**
   *
   * @param url
   * @returns
   */
  getAnalysis(url: string | URL): ModuleAnalysis {
    if (typeof url !== "string") url = url.href;
    const trace = this.traceMap.tracedUrls[url];
    if (!trace)
      throw new Error(
        `The URL ${url} has not been traced by this generator instance.`
      );
    return {
      format: trace.format,
      staticDeps: trace.deps,
      dynamicDeps: trace.dynamicDeps,
      cjsLazyDeps: trace.cjsLazyDeps || [],
    };
  }

  getMap(mapUrl?: string | URL, rootUrl?: string | URL | null) {
    const map = this.map.clone();
    map.rebase(mapUrl, rootUrl);
    map.flatten();
    map.sort();
    map.combineSubpaths();
    return map.toJSON();
  }
}

export interface LookupOptions {
  provider?: string;
  cache?: "offline" | boolean;
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
export async function fetch(url: string, opts: any = {}) {
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
export async function lookup(
  install: string | Install,
  { provider, cache }: LookupOptions = {}
) {
  const generator = new Generator({ cache: !cache, defaultProvider: provider });
  const { target, subpath, alias } = await installToTarget.call(
    generator,
    install,
    generator.traceMap.installer.defaultRegistry
  );
  if (typeof target === "string")
    throw new Error(
      `Resolved install "${install}" to package specifier ${target}, but expected a fully qualified install target.`
    );

  const { pkgTarget, installSubpath } = target;
  if (pkgTarget instanceof URL) throw new Error("URL lookups not supported");
  const resolved = await generator.traceMap.resolver.resolveLatestTarget(
    pkgTarget,
    generator.traceMap.installer.getProvider(pkgTarget),
    generator.baseUrl.href
  );
  return {
    install: {
      target: {
        registry: pkgTarget.registry,
        name: pkgTarget.name,
        range: pkgTarget.ranges.map((range) => range.toString()).join(" || "),
      },
      installSubpath,
      subpath,
      alias,
    },
    resolved: resolved,
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
export async function getPackageConfig(
  pkg: string | URL | ExactPackage,
  { provider, cache }: LookupOptions = {}
): Promise<PackageConfig | null> {
  const generator = new Generator({ cache: !cache, defaultProvider: provider });
  if (typeof pkg === "object" && "name" in pkg)
    pkg = await generator.traceMap.resolver.pkgToUrl(
      pkg,
      generator.traceMap.installer.defaultProvider
    );
  else if (typeof pkg === "string") pkg = new URL(pkg).href;
  else pkg = pkg.href;
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
export async function getPackageBase(
  url: string | URL,
  { provider, cache }: LookupOptions = {}
): Promise<string> {
  const generator = new Generator({ cache: !cache, defaultProvider: provider });
  return generator.traceMap.resolver.getPackageBase(
    typeof url === "string" ? url : url.href
  );
}

async function installToTarget(
  this: Generator,
  install: Install | string,
  defaultRegistry: string
): Promise<Install> {
  if (typeof install === "string") install = { target: install };
  if (typeof install.target !== "string")
    throw new Error('All installs require a "target" string.');
  if (
    install.subpath !== undefined &&
    (typeof install.subpath !== "string" ||
      (install.subpath !== "." && !install.subpath.startsWith("./")))
  )
    throw new Error(
      `Install subpath "${
        install.subpath
      }" must be a string equal to "." or starting with "./".${
        typeof install.subpath === "string"
          ? `\nTry setting the subpath to "./${install.subpath}"`
          : ""
      }`
    );

  const { alias, target, subpath } = await parseTarget(
    this.traceMap.resolver,
    install.target as string,
    this.baseUrl,
    defaultRegistry
  );

  return {
    target,
    alias: install.alias || alias,
    subpath: install.subpath || subpath,
  };
}
