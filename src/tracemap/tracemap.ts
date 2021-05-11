import { InstallOptions, InstallTarget } from "../install/installer.js";
import { importedFrom, isPlain } from "../common/url.js";
import { Installer } from "../install/installer.js";
import { log } from "../common/log.js";
import { JspmError, throwInternalError } from "../common/err.js";
import { parsePkg } from "../install/package.js";
import { getMapMatch, getScopeMatches, IImportMap, ImportMap } from "./map.js";
import resolver from "../install/resolver.js";

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
  system: boolean;
  babel: boolean;
}

// The tracemap fully drives the installer
export default class TraceMap {
  env = ['browser', 'development'];
  installer: Installer | undefined;
  opts: TraceMapOptions;
  tracedUrls: TraceGraph = {};
  map: ImportMap;
  mapBase: URL;
  traces = new Set<string>();
  staticList = new Set<string>();
  dynamicList = new Set<string>();

  constructor (mapBase: URL, opts: TraceMapOptions = {}) {
    this.mapBase = mapBase;
    this.opts = opts;
    if (this.opts.env)
      this.env = this.opts.env;
    if (opts.inputMap)
      this.map = opts.inputMap instanceof ImportMap ? opts.inputMap : new ImportMap(mapBase).extend(opts.inputMap);
    else
      this.map = new ImportMap(mapBase);
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
      if (trace.system)
        system = true;
      else
        esm = true;
    }
    return { system, esm };
  }

  async startInstall () {
    if (!this.installer)
      this.installer = new Installer(this.mapBase, this.opts);

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
            catch {
              // second pass errors ignored as they should have been thrown by first pass
            }
          }));
        } while (this.installer!.newInstalls);

        // now second-pass visit the trace to gather the exact graph and collect the import map
        let list = this.staticList;
        const discoveredDynamics = new Set<string>();
        const depVisitor = async (url: string, entry: TraceEntry) => {
          list.add(url);
          const parentPkgUrl = await resolver.getPackageBase(url);
          for (const dep of Object.keys(entry.dynamicDeps)) {
            const resolvedUrl = entry.dynamicDeps[dep][0];
            if (isPlain(dep))
              this.map.addMapping(dep, resolvedUrl, parentPkgUrl);
            discoveredDynamics.add(resolvedUrl);
          }
          for (const dep of Object.keys(entry.deps)) {
            if (isPlain(dep))
              this.map.addMapping(dep, entry.deps[dep], parentPkgUrl);
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
            this.map.addMapping(specifier, url);
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

  async addAllPkgMappings (name: string, pkgUrl: string, env: string[] = this.env, parentPkgUrl: string | null = null) {
    const [url, subpathFilter] = pkgUrl.split('|');
    const exports = await resolver.resolveExports(url + (url.endsWith('/') ? '' : '/'), env, subpathFilter);
    for (const key of Object.keys(exports)) {
      if (key.endsWith('!cjs'))
        continue;
      if (!exports[key])
        continue;
      if (key.endsWith('*'))
        continue;
      let target = new URL(exports[key], url).href;
      if (!exports[key].endsWith('/') && target.endsWith('/'))
        target = target.slice(0, -1);
      this.map.addMapping(name + key.slice(1), target, parentPkgUrl);
    }
  }

  async trace (specifier: string, parentUrl = this.mapBase, env = ['import', ...this.env]): Promise<string> {
    const parentPkgUrl = await resolver.getPackageBase(parentUrl.href);
    if (!parentPkgUrl)
      throwInternalError();

    this.traces.add(specifier + '##' + parentUrl.href);

    if (!isPlain(specifier)) {
      const resolvedUrl = new URL(specifier, parentUrl);
      if (resolvedUrl.protocol !== 'file:' && resolvedUrl.protocol !== 'https:' && resolvedUrl.protocol !== 'http:' && resolvedUrl.protocol !== 'node:' && resolvedUrl.protocol !== 'data:')
        throw new JspmError(`Found unexpected protocol ${resolvedUrl.protocol}${importedFrom(parentUrl)}`);
      log('trace', `${specifier} ${parentUrl.href} -> ${resolvedUrl}`);
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
          log('trace', `${specifier} ${parentUrl.href} -> ${resolved}`);
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
        log('trace', `${specifier} ${parentUrl.href} -> ${userImportsResolved}`);
        await this.traceUrl(userImportsResolved, parentUrl, env);
        return userImportsResolved;
      }
    }

    // Own name import
    const pcfg = await resolver.getPackageConfig(parentPkgUrl) || {};
    if (pcfg.exports && pcfg.name === pkgName) {
      const exports = await resolver.resolveExports(parentPkgUrl, env);
      const match = getMapMatch(subpath, exports);
      if (!match)
        throw new JspmError(`No '${subpath}' exports subpath defined in ${parentPkgUrl} resolving ${pkgName}${importedFrom(parentUrl)}.`);
      if (match) {
        const resolved = new URL(exports[match] + subpath.slice(match.length), parentPkgUrl).href;
        log('trace', `${specifier} ${parentUrl.href} -> ${resolved}`);
        await this.traceUrl(resolved, parentUrl, env);
        return resolved;
      }
    }

    // @ts-ignore
    const installed = this.opts.freeze ? this.installer?.installs[parentPkgUrl]?.[pkgName] : await this.installer?.install(pkgName, parentPkgUrl, parentUrl.href);
    if (installed) {
      let [pkgUrl, subpathFilter] = installed.split('|');
      if (subpathFilter)
        pkgUrl += '/';
      const exports = await resolver.resolveExports(pkgUrl, env, subpathFilter);
      const match = getMapMatch(subpath, exports);
      if (!match)
        throw new JspmError(`No '${subpath}' exports subpath defined in ${pkgUrl} resolving ${pkgName}${importedFrom(parentUrl)}.`);
      if (match) {
        let resolved = new URL(exports[match] + subpath.slice(match.length), pkgUrl).href;
        if (!exports[match].endsWith('/') && resolved.endsWith('/'))
          resolved = resolved.slice(0, -1);
        log('trace', `${specifier} ${parentUrl.href} -> ${resolved}`);
        await this.traceUrl(resolved, parentUrl, env);
        return resolved;
      }
    }
  
    // User import overrides
    const userImportsMatch = getMapMatch(specifier, this.map.imports);
    const userImportsResolved = userImportsMatch ? new URL(this.map.imports[userImportsMatch] + specifier.slice(userImportsMatch.length), this.map.baseUrl).href : null;
    if (userImportsResolved) {
      log('trace', `${specifier} ${parentUrl.href} -> ${userImportsResolved}`);
      await this.traceUrl(userImportsResolved, parentUrl, env);
      return userImportsResolved;
    }

    throw new JspmError(`No resolution in map for ${specifier}${importedFrom(parentUrl)}`);
  }

  private async traceUrl (resolvedUrl: string, parentUrl: URL, env: string[]): Promise<void> {
    const wasCJS = await resolver.wasCommonJS(resolvedUrl);
    if (wasCJS && env.includes('import'))
      env = env.map(e => e === 'import' ? 'require' : e);
    else if (!wasCJS && env.includes('require'))
      env = env.map(e => e === 'require' ? 'import' : e);

    if (resolvedUrl in this.tracedUrls) return;
    if (resolvedUrl.endsWith('/'))
      throw new JspmError(`Trailing "/" installs not yet supported installing ${resolvedUrl} for ${parentUrl.href}`);
    const traceEntry: TraceEntry = this.tracedUrls[resolvedUrl] = {
      wasCJS,
      deps: Object.create(null),
      dynamicDeps: Object.create(null),
      hasStaticParent: true,
      size: NaN,
      integrity: '',
      system: false,
      babel: false
    };
    const { deps, dynamicDeps, integrity, size, system } = await resolver.analyze(resolvedUrl, parentUrl, this.opts.system);
    traceEntry.integrity = integrity;
    traceEntry.system = !!system;
    traceEntry.size = size;
    
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
