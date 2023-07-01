import {
  type InstallerOptions,
  InstallTarget,
  ResolutionMode,
  InstallMode,
} from "../install/installer.js";
import {
  importedFrom,
  isFetchProtocol,
  isPlain,
  isURL,
  resolveUrl,
} from "../common/url.js";
import { Installer } from "../install/installer.js";
import { JspmError, throwInternalError } from "../common/err.js";
import { parsePkg } from "../install/package.js";
// @ts-ignore
import {
  ImportMap,
  IImportMap,
  getMapMatch,
  getScopeMatches,
} from "@jspm/import-map";
import { isBuiltinScheme, isMappableScheme, Resolver } from "./resolver.js";
import { Log } from "../common/log.js";
import {
  mergeConstraints,
  mergeLocks,
  extractLockConstraintsAndMap,
} from "../install/lock.js";

// TODO: options as trace-specific / stored as top-level per top-level load
export interface TraceMapOptions extends InstallerOptions {
  /**
   * Whether or not to trace the dependency tree as systemJS modules.
   */
  system?: boolean;

  /**
   * Whether or not to try and trace dynamic imports.
   */
  static?: boolean;

  /**
   * Whether the import map is a full generic import map for the app, or an
   * exact trace for the provided entry points. (currently unused)
   */
  fullMap?: boolean;

  /**
   * List of module specifiers to ignore during tracing.
   */
  ignore?: string[];

  /**
   * Whether or not to enable CommonJS tracing for local dependencies.
   */
  commonJS?: boolean;
}

interface TraceGraph {
  [tracedUrls: string]: TraceEntry;
}

interface TraceEntry {
  promise: Promise<void> | null;
  deps: string[];
  dynamicDeps: string[];
  // assetDeps: { expr: string, start: number, end: number, assets: string[] }
  hasStaticParent: boolean;
  size: number;
  integrity: string;

  // wasCjs is true if the module is a CJS module, but also if it's an ESM
  // module that was transpiled from a CJS module. This is checkable on the
  // jspm.io CDN by looking for an export for the module with a '!cjs'
  // extension in its parent package:
  wasCjs: boolean;

  // usesCjs is true iff the module is both a CJS module and actually _uses_
  // CJS-specific globals like "require" or "module. If not, we can actually
  // link it for browser/deno runtimes despite it being CJS:
  usesCjs: boolean;

  // For cjs modules, the list of hoisted deps
  // this is needed for proper cycle handling
  cjsLazyDeps: string[];
  format: "esm" | "commonjs" | "system" | "json" | "typescript" | "wasm";
}

interface VisitOpts {
  static?: boolean;
  toplevel: boolean;
  installMode: InstallMode;
  visitor?: (
    specifier: string,
    parentUrl: string,
    resolvedUrl: string,
    toplevel: boolean,
    entry: TraceEntry | null
  ) => Promise<boolean | void>;
}

function combineSubpaths(
  installSubpath: `./${string}` | null,
  traceSubpath: "." | `./${string}`
): `./${string}` | "." {
  return installSubpath === null || traceSubpath === "."
    ? installSubpath || traceSubpath
    : `${installSubpath}${traceSubpath.slice(1)}`;
}

// The tracemap fully drives the installer
export default class TraceMap {
  installer: Installer | undefined;
  opts: TraceMapOptions;
  tracedUrls: TraceGraph = {};
  inputMap: ImportMap; // custom imports
  mapUrl: URL;
  baseUrl: URL;
  rootUrl: URL | null;
  pins: Array<string> = [];
  log: Log;
  resolver: Resolver;

  /**
   * Lock to ensure no races against input map processing.
   * @type {Promise<void>}
   */
  processInputMap: Promise<void> = Promise.resolve();

  constructor(opts: TraceMapOptions, log: Log, resolver: Resolver) {
    this.log = log;
    this.resolver = resolver;
    this.mapUrl = opts.mapUrl;
    this.baseUrl = opts.baseUrl;
    this.rootUrl = opts.rootUrl || null;
    this.opts = opts;
    this.inputMap = new ImportMap({
      mapUrl: this.mapUrl,
      rootUrl: this.rootUrl,
    });
    this.installer = new Installer(
      this.mapUrl.pathname.endsWith("/")
        ? (this.mapUrl.href as `${string}/`)
        : `${this.mapUrl.href}/`,
      this.opts,
      this.log,
      this.resolver
    );
  }

  async addInputMap(
    map: IImportMap,
    mapUrl: URL = this.mapUrl,
    rootUrl: URL | null = this.rootUrl,
    preloads?: string[]
  ): Promise<void> {
    return (this.processInputMap = this.processInputMap.then(async () => {
      const inMap = new ImportMap({ map, mapUrl, rootUrl }).rebase(
        this.mapUrl,
        this.rootUrl
      );
      const pins = Object.keys(inMap.imports || []);
      for (const pin of pins) {
        if (!this.pins.includes(pin)) this.pins.push(pin);
      }
      const { maps, locks, constraints } = await extractLockConstraintsAndMap(
        inMap,
        preloads,
        mapUrl,
        rootUrl,
        this.installer.defaultRegistry,
        this.resolver,
        this.installer.defaultProvider
      );
      this.inputMap.extend(maps);
      mergeLocks(this.installer.installs, locks);
      mergeConstraints(this.installer.constraints, constraints);
    }));
  }

  /**
   * Resolves, analyses and recursively visits the given module specifier and all of its dependencies.
   *
   * @param {string} specifier Module specifier to visit.
   * @param {VisitOpts} opts Visitor configuration.
   * @param {} parentUrl URL of the parent context for the specifier.
   * @param {} seen Cache for optimisation.
   */
  async visit(
    specifier: string,
    opts: VisitOpts,
    parentUrl = this.baseUrl.href,
    seen = new Set()
  ) {
    if (!parentUrl) throw new Error("Internal error: expected parentUrl");
    if (this.opts.ignore?.includes(specifier)) return;

    if (seen.has(`${specifier}##${parentUrl}`)) return;
    seen.add(`${specifier}##${parentUrl}`);

    this.log(
      "tracemap/visit",
      `Attempting to resolve ${specifier} to a module from ${parentUrl}, toplevel=${opts.toplevel}, mode=${opts.installMode}`
    );
    const resolved = await this.resolve(
      specifier,
      parentUrl,
      opts.installMode,
      opts.toplevel
    );

    // We support analysis of CommonJS modules for local workflows, where it's
    // very likely that the user has some CommonJS dependencies, but this is
    // something that the user has to explicitly enable:
    const entry = await this.getTraceEntry(resolved, parentUrl);
    if (entry?.format === "commonjs" && entry.usesCjs && !this.opts.commonJS) {
      throw new JspmError(
        `Unable to trace ${resolved}, as it is a CommonJS module. Either enable CommonJS tracing explicitly by setting "GeneratorOptions.commonJS" to true, or use a provider that performs ESM transpiling like jspm.io via defaultProvider: 'jspm.io'.`
      );
    }

    if (opts.visitor) {
      const stop = await opts.visitor(
        specifier,
        parentUrl,
        resolved,
        opts.toplevel,
        entry
      );
      if (stop) return;
    }

    if (!entry) return;

    let allDeps: string[] = [...entry.deps];
    if (entry.dynamicDeps.length && !opts.static) {
      for (const dep of entry.dynamicDeps) {
        if (!allDeps.includes(dep)) allDeps.push(dep);
      }
    }
    if (entry.cjsLazyDeps && !opts.static) {
      for (const dep of entry.cjsLazyDeps) {
        if (!allDeps.includes(dep)) allDeps.push(dep);
      }
    }

    if (opts.toplevel && (isMappableScheme(specifier) || isPlain(specifier))) {
      opts = { ...opts, toplevel: false };
    }

    await Promise.all(
      allDeps.map(async (dep) => {
        if (dep.indexOf("*") !== -1) {
          this.log("todo", "Handle wildcard trace " + dep + " in " + resolved);
          return;
        }
        await this.visit(dep, opts, resolved, seen);
      })
    );
  }

  async extractMap(modules: string[]) {
    const map = new ImportMap({ mapUrl: this.mapUrl, rootUrl: this.rootUrl });
    // note this plucks custom top-level custom imports
    // we may want better control over this
    map.extend(this.inputMap);
    // re-drive all the traces to convergence
    do {
      this.installer!.newInstalls = false;
      await Promise.all(
        modules.map(async (module) => {
          await this.visit(module, {
            installMode: "freeze", // pruning shouldn't change versions
            static: this.opts.static,
            toplevel: true,
          });
        })
      );
    } while (this.installer!.newInstalls);

    // The final loop gives us the mappings
    const staticList = new Set();
    const dynamicList = new Set();
    const dynamics: [string, string][] = [];
    let list = staticList;
    const visitor = async (
      specifier: string,
      parentUrl: string,
      resolved: string,
      toplevel: boolean,
      entry
    ) => {
      if (!staticList.has(resolved)) list.add(resolved);
      if (entry)
        for (const dep of entry.dynamicDeps) {
          dynamics.push([dep, resolved]);
        }
      if (toplevel) {
        if (isPlain(specifier) || isMappableScheme(specifier)) {
          const existing = map.imports[specifier];
          if (
            !existing ||
            (existing !== resolved && this.tracedUrls?.[parentUrl]?.wasCjs)
          ) {
            map.set(specifier, resolved);
          }
        }
      } else {
        if (isPlain(specifier) || isMappableScheme(specifier)) {
          const scopeUrl = await this.resolver.getPackageBase(parentUrl);
          const existing = map.scopes[scopeUrl]?.[specifier];
          if (!existing) {
            map.set(specifier, resolved, scopeUrl);
          } else if (
            existing !== resolved &&
            map.scopes[parentUrl]?.[specifier] !== resolved
          ) {
            map.set(specifier, resolved, parentUrl);
          }
        }
      }
    };

    const seen = new Set();
    await Promise.all(
      modules.map(async (module) => {
        await this.visit(
          module,
          {
            static: true,
            visitor,
            installMode: "freeze",
            toplevel: true,
          },
          this.baseUrl.href,
          seen
        );
      })
    );

    list = dynamicList;
    await Promise.all(
      dynamics.map(async ([specifier, parent]) => {
        await this.visit(
          specifier,
          { visitor, installMode: "freeze", toplevel: false },
          parent,
          seen
        );
      })
    );

    if (this.installer!.newInstalls) {
      // Disabled as it obscures valid errors
      // console.warn('Unexpected resolution divergence.');
    }

    return {
      map,
      staticDeps: [...staticList] as string[],
      dynamicDeps: [...dynamicList] as string[],
    };
  }

  startInstall() {
    this.installer.startInstall();
  }

  async finishInstall(
    modules = this.pins
  ): Promise<{ map: ImportMap; staticDeps: string[]; dynamicDeps: string[] }> {
    const result = await this.extractMap(modules);
    this.installer.finishInstall();
    return result;
  }

  async add(
    name: string,
    target: InstallTarget,
    opts: InstallMode
  ): Promise<void> {
    await this.installer.installTarget(
      name,
      target,
      null,
      opts,
      null,
      this.mapUrl.href
    );
  }

  /**
   * @returns `resolved` - either a URL `string` pointing to the module or `null` if the specifier should be ignored.
   */
  async resolve(
    specifier: string,
    parentUrl: string,
    installOpts: InstallMode,
    toplevel: boolean
  ): Promise<string> {
    const cjsEnv = this.tracedUrls[parentUrl]?.wasCjs;

    const parentPkgUrl = await this.resolver.getPackageBase(parentUrl);
    if (!parentPkgUrl) throwInternalError();

    const parentIsCjs = this.tracedUrls[parentUrl]?.format === "commonjs";

    if (
      (!isPlain(specifier) || specifier === "..") &&
      !isMappableScheme(specifier)
    ) {
      let resolvedUrl = new URL(specifier, parentUrl);
      if (!isFetchProtocol(resolvedUrl.protocol))
        throw new JspmError(
          `Found unexpected protocol ${resolvedUrl.protocol}${importedFrom(
            parentUrl
          )}`
        );
      const resolvedHref = resolvedUrl.href;
      let finalized = await this.resolver.realPath(
        await this.resolver.finalizeResolve(
          resolvedHref,
          parentIsCjs,
          parentPkgUrl
        )
      );

      // handle URL mappings
      const urlResolved = this.inputMap.resolve(finalized, parentUrl) as string;
      // TODO: avoid this hack - perhaps solved by conditional maps
      if (
        urlResolved !== finalized &&
        !urlResolved.startsWith("node:") &&
        !urlResolved.startsWith("deno:")
      ) {
        finalized = urlResolved;
      }
      if (finalized !== resolvedHref) {
        this.inputMap.set(
          resolvedHref.endsWith("/") ? resolvedHref.slice(0, -1) : resolvedHref,
          finalized
        );
        resolvedUrl = new URL(finalized);
      }
      this.log(
        "tracemap/resolve",
        `${specifier} ${parentUrl} -> ${resolvedUrl} (URL resolution)`
      );
      return resolvedUrl.href;
    }

    // Subscope override
    const scopeMatches = getScopeMatches(
      parentUrl,
      this.inputMap.scopes,
      this.inputMap.mapUrl
    );
    const pkgSubscopes = scopeMatches.filter(([, url]) =>
      url.startsWith(parentPkgUrl)
    );
    if (pkgSubscopes.length) {
      for (const [scope] of pkgSubscopes) {
        const mapMatch = getMapMatch(specifier, this.inputMap.scopes[scope]);
        if (mapMatch) {
          const resolved = await this.resolver.realPath(
            resolveUrl(
              this.inputMap.scopes[scope][mapMatch] +
                specifier.slice(mapMatch.length),
              this.inputMap.mapUrl,
              this.inputMap.rootUrl
            )
          );
          this.log(
            "tracemap/resolve",
            `${specifier} ${parentUrl} -> ${resolved} (subscope resolution)`
          );
          return resolved;
        }
      }
    }

    // Scope override
    // TODO: isn't this subsumed by previous check?
    const userScopeMatch = scopeMatches.find(([, url]) => url === parentPkgUrl);
    if (userScopeMatch) {
      const imports = this.inputMap.scopes[userScopeMatch[0]];
      const userImportsMatch = getMapMatch(specifier, imports);
      const userImportsResolved = userImportsMatch
        ? await this.resolver.realPath(
            resolveUrl(
              imports[userImportsMatch] +
                specifier.slice(userImportsMatch.length),
              this.inputMap.mapUrl,
              this.inputMap.rootUrl
            )
          )
        : null;
      if (userImportsResolved) {
        this.log(
          "tracemap/resolve",
          `${specifier} ${parentUrl} -> ${userImportsResolved} (scope resolution)`
        );
        return userImportsResolved;
      }
    }

    // User import overrides
    const userImportsMatch = getMapMatch(specifier, this.inputMap.imports);
    const userImportsResolved = userImportsMatch
      ? await this.resolver.realPath(
          resolveUrl(
            this.inputMap.imports[userImportsMatch] +
              specifier.slice(userImportsMatch.length),
            this.inputMap.mapUrl,
            this.inputMap.rootUrl
          )
        )
      : null;
    if (userImportsResolved) {
      this.log(
        "tracemap/resolve",
        `${specifier} ${parentUrl} -> ${userImportsResolved} (imports resolution)`
      );
      return userImportsResolved;
    }

    const parsed = parsePkg(specifier);
    if (!parsed) throw new JspmError(`Invalid package name ${specifier}`);
    const { pkgName, subpath } = parsed;

    // Own name import
    const pcfg = (await this.resolver.getPackageConfig(parentPkgUrl)) || {};
    if (pcfg.exports && pcfg.name === pkgName) {
      const resolved = await this.resolver.realPath(
        await this.resolver.resolveExport(
          parentPkgUrl,
          subpath,
          cjsEnv,
          parentIsCjs,
          specifier,
          this.installer,
          new URL(parentUrl)
        )
      );
      this.log(
        "tracemap/resolve",
        `${specifier} ${parentUrl} -> ${resolved} (package own-name resolution)`
      );
      return resolved;
    }

    // Imports
    if (pcfg.imports && pkgName[0] === "#") {
      const match = getMapMatch(specifier, pcfg.imports);
      if (!match)
        throw new JspmError(
          `No '${specifier}' import defined in ${parentPkgUrl}${importedFrom(
            parentUrl
          )}.`
        );
      const target = this.resolver.resolvePackageTarget(
        pcfg.imports[match],
        parentPkgUrl,
        cjsEnv,
        specifier.slice(match.length),
        true
      );
      if (!isURL(target)) {
        return this.resolve(target, parentUrl, installOpts, toplevel);
      }
      const resolved = await this.resolver.realPath(target);
      this.log(
        "tracemap/resolve",
        `${specifier} ${parentUrl} -> ${resolved} (package imports resolution)`
      );
      return resolved;
    }

    // @ts-ignore
    const installed = await this.installer.install(
      pkgName,
      installOpts,
      toplevel ? null : parentPkgUrl,
      subpath,
      parentUrl
    );
    if (typeof installed === "string") {
      return installed;
    } else if (installed) {
      const { installUrl, installSubpath } = installed;
      const resolved = await this.resolver.realPath(
        await this.resolver.resolveExport(
          installUrl,
          combineSubpaths(installSubpath, subpath),
          cjsEnv,
          parentIsCjs,
          specifier,
          this.installer,
          new URL(parentUrl)
        )
      );
      this.log(
        "tracemap/resolve",
        `${specifier} ${parentUrl} -> ${resolved} (installation resolution)`
      );
      return resolved;
    }

    throw new JspmError(
      `No resolution in map for ${specifier}${importedFrom(parentUrl)}`
    );
  }

  private async getTraceEntry(
    resolvedUrl: string,
    parentUrl: string
  ): Promise<TraceEntry | null> {
    if (resolvedUrl in this.tracedUrls) {
      const entry = this.tracedUrls[resolvedUrl];
      await entry.promise;
      return entry;
    }

    if (isBuiltinScheme(resolvedUrl)) return null;

    if (resolvedUrl.endsWith("/"))
      throw new JspmError(
        `Trailing "/" installs not supported installing ${resolvedUrl} for ${parentUrl}`
      );

    const traceEntry: TraceEntry = (this.tracedUrls[resolvedUrl] = {
      promise: null,
      wasCjs: false,
      usesCjs: false,
      deps: null,
      dynamicDeps: null,
      cjsLazyDeps: null,
      hasStaticParent: true,
      size: NaN,
      integrity: "",
      format: undefined,
    });

    traceEntry.promise = (async () => {
      const parentIsCjs = this.tracedUrls[parentUrl]?.format === "commonjs";

      const { deps, dynamicDeps, cjsLazyDeps, size, format, usesCjs } =
        await this.resolver.analyze(
          resolvedUrl,
          parentUrl,
          this.opts.system,
          parentIsCjs
        );
      traceEntry.format = format;
      traceEntry.size = size;
      traceEntry.deps = deps.sort();
      traceEntry.dynamicDeps = dynamicDeps.sort();
      traceEntry.cjsLazyDeps = cjsLazyDeps ? cjsLazyDeps.sort() : cjsLazyDeps;

      // wasCJS distinct from CJS because it applies to CJS transformed into ESM
      // from the resolver perspective
      const wasCJS =
        format === "commonjs" || (await this.resolver.wasCommonJS(resolvedUrl));
      if (wasCJS) traceEntry.wasCjs = true;

      traceEntry.promise = null;
    })();
    await traceEntry.promise;
    return traceEntry;
  }
}
