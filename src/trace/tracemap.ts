import { InstallOptions, InstallTarget, setResolution } from "../install/installer.js";
import { importedFrom, isPlain } from "../common/url.js";
import { Installer } from "../install/installer.js";
import { JspmError, throwInternalError } from "../common/err.js";
import { parsePkg } from "../install/package.js";
import { ImportMap, IImportMap, getMapMatch, getScopeMatches } from '@jspm/import-map';
import { resolvePackageTarget, Resolver } from "./resolver.js";
import { Log } from "../common/log.js";

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

  defaultProvider?: string;
}

interface TraceGraph {
  [tracedUrls: string]: TraceEntry;
}

interface TraceEntry {
  deps: Record<string, string>;
  dynamicDeps: Record<string, string[]>;
  // assetDeps: { expr: string, start: number, end: number, assets: string[] }
  hasStaticParent: boolean;
  size: number;
  integrity: string;
  wasCJS: boolean;
  // For cjs modules, the list of hoisted deps
  // this is needed for proper cycle handling
  cjsLazyDeps: string[];
  format: 'esm' | 'commonjs' | 'system';
}

// The tracemap fully drives the installer
export default class TraceMap {
  env = ['browser', 'development', 'module'];
  installer: Installer | undefined;
  opts: TraceMapOptions;
  tracedUrls: TraceGraph = {};
  map: ImportMap;
  mapBase: URL;
  traces = new Set<string>();
  staticList = new Set<string>();
  dynamicList = new Set<string>();
  log: Log;
  resolver: Resolver;

  constructor (mapBase: URL, opts: TraceMapOptions, log: Log, resolver: Resolver) {
    this.log = log;
    this.resolver = resolver;
    this.mapBase = mapBase;
    this.opts = opts;
    if (this.opts.env)
      this.env = this.opts.env;
    if (opts.inputMap)
      this.map = opts.inputMap instanceof ImportMap ? opts.inputMap : new ImportMap(mapBase).extend(opts.inputMap);
    else
      this.map = new ImportMap(mapBase);
    this.installer = new Installer(this.mapBase, this.opts, this.log, this.resolver);
  }

  clearLists () {
    this.staticList = new Set();
    this.dynamicList = new Set();
    this.tracedUrls = {};
    this.traces = new Set();
  }

  replace (target: InstallTarget, pkgUrl: string): boolean {
    return this.installer!.replace(target, pkgUrl);
  }

  async visit (url: string, visitor: (url: string, entry: TraceEntry) => Promise<boolean | void>, seen = new Set()) {
    if (seen.has(url))
      return;
    seen.add(url);
    const entry = this.tracedUrls[url];
    if (!entry)
      return;
    for (const dep of Object.keys(entry.deps)) {
      await this.visit(entry.deps[dep], visitor, seen);
    }
    await visitor(url, entry);
  }

  checkTypes () {
    let system = false, esm = false;
    for (const url of [...this.staticList, ...this.dynamicList]) {
      const trace = this.tracedUrls[url];
      if (trace.format === 'system')
        system = true;
      else
        esm = true;
    }
    return { system, esm };
  }

  async startInstall () {
    const finishInstall = await this.installer.startInstall();

    return async (success: boolean) => {
      if (!success) {
        finishInstall(false);
        return false;
      }

      // re-drive all the traces to convergence
      if (!this.opts.fullMap) {
        const traceResolutions: Record<string, string> = {};
        do {
          this.installer!.newInstalls = false;
          await Promise.all([...this.traces].map(async trace => {
            const [specifier, parentUrl] = trace.split('##');
            try {
              const resolved = await this.trace(specifier, new URL(parentUrl), this.tracedUrls?.[parentUrl]?.wasCJS ? ['require', ...this.env] : ['import', ...this.env]);
              traceResolutions[trace] = resolved;
            }
            catch (e) {
              throw e;
            }
          }));
        } while (this.installer!.newInstalls);

        // now second-pass visit the trace to gather the exact graph and collect the import map
        let list = this.staticList;
        const discoveredDynamics = new Set<string>();
        const depVisitor = async (url: string, entry: TraceEntry) => {
          list.add(url);
          const parentPkgUrl = await this.resolver.getPackageBase(url);
          for (const dep of Object.keys(entry.dynamicDeps)) {
            const resolvedUrl = entry.dynamicDeps[dep][0];
            if (isPlain(dep))
              this.map.set(dep, resolvedUrl, parentPkgUrl);
            discoveredDynamics.add(resolvedUrl);
          }
          for (const dep of Object.keys(entry.deps)) {
            if (isPlain(dep))
              this.map.set(dep, entry.deps[dep], parentPkgUrl);
          }
        }
        const seen = new Set<string>();

        for (const trace of this.traces) {
          const url = traceResolutions[trace];
          // ignore errored
          if (url === undefined)
            continue;
          const [specifier, parentUrl] = trace.split('##');
          if (isPlain(specifier) && parentUrl === this.mapBase.href)
            this.map.set(specifier, url);
          await this.visit(url, depVisitor, seen);
        }

        list = this.dynamicList;
        for (const url of discoveredDynamics) {
          await this.visit(url, depVisitor, seen);
        }
      }

      return finishInstall(true);
    };
  }

  async add (name: string, target: InstallTarget, persist = true): Promise<string> {
    const installed = await this.installer!.installTarget(name, target, this.mapBase.href, persist);
    return installed.slice(0, -1);
  }

  // async addAllPkgMappings (name: string, pkgUrl: string, env: string[] = this.env, parentPkgUrl: string | null = null) {
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

  async trace (specifier: string, parentUrl = this.mapBase, env = ['import', ...this.env]): Promise<string> {
    const parentPkgUrl = await this.resolver.getPackageBase(parentUrl.href);
    if (!parentPkgUrl)
      throwInternalError();

    const parentIsCjs = this.tracedUrls[parentUrl.href]?.format === 'commonjs';

    this.traces.add(specifier + '##' + parentUrl.href);

    if (!isPlain(specifier)) {
      let resolvedUrl = new URL(specifier, parentUrl);
      if (resolvedUrl.protocol !== 'file:' && resolvedUrl.protocol !== 'https:' && resolvedUrl.protocol !== 'http:' && resolvedUrl.protocol !== 'node:' && resolvedUrl.protocol !== 'data:')
        throw new JspmError(`Found unexpected protocol ${resolvedUrl.protocol}${importedFrom(parentUrl)}`);
      const resolvedHref = resolvedUrl.href;
      const finalized = await this.resolver.finalizeResolve(resolvedHref, parentIsCjs, env);
      if (finalized !== resolvedHref) {
        this.map.set(resolvedHref, finalized);
        resolvedUrl = new URL(finalized);
      }
      this.log('trace', `${specifier} ${parentUrl.href} -> ${resolvedUrl}`);
      await this.traceUrl(resolvedUrl.href, parentUrl, env);
      return resolvedUrl.href;
    }
  
    const parsed = parsePkg(specifier);
    if (!parsed) throw new JspmError(`Invalid package name ${specifier}`);
    const { pkgName, subpath } = parsed;
  
    // Subscope override
    const scopeMatches = getScopeMatches(parentUrl, this.map.scopes, this.map.baseUrl);
    const pkgSubscopes = scopeMatches.filter(([, url]) => url.startsWith(parentPkgUrl));
    if (pkgSubscopes.length) {
      for (const [scope] of pkgSubscopes) {
        const mapMatch = getMapMatch(specifier, this.map.scopes[scope]);
        if (mapMatch) {
          const resolved = new URL(this.map.scopes[scope][mapMatch] + specifier.slice(mapMatch.length), this.map.baseUrl).href;
          this.log('trace', `${specifier} ${parentUrl.href} -> ${resolved}`);
          await this.traceUrl(resolved, parentUrl, env);
          return resolved;
        }
      }
    }
  
    // Scope override
    const userScopeMatch = scopeMatches.find(([, url]) => url === parentPkgUrl);
    if (userScopeMatch) {
      const imports = this.map.scopes[userScopeMatch[0]];
      const userImportsMatch = getMapMatch(specifier, imports);
      const userImportsResolved = userImportsMatch ? new URL(imports[userImportsMatch] + specifier.slice(userImportsMatch.length), this.map.baseUrl).href : null;
      if (userImportsResolved) {
        this.log('trace', `${specifier} ${parentUrl.href} -> ${userImportsResolved}`);
        await this.traceUrl(userImportsResolved, parentUrl, env);
        return userImportsResolved;
      }
    }

    // Own name import
    const pcfg = await this.resolver.getPackageConfig(parentPkgUrl) || {};
    if (pcfg.exports && pcfg.name === pkgName) {
      const resolved = await this.resolver.resolveExport(parentPkgUrl, subpath, env, parentIsCjs, specifier, parentUrl);
      this.log('trace', `${specifier} ${parentUrl.href} -> ${resolved}`);
      await this.traceUrl(resolved, parentUrl, env);
      return resolved;
    }

    // Imports
    if (pcfg.imports && pkgName[0] === '#') {
      const match = getMapMatch(pkgName, pcfg.imports);
      if (!match)
        throw new JspmError(`No '${pkgName}' import defined in ${parentPkgUrl}${importedFrom(parentUrl)}.`);
      const resolved = resolvePackageTarget(pcfg.imports[match], parentPkgUrl, env, subpath === '.' ? '' : subpath.slice(2));
      setResolution(this.installer.installs, pkgName, parentPkgUrl, resolved);
      this.log('trace', `${specifier} ${parentUrl.href} -> ${resolved}`);
      await this.traceUrl(resolved, parentUrl, env);
      return resolved;
    }

    // @ts-ignore
    const installed = this.opts.freeze ? this.installer?.installs[parentPkgUrl]?.[pkgName] : await this.installer?.install(pkgName, parentPkgUrl, subpath === './' ? false : true, parentUrl.href);
    if (installed) {
      let [pkgUrl, subpathBase] = installed.split('|');
      if (subpathBase && !pkgUrl.endsWith('/'))
        pkgUrl += '/';
      const key = subpathBase ? './' + subpathBase + subpath.slice(1) : subpath;
      const resolved = await this.resolver.resolveExport(pkgUrl, key, env, parentIsCjs, specifier, parentUrl);
      this.log('trace', `${specifier} ${parentUrl.href} -> ${resolved}`);
      await this.traceUrl(resolved, parentUrl, env);
      return resolved;
    }
  
    // User import overrides
    const userImportsMatch = getMapMatch(specifier, this.map.imports);
    const userImportsResolved = userImportsMatch ? new URL(this.map.imports[userImportsMatch] + specifier.slice(userImportsMatch.length), this.map.baseUrl).href : null;
    if (userImportsResolved) {
      this.log('trace', `${specifier} ${parentUrl.href} -> ${userImportsResolved}`);
      await this.traceUrl(userImportsResolved, parentUrl, env);
      return userImportsResolved;
    }

    throw new JspmError(`No resolution in map for ${specifier}${importedFrom(parentUrl)}`);
  }

  private async traceUrl (resolvedUrl: string, parentUrl: URL, env: string[]): Promise<void> {
    if (resolvedUrl in this.tracedUrls) return;
    
    const traceEntry: TraceEntry = this.tracedUrls[resolvedUrl] = {
      wasCJS: false,
      deps: Object.create(null),
      dynamicDeps: Object.create(null),
      cjsLazyDeps: null,
      hasStaticParent: true,
      size: NaN,
      integrity: '',
      format: undefined
    };
    
    if (resolvedUrl.endsWith('/'))
      throw new JspmError(`Trailing "/" installs not yet supported installing ${resolvedUrl} for ${parentUrl.href}`);
    
    const { deps, dynamicDeps, cjsLazyDeps, size, format } = await this.resolver.analyze(resolvedUrl, parentUrl, this.opts.system);
    traceEntry.format = format;
    traceEntry.size = size;
    if (cjsLazyDeps)
      traceEntry.cjsLazyDeps = cjsLazyDeps;

    // wasCJS distinct from CJS because it applies to CJS transformed into ESM
    // from the resolver perspective
    const wasCJS = format === 'commonjs' || await this.resolver.wasCommonJS(resolvedUrl);
    if (wasCJS)
      traceEntry.wasCJS = true;

    if (wasCJS && env.includes('import'))
      env = env.map(e => e === 'import' ? 'require' : e);
    else if (!wasCJS && env.includes('require'))
      env = env.map(e => e === 'require' ? 'import' : e);

    let allDeps: string[] = deps;
    if (dynamicDeps.length && !this.opts.static) {
      allDeps = [...deps];
      for (const dep of dynamicDeps) {
        if (!allDeps.includes(dep))
          allDeps.push(dep);
      }
    }
    const resolvedUrlObj = new URL(resolvedUrl);
    await Promise.all(allDeps.map(async dep => {
      const resolved = await this.trace(dep, resolvedUrlObj, env);
      if (deps.includes(dep))
        traceEntry.deps[dep] = resolved;
      if (dynamicDeps.includes(dep))
        traceEntry.dynamicDeps[dep] = [resolved];
    }));
  }
}
