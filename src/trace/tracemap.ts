import { type InstallOptions, InstallTarget, PackageProvider } from "../install/installer.js";
import { importedFrom, isKnownProtocol, isMappableScheme, isPlain, isURL, resolveUrl } from "../common/url.js";
import { Installer } from "../install/installer.js";
import { JspmError, throwInternalError } from "../common/err.js";
import { parsePkg } from "../install/package.js";
// @ts-ignore
import { ImportMap, IImportMap, getMapMatch, getScopeMatches } from '@jspm/import-map';
import { resolvePackageTarget, Resolver } from "./resolver.js";
import { Log } from "../common/log.js";
import { extendConstraints, extendLock, extractLockConstraintsAndMap } from "../install/lock.js";

// TODO: options as trace-specific / stored as top-level per top-level load
export interface TraceMapOptions extends InstallOptions {
  system?: boolean;
  env?: string[];

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

interface VisitOpts {
  static?: boolean,
  toplevel: boolean,
  mode: 'new-primary' | 'new-secondary' | 'existing-primary' | 'existing-secondary',
  visitor?: (specifier: string, parentUrl: string, resolvedUrl: string, toplevel: boolean, entry: TraceEntry) => Promise<boolean | void>
};

// The tracemap fully drives the installer
export default class TraceMap {
  env = ['browser', 'development', 'module', 'import'];
  cjsEnv = null;
  installer: Installer | undefined;
  opts: TraceMapOptions;
  tracedUrls: TraceGraph = {};
  inputMap: ImportMap;
  mapUrl: URL;
  rootUrl: URL | null;
  pins: Array<string> = [];
  log: Log;
  resolver: Resolver;
  processInputMap: Promise<void> = Promise.resolve();

  constructor (opts: TraceMapOptions, log: Log, resolver: Resolver) {
    this.log = log;
    this.resolver = resolver;
    this.mapUrl = opts.mapUrl;
    this.rootUrl = opts.rootUrl || null;
    this.opts = opts;
    if (this.opts.env) {
      if (this.opts.env.includes('require'))
        throw new Error('Cannot manually pass require condition');
      if (!this.opts.env.includes('import'))
        this.opts.env.push('import');
      this.env = this.opts.env;
    }
    this.inputMap = new ImportMap({ mapUrl: this.mapUrl, rootUrl: this.rootUrl });
    this.cjsEnv = this.env.map(e => e === 'import' ? 'require' : e);
    this.installer = new Installer(this.mapUrl.pathname.endsWith('/') ? this.mapUrl.href as `${string}/` : `${this.mapUrl.href}/`, this.opts, this.log, this.resolver);
  }

  async addInputMap (map: IImportMap, mapUrl: URL = this.mapUrl, rootUrl: URL | null = this.rootUrl, preloads?: string[]): Promise<void> {
    return this.processInputMap = this.processInputMap.then(async () => {
      const inMap = new ImportMap({ map, mapUrl, rootUrl }).rebase(this.mapUrl, this.rootUrl);
      const pins = Object.keys(inMap.imports || []);
      for (const pin of pins) {
        if (!this.pins.includes(pin))
          this.pins.push(pin);
      }
      const { maps, lock, constraints } = await extractLockConstraintsAndMap(inMap, preloads, mapUrl, rootUrl, this.installer.defaultRegistry, this.resolver);
      this.inputMap.extend(maps);
      extendLock(this.installer.installs, lock);
      extendConstraints(this.installer.constraints, constraints);
    });
  }

  replace (target: InstallTarget, pkgUrl: `${string}/`, provider: PackageProvider): boolean {
    return this.installer!.replace(target, pkgUrl, provider);
  }

  async visit (specifier: string, opts: VisitOpts, parentUrl: string, seen = new Set()) {
    if (!parentUrl)
      throw new Error('Internal error: expected parentUrl');
    // TODO: support ignoring prefixes?
    if (this.opts.ignore?.includes(specifier)) return;

    if (seen.has(`${specifier}##${parentUrl}`))
      return;
    seen.add(`${specifier}##${parentUrl}`);

    // This should probably be baseUrl?
    const resolved = await this.resolve(specifier, parentUrl, opts.mode, opts.toplevel);

    const entry = await this.getTraceEntry(resolved, parentUrl);
    if (!entry)
      return;

    let allDeps: string[] = [...entry.deps];
    if (entry.dynamicDeps.length && !opts.static) {
      for (const dep of entry.dynamicDeps) {
        if (!allDeps.includes(dep))
          allDeps.push(dep);
      }
    }
    if (entry.cjsLazyDeps && !opts.static) {
      for (const dep of entry.cjsLazyDeps) {
        if (!allDeps.includes(dep))
          allDeps.push(dep);
      }
    }

    if (opts.visitor) {
      const stop = await opts.visitor(specifier, parentUrl, resolved, opts.toplevel, entry);
      if (stop) return;
    }

    // Trace install first bare specifier -> pin and start scoping
    const toplevel = opts.toplevel;
    if (toplevel && (isPlain(specifier) || isMappableScheme(specifier))) {
      // if (this.pins.indexOf(specifier) === -1)
      //   this.pins.push(specifier);
      opts = { ...opts, toplevel: false };
    }

    await Promise.all(allDeps.map(async dep => {
      if (dep.indexOf('*') !== -1) {
        this.log('todo', 'Handle wildcard trace ' + dep + ' in ' + resolved);
        return;
      }
      if (opts.mode.endsWith('-primary'))
        opts = { ...opts, mode: opts.mode.startsWith('new-') ? 'new-secondary' : 'existing-secondary' };
      await this.visit(dep, opts, resolved, seen);
    }));
  }

  async extractMap (modules: string[]) {
    const map = new ImportMap({ mapUrl: this.mapUrl, rootUrl: this.rootUrl });
    // note this plucks custom top-level custom imports
    // we may want better control over this
    map.extend(this.inputMap);
    // re-drive all the traces to convergence
    do {
      this.installer!.newInstalls = false;
      await Promise.all(modules.map(async module => {
        await this.visit(module, { mode: 'existing-primary', static: this.opts.static, toplevel: true }, this.mapUrl.href);
      }));
    } while (this.installer!.newInstalls);

    // The final loop gives us the mappings
    const staticList = new Set();
    const dynamicList = new Set();
    const dynamics: [string, string][] = [];
    let list = staticList;
    const visitor = async (specifier: string, parentUrl: string, resolved: string, toplevel: boolean, entry) => {
      if (!staticList.has(resolved))
        list.add(resolved);
      for (const dep of entry.dynamicDeps) {
        dynamics.push([dep, resolved]);
      }
      if (toplevel) {
        if (isPlain(specifier) || isMappableScheme(specifier)) {
          const existing = map.imports[specifier];
          if (!existing || existing !== resolved && this.tracedUrls?.[parentUrl]?.wasCJS)
            map.set(specifier, resolved);
        }
      }
      else {
        const parentPkgUrl = await this.resolver.getPackageBase(parentUrl);
        if (isPlain(specifier) || isMappableScheme(specifier)) {
          const existing = map.scopes[parentPkgUrl]?.[specifier];
          if (!existing || existing !== resolved && this.tracedUrls?.[parentUrl]?.wasCJS)
            map.set(specifier, resolved, parentPkgUrl);
        }
      }
    };

    const seen = new Set();
    await Promise.all(modules.map(async module => {
      await this.visit(module, { static: true, visitor, mode: 'existing-primary', toplevel: true }, this.mapUrl.href, seen);
    }));

    list = dynamicList;
    await Promise.all(dynamics.map(async ([specifier, parent]) => {
      await this.visit(specifier, { visitor, mode: 'existing-secondary', toplevel: false }, parent, seen);
    }));

    if (this.installer!.newInstalls)
      throw new Error('Internal error: unexpected resolution divergence');

    return { map, staticDeps: [...staticList] as string[], dynamicDeps: [...dynamicList] as string[] };
  }

  startInstall () {
    this.installer.startInstall();
  }

  async finishInstall (modules = this.pins): Promise<{ map: ImportMap, staticDeps: string[], dynamicDeps: string[] }> {
    const result = await this.extractMap(modules);
    this.installer.finishInstall();
    return result;
  }

  async add (name: string, target: InstallTarget): Promise<string> {
    const { installUrl } = await this.installer.installTarget(name, target, 'new-primary', null, this.mapUrl.href);
    return installUrl.slice(0, -1);
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
  async resolve (specifier: string, parentUrl: string, mode: 'new-primary' | 'new-secondary' | 'existing-primary' | 'existing-secondary', toplevel: boolean): Promise<string> {
    const env = this.tracedUrls[parentUrl]?.wasCJS ? this.cjsEnv : this.env;

    const parentPkgUrl = await this.resolver.getPackageBase(parentUrl);
    if (!parentPkgUrl)
      throwInternalError();

    const parentIsCjs = this.tracedUrls[parentUrl]?.format === 'commonjs';

    if (!isPlain(specifier)) {
      let resolvedUrl = new URL(specifier, parentUrl);
      if (!isKnownProtocol(resolvedUrl.protocol))
        throw new JspmError(`Found unexpected protocol ${resolvedUrl.protocol}${importedFrom(parentUrl)}`);
      const resolvedHref = resolvedUrl.href;
      let finalized = await this.resolver.realPath(await this.resolver.finalizeResolve(resolvedHref, parentIsCjs, env, this.installer, parentPkgUrl));
      // handle URL mappings
      const urlResolved = this.inputMap.resolve(finalized, parentUrl) as string;
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
      this.log('resolve', `${specifier} ${parentUrl} -> ${resolvedUrl}`);
      return resolvedUrl.href;
    }
  
    const parsed = parsePkg(specifier);
    if (!parsed) throw new JspmError(`Invalid package name ${specifier}`);
    const { pkgName, subpath } = parsed;
  
    // Subscope override
    const scopeMatches = getScopeMatches(parentUrl, this.inputMap.scopes, this.inputMap.mapUrl);
    const pkgSubscopes = scopeMatches.filter(([, url]) => url.startsWith(parentPkgUrl));
    if (pkgSubscopes.length) {
      for (const [scope] of pkgSubscopes) {
        const mapMatch = getMapMatch(specifier, this.inputMap.scopes[scope]);
        if (mapMatch) {
          const resolved = await this.resolver.realPath(resolveUrl(this.inputMap.scopes[scope][mapMatch] + specifier.slice(mapMatch.length), this.inputMap.mapUrl, this.inputMap.rootUrl));
          this.log('resolve', `${specifier} ${parentUrl} -> ${resolved}`);
          return resolved;
        }
      }
    }
  
    // Scope override
    const userScopeMatch = scopeMatches.find(([, url]) => url === parentPkgUrl);
    if (userScopeMatch) {
      const imports = this.inputMap.scopes[userScopeMatch[0]];
      const userImportsMatch = getMapMatch(specifier, imports);
      const userImportsResolved = userImportsMatch ? await this.resolver.realPath(resolveUrl(imports[userImportsMatch] + specifier.slice(userImportsMatch.length), this.inputMap.mapUrl, this.inputMap.rootUrl)) : null;
      if (userImportsResolved) {
        this.log('resolve', `${specifier} ${parentUrl} -> ${userImportsResolved}`);
        return userImportsResolved;
      }
    }

    // User import overrides
    const userImportsMatch = getMapMatch(specifier, this.inputMap.imports);
    const userImportsResolved = userImportsMatch ? await this.resolver.realPath(resolveUrl(this.inputMap.imports[userImportsMatch] + specifier.slice(userImportsMatch.length), this.inputMap.mapUrl, this.inputMap.rootUrl)) : null;
    if (userImportsResolved) {
      this.log('resolve', `${specifier} ${parentUrl} -> ${userImportsResolved}`);
      return userImportsResolved;
    }

    // Own name import
    const pcfg = await this.resolver.getPackageConfig(parentPkgUrl) || {};
    if (pcfg.exports && pcfg.name === pkgName) {
      const resolved = await this.resolver.realPath(await this.resolver.resolveExport(parentPkgUrl, subpath, env, parentIsCjs, specifier, this.installer, new URL(parentUrl)));
      this.log('resolve', `${specifier} ${parentUrl} -> ${resolved}`);
      return resolved;
    }

    // Imports
    if (pcfg.imports && pkgName[0] === '#') {
      const match = getMapMatch(specifier, pcfg.imports);
      if (!match)
        throw new JspmError(`No '${specifier}' import defined in ${parentPkgUrl}${importedFrom(parentUrl)}.`);
      const target = resolvePackageTarget(pcfg.imports[match], parentPkgUrl, env, specifier.slice(match.length), true);
      if (!isURL(target)) {
        return this.resolve(target, parentUrl, mode, toplevel);
      }
      const resolved = await this.resolver.realPath(target);
      this.log('resolve', `${specifier} ${parentUrl} -> ${resolved}`);
      return resolved;
    }

    // @ts-ignore
    if (mode.endsWith('primary') && !toplevel)
      throw new Error('hmm');
    const installed = await this.installer.install(pkgName, mode, toplevel ? null : parentPkgUrl, subpath, subpath === './' ? false : true, parentUrl);
    if (installed) {
      const { installUrl, installSubpath } = installed;
      const key = installSubpath ? installSubpath + subpath.slice(1) : subpath;
      const resolved = await this.resolver.realPath(await this.resolver.resolveExport(installUrl, key, env, parentIsCjs, specifier, this.installer, new URL(parentUrl)));
      this.log('resolve', `${specifier} ${parentUrl} -> ${resolved}`);
      return resolved;
    }

    throw new JspmError(`No resolution in map for ${specifier}${importedFrom(parentUrl)}`);
  }

  private async getTraceEntry (resolvedUrl: string, parentUrl: string): Promise<TraceEntry | null> {
    if (resolvedUrl in this.tracedUrls) {
      const entry = this.tracedUrls[resolvedUrl];
      await entry.promise;
      return entry;
    }
    if (resolvedUrl.startsWith('node:'))
      return null;

    if (resolvedUrl.endsWith('/'))
      throw new JspmError(`Trailing "/" installs not supported installing ${resolvedUrl} for ${parentUrl}`);

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
      const parentIsCjs = this.tracedUrls[parentUrl]?.format === 'commonjs';

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
