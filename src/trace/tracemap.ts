import { type InstallOptions, InstallTarget, PackageProvider } from "../install/installer.js";
import { importedFrom, isPlain, isURL } from "../common/url.js";
import { Installer } from "../install/installer.js";
import { JspmError, throwInternalError } from "../common/err.js";
import { parsePkg } from "../install/package.js";
// @ts-ignore
import { ImportMap, IImportMap, getMapMatch, getScopeMatches } from '@jspm/import-map';
import { resolvePackageTarget, Resolver } from "./resolver.js";
import { Log } from "../common/log.js";
import { extractLockAndMap } from "../install/lock.js";

// TODO: options as trace-specific / stored as top-level per top-level load
export interface TraceMapOptions extends InstallOptions {
  system?: boolean;
  env?: string[];

  // input map
  inputMap?: IImportMap;
  // do not trace dynamic imports
  static?: boolean;

  // whether the import map is a full generic import map for the app
  // or an exact trace for the provided entry points
  // (currently unused)
  fullMap?: boolean;

  // List of module specifiers to ignore during tracing
  ignore?: string[]
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
  wasCJS: boolean;
  // For cjs modules, the list of hoisted deps
  // this is needed for proper cycle handling
  cjsLazyDeps: string[];
  format: 'esm' | 'commonjs' | 'system' | 'json' | 'typescript';
}

// The tracemap fully drives the installer
export default class TraceMap {
  dynamicList: Set<string> = new Set();
  staticList: Set<string> = new Set();
  env = ['browser', 'development', 'module', 'import'];
  cjsEnv = null;
  installer: Installer | undefined;
  opts: TraceMapOptions;
  tracedUrls: TraceGraph = {};
  inputMap: ImportMap;
  map: ImportMap;
  mapBase: URL;
  pins: Array<string> = [];
  log: Log;
  resolver: Resolver;
  processedInputMap = false;

  constructor (mapBase: URL, opts: TraceMapOptions, log: Log, resolver: Resolver) {
    this.log = log;
    this.resolver = resolver;
    this.mapBase = mapBase;
    this.opts = opts;
    if (this.opts.env) {
      if (this.opts.env.includes('require'))
        throw new Error('Cannot manually pass require condition');
      if (!this.opts.env.includes('import'))
        this.opts.env.push('import');
      this.env = this.opts.env;
    }
    this.inputMap = new ImportMap(this.mapBase);
    this.map = new ImportMap(this.mapBase);
    this.cjsEnv = this.env.map(e => e === 'import' ? 'require' : e);
    this.installer = new Installer(this.mapBase, this.opts, this.log, this.resolver);
  }

  replace (target: InstallTarget, pkgUrl: string, provider: PackageProvider): boolean {
    return this.installer!.replace(target, pkgUrl, provider);
  }

  async visit (specifier: string, parentUrl = this.mapBase, dynamic = !this.opts.static, visitor: (specifier: string, parentUrl: URL, resolvedUrl: string, entry: TraceEntry) => Promise<boolean | void> = (async () => {}), seen = new Set()) {
    if (seen.has(specifier + '##' + parentUrl))
      return;
    seen.add(specifier + '##' + parentUrl);

    const resolved = await this.resolve(specifier, parentUrl);

    // TODO: support ignoring prefixes?
    if (this.opts.ignore?.includes(specifier)) return null;

    const entry = await this.getTraceEntry(resolved, parentUrl);
    if (!entry)
      return;

    let allDeps: string[] = [...entry.deps];
    if (entry.dynamicDeps.length && dynamic) {
      for (const dep of entry.dynamicDeps) {
        if (!allDeps.includes(dep))
          allDeps.push(dep);
      }
    }
    if (entry.cjsLazyDeps && dynamic) {
      for (const dep of entry.cjsLazyDeps) {
        if (!allDeps.includes(dep))
          allDeps.push(dep);
      }
    }

    const stop = await visitor(specifier, parentUrl, resolved, entry);
    if (stop) return;

    const resolvedURL = new URL(resolved);
    await Promise.all(allDeps.map(async dep => {
      if (dep.indexOf('*') !== -1) {
        this.log('todo', 'Handle wildcard trace ' + dep + ' in ' + resolved);
        return;
      }
      await this.visit(dep, resolvedURL, dynamic, visitor, seen);
    }));
  }

  async pruneInstall (pins = this.pins) {
    this.map = new ImportMap(this.mapBase);
    this.map.extend(this.inputMap);
    // re-drive all the traces to convergence
    do {
      this.installer!.newInstalls = false;
      await Promise.all(pins.map(async pin => {
        await this.visit(pin);
      }));
    } while (this.installer!.newInstalls);

    // The final loop gives us the mappings
    this.staticList = new Set();
    this.dynamicList = new Set();
    const dynamics: [string, string][] = [];
    let list = this.staticList;
    const depVisitor = async (specifier: string, parentUrl: URL, resolved: string, entry) => {
      if (!this.staticList.has(resolved))
        list.add(resolved);
      for (const dep of entry.dynamicDeps) {
        dynamics.push([dep, resolved]);
      }
      if (parentUrl.href === this.mapBase.href) {
        if (isPlain(specifier)) {
          const existing = this.map.imports[specifier];
          if (!existing || existing !== resolved && this.tracedUrls?.[parentUrl.href]?.wasCJS)
            this.map.set(specifier, resolved);
        }
      }
      else {
        const parentPkgUrl = await this.resolver.getPackageBase(parentUrl.href);
        if (isPlain(specifier)) {
          const existing = this.map.scopes[parentPkgUrl]?.[specifier];
          if (!existing || existing !== resolved && this.tracedUrls?.[parentUrl.href]?.wasCJS)
            this.map.set(specifier, resolved, parentPkgUrl);
        }
      }
    };

    await Promise.all(pins.map(async pin => {
      await this.visit(pin, this.mapBase, false, depVisitor);
    }));

    list = this.dynamicList;
    await Promise.all(dynamics.map(async ([specifier, parent]) => {
      // TODO: perf, stop on reentrancy. Important that reentrancy is specifier + parent duplication though.
      await this.visit(specifier, new URL(parent), true, depVisitor);
    }));

    if (this.installer!.newInstalls)
      throw new Error('Internal error: unexpected resolution divergence');
  }

  async startInstall () {
    if (!this.processedInputMap && this.opts.inputMap) {
      const { maps, lock } = await extractLockAndMap(this.opts.inputMap, [], this.mapBase, this.opts.rootUrl, this.resolver);
      this.inputMap.extend(maps);
      Object.keys(this.inputMap.imports).forEach(pin => {
        if (!this.pins.includes(pin))
          this.pins.push(pin);
      });
      this.installer.installs = lock;
      this.processedInputMap = true;
    }

    const finishInstall = await this.installer.startInstall();

    return async () => {
      const outMap = await this.pruneInstall();
      return finishInstall(true);
    };
  }

  pin (specifier: string) {
    if (!this.pins.includes(specifier))
      this.pins.push(specifier);
  }

  async add (name: string, target: InstallTarget, persist = true): Promise<string> {
    const installed = await this.installer!.installTarget(name, target, this.mapBase.href, persist, null, this.mapBase.href);
    return installed.slice(0, -1);
  }

  // async addAllPkgMappings (name: string, pkgUrl: string, parentPkgUrl: string | null = null) {
  //   const [url, subpathFilter] = pkgUrl.split('|');
  //   const exports = await this.resolver.getExports(url + (url.endsWith('/') ? '' : '/'), env, subpathFilter);
  //   for (const key of Object.keys(exports)) {
  //     if (key.endsWith('!cjs'))
  //       continue;
  //     if (!exports[key])
  //       continue;
  //     if (key.endsWith('*'))
  //       continue;
  //     let target = new URL(exports[key], url).href;
  //     if (!exports[key].endsWith('/') && target.endsWith('/'))
  //       target = target.slice(0, -1);
  //     this.map.addMapping(name + key.slice(1), target, parentPkgUrl);
  //   }
  // }

  /**
   * @returns `resolved` - either a URL `string` pointing to the module or `null` if the specifier should be ignored.
   */
  async resolve (specifier: string, parentUrl: URL): Promise<string> {
    const env = this.tracedUrls[parentUrl.href]?.wasCJS ? this.cjsEnv : this.env;

    const parentPkgUrl = await this.resolver.getPackageBase(parentUrl.href);
    if (!parentPkgUrl)
      throwInternalError();

    const parentIsCjs = this.tracedUrls[parentUrl.href]?.format === 'commonjs';

    if (!isPlain(specifier)) {
      let resolvedUrl = new URL(specifier, parentUrl);
      if (resolvedUrl.protocol !== 'file:' && resolvedUrl.protocol !== 'https:' && resolvedUrl.protocol !== 'http:' && resolvedUrl.protocol !== 'node:' && resolvedUrl.protocol !== 'data:')
        throw new JspmError(`Found unexpected protocol ${resolvedUrl.protocol}${importedFrom(parentUrl)}`);
      const resolvedHref = resolvedUrl.href;
      let finalized = await this.resolver.realPath(await this.resolver.finalizeResolve(resolvedHref, parentIsCjs, env, this.installer, parentPkgUrl));
      // handle URL mappings
      const urlResolved = this.inputMap.resolve(finalized, parentUrl, env) as string;
      const doNodeMaps = env.includes('deno') || (env.includes('browser') && !env.includes('electron'));
      // TODO: avoid this hack - perhaps solved by conditional maps
      if (urlResolved !== finalized && !urlResolved.startsWith('node:')) {
        finalized = urlResolved;
      }
      // TODO: avoid this hack too - we should not be resolving node:... to the core lib anyway?
      if (finalized !== resolvedHref && (!resolvedHref.startsWith('node:') || doNodeMaps)) {
        this.inputMap.set(resolvedHref.endsWith('/') ? resolvedHref.slice(0, -1) : resolvedHref, finalized, parentPkgUrl);
        resolvedUrl = new URL(finalized);
      }
      this.log('resolve', `${specifier} ${parentUrl.href} -> ${resolvedUrl}`);
      return resolvedUrl.href;
    }
  
    const parsed = parsePkg(specifier);
    if (!parsed) throw new JspmError(`Invalid package name ${specifier}`);
    const { pkgName, subpath } = parsed;
  
    // Subscope override
    const scopeMatches = getScopeMatches(parentUrl, this.inputMap.scopes, this.inputMap.baseUrl);
    const pkgSubscopes = scopeMatches.filter(([, url]) => url.startsWith(parentPkgUrl));
    if (pkgSubscopes.length) {
      for (const [scope] of pkgSubscopes) {
        const mapMatch = getMapMatch(specifier, this.inputMap.scopes[scope]);
        if (mapMatch) {
          const resolved = await this.resolver.realPath(new URL(this.inputMap.scopes[scope][mapMatch] + specifier.slice(mapMatch.length), this.inputMap.baseUrl).href);
          this.log('resolve', `${specifier} ${parentUrl.href} -> ${resolved}`);
          return resolved;
        }
      }
    }
  
    // Scope override
    const userScopeMatch = scopeMatches.find(([, url]) => url === parentPkgUrl);
    if (userScopeMatch) {
      const imports = this.inputMap.scopes[userScopeMatch[0]];
      const userImportsMatch = getMapMatch(specifier, imports);
      const userImportsResolved = userImportsMatch ? await this.resolver.realPath(new URL(imports[userImportsMatch] + specifier.slice(userImportsMatch.length), this.inputMap.baseUrl).href) : null;
      if (userImportsResolved) {
        this.log('resolve', `${specifier} ${parentUrl.href} -> ${userImportsResolved}`);
        return userImportsResolved;
      }
    }

    // User import overrides
    const userImportsMatch = getMapMatch(specifier, this.inputMap.imports);
    const userImportsResolved = userImportsMatch ? await this.resolver.realPath(new URL(this.inputMap.imports[userImportsMatch] + specifier.slice(userImportsMatch.length), this.inputMap.baseUrl).href) : null;
    if (userImportsResolved) {
      this.log('resolve', `${specifier} ${parentUrl.href} -> ${userImportsResolved}`);
      return userImportsResolved;
    }

    // Own name import
    const pcfg = await this.resolver.getPackageConfig(parentPkgUrl) || {};
    if (pcfg.exports && pcfg.name === pkgName) {
      const resolved = await this.resolver.realPath(await this.resolver.resolveExport(parentPkgUrl, subpath, env, parentIsCjs, specifier, this.installer, parentUrl));
      this.log('resolve', `${specifier} ${parentUrl.href} -> ${resolved}`);
      return resolved;
    }

    // Imports
    if (pcfg.imports && pkgName[0] === '#') {
      const match = getMapMatch(specifier, pcfg.imports);
      if (!match)
        throw new JspmError(`No '${specifier}' import defined in ${parentPkgUrl}${importedFrom(parentUrl)}.`);
      const target = resolvePackageTarget(pcfg.imports[match], parentPkgUrl, env, specifier.slice(match.length), true);
      if (!isURL(target)) {
        return this.resolve(target, parentUrl);
      }
      const resolved = await this.resolver.realPath(target);
      this.log('resolve', `${specifier} ${parentUrl.href} -> ${resolved}`);
      return resolved;
    }

    // @ts-ignore
    const installed = this.installer?.installs[parentPkgUrl]?.[pkgName] || !this.opts.freeze && await this.installer?.install(pkgName, parentPkgUrl, subpath === './' ? false : true, parentUrl.href);
    if (installed) {
      let [pkgUrl, subpathBase] = installed.split('|');
      if (subpathBase && !pkgUrl.endsWith('/'))
        pkgUrl += '/';
      const key = subpathBase ? './' + subpathBase + subpath.slice(1) : subpath;
      const resolved = await this.resolver.realPath(await this.resolver.resolveExport(pkgUrl, key, env, parentIsCjs, specifier, this.installer, parentUrl));
      this.log('resolve', `${specifier} ${parentUrl.href} -> ${resolved}`);
      return resolved;
    }

    throw new JspmError(`No resolution in map for ${specifier}${importedFrom(parentUrl)}`);
  }

  private async getTraceEntry (resolvedUrl: string, parentUrl: URL): Promise<TraceEntry | null> {
    if (resolvedUrl in this.tracedUrls) {
      const entry = this.tracedUrls[resolvedUrl];
      await entry.promise;
      return entry;
    }
    if (resolvedUrl.startsWith('node:'))
      return null;

    if (resolvedUrl.endsWith('/'))
      throw new JspmError(`Trailing "/" installs not supported installing ${resolvedUrl} for ${parentUrl.href}`);

    const traceEntry: TraceEntry = this.tracedUrls[resolvedUrl] = {
      promise: null,
      wasCJS: false,
      deps: null,
      dynamicDeps: null,
      cjsLazyDeps: null,
      hasStaticParent: true,
      size: NaN,
      integrity: '',
      format: undefined
    };

    traceEntry.promise = (async () => {
      const parentIsCjs = this.tracedUrls[parentUrl.href]?.format === 'commonjs';

      const { deps, dynamicDeps, cjsLazyDeps, size, format } = await this.resolver.analyze(resolvedUrl, parentUrl, this.opts.system, parentIsCjs);
      traceEntry.format = format;
      traceEntry.size = size;
      traceEntry.deps = deps.sort();
      traceEntry.dynamicDeps = dynamicDeps.sort();
      traceEntry.cjsLazyDeps = cjsLazyDeps ? cjsLazyDeps.sort() : cjsLazyDeps;
  
      // wasCJS distinct from CJS because it applies to CJS transformed into ESM
      // from the resolver perspective
      const wasCJS = format === 'commonjs' || await this.resolver.wasCommonJS(resolvedUrl);
      if (wasCJS)
        traceEntry.wasCJS = true;

      traceEntry.promise = null;
    })();
    await traceEntry.promise;
    return traceEntry;
  }
}
