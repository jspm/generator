import { ExactPackage, PackageConfig, PackageTarget, ExportsTarget } from '../install/package.js';
import { JspmError } from '../common/err.js';
import { Log } from '../common/log.js';
// @ts-ignore
import { fetch } from '#fetch';
import { importedFrom } from "../common/url.js";
// @ts-ignore
import { parse } from 'es-module-lexer/js';
import { getProvider, defaultProviders, Provider } from '../providers/index.js';
import { Analysis, createSystemAnalysis, createCjsAnalysis, createEsmAnalysis, createTsAnalysis } from './analysis.js';
import { Installer, PackageProvider } from '../install/installer.js';

let realpath, pathToFileURL;

export function setPathFns (_realpath, _pathToFileURL) {
  realpath = _realpath, pathToFileURL = _pathToFileURL;
}

export class Resolver {
  log: Log;
  pcfgPromises: Record<string, Promise<void>> = Object.create(null);
  pcfgs: Record<string, PackageConfig | null> = Object.create(null);
  fetchOpts: any;
  preserveSymlinks = false;
  providers = defaultProviders;
  constructor (log: Log, fetchOpts?: any, preserveSymlinks = false) {
    this.log = log;
    this.fetchOpts = fetchOpts;
    this.preserveSymlinks = preserveSymlinks;
  }

  addCustomProvider (name: string, provider: Provider) {
    if (!provider.pkgToUrl)
      throw new Error('Custom provider "' + name + '" must define a "pkgToUrl" method.');
    if (!provider.parseUrlPkg)
      throw new Error('Custom provider "' + name + '" must define a "parseUrlPkg" method.');
    if (!provider.resolveLatestTarget)
      throw new Error('Custom provider "' + name + '" must define a "resolveLatestTarget" method.');
    this.providers = Object.assign({}, this.providers, { [name]: provider });
  }

  parseUrlPkg (url: string): { pkg: ExactPackage, subpath: null | `./${string}`, source: { layer: string, provider: string } } | undefined {
    for (const provider of Object.keys(this.providers)) {
      const providerInstance = this.providers[provider];
      const result = providerInstance.parseUrlPkg.call(this, url);
      if (result)
        return {
          pkg: 'pkg' in result ? result.pkg : result,
          source: { provider, layer: 'layer' in result ? result.layer : 'default' },
          subpath: 'subpath' in result ? result.subpath : null
        };
    }
    return null;
  }

  pkgToUrl (pkg: ExactPackage, { provider, layer }: PackageProvider): `${string}/` {
    return getProvider(provider, this.providers).pkgToUrl.call(this, pkg, layer);
  }

  async getPackageBase (url: string): Promise<`${string}/`> {
    const pkg = this.parseUrlPkg(url);
    if (pkg)
      return this.pkgToUrl(pkg.pkg, pkg.source);
    
    let testUrl: URL;
    try {
      testUrl = new URL('./', url);
    }
    catch {
      return url as `${string}/`;
    }
    const rootUrl = new URL('/', testUrl).href as `${string}/`;
    do {
      let responseUrl;
      if (responseUrl = await this.checkPjson(testUrl.href))
        return new URL('.', responseUrl).href as `${string}/`;
      // No package base -> use directory itself
      if (testUrl.href === rootUrl)
        return new URL('./', url).href as `${string}/`;
    } while (testUrl = new URL('../', testUrl));
  }

  // TODO split this into getPackageDependencyConfig and getPackageResolutionConfig
  // since "dependencies" come from package base, while "imports" come from local pjson

  async getPackageConfig (pkgUrl: string): Promise<PackageConfig | null> {
    if (!pkgUrl.startsWith('file:') && !pkgUrl.startsWith('http:') && !pkgUrl.startsWith('https:') && !pkgUrl.startsWith('ipfs:'))
      return null;
    if (!pkgUrl.endsWith('/'))
      throw new Error(`Internal Error: Package URL must end in "/". Got ${pkgUrl}`);
    let cached = this.pcfgs[pkgUrl];
    if (cached) return cached;
    if (!this.pcfgPromises[pkgUrl])
      this.pcfgPromises[pkgUrl] = (async () => {
        const parsed = this.parseUrlPkg(pkgUrl);
        if (parsed) {
          const pcfg = await getProvider(parsed.source.provider, this.providers).getPackageConfig?.call(this, pkgUrl);
          if (pcfg !== undefined) {
            this.pcfgs[pkgUrl] = pcfg;
            return;
          }
        }
        const res = await fetch(`${pkgUrl}package.json`, this.fetchOpts);
        switch (res.status) {
          case 200:
          case 304:
            break;
          case 400:
          case 401:
          case 403:
          case 404:
          case 406:
            this.pcfgs[pkgUrl] = null;
            return;
          default:
            throw new JspmError(`Invalid status code ${res.status} reading package config for ${pkgUrl}. ${res.statusText}`);
        }
        if (res.headers && !res.headers.get('Content-Type')?.match(/^application\/json(;|$)/)) {
          this.pcfgs[pkgUrl] = null;
        }
        else try {
          this.pcfgs[pkgUrl] = await res.json();
        }
        catch (e) {
          this.pcfgs[pkgUrl] = null;
        }
      })();
    await this.pcfgPromises[pkgUrl];
    return this.pcfgs[pkgUrl];
  }

  async getDepList (pkgUrl: string, dev = false): Promise<string[]> {
    const pjson = (await this.getPackageConfig(pkgUrl))!;
    if (!pjson)
      return [];
    return [...new Set([
      Object.keys(pjson.dependencies || {}),
      Object.keys(dev && pjson.devDependencies || {}),
      Object.keys(pjson.peerDependencies || {}),
      Object.keys(pjson.optionalDependencies || {}),
      Object.keys(pjson.imports || {})
    ].flat())];
  }

  async checkPjson (url: string): Promise<string | false> {
    if (await this.getPackageConfig(url) === null)
      return false;
    return url;
  }

  async exists (resolvedUrl: string) {
    const res = await fetch(resolvedUrl, this.fetchOpts);
    switch (res.status) {
      case 200:
      case 304:
        return true;
      case 400:
      case 401:
      case 403:
      case 404:
      case 406:
        return false;
      default: throw new JspmError(`Invalid status code ${res.status} loading ${resolvedUrl}. ${res.statusText}`);
    }
  }

  async resolveLatestTarget (target: PackageTarget, { provider, layer }: PackageProvider, parentUrl?: string): Promise<{ pkg: ExactPackage, subpath: `./${string}` | null }> {
    // find the range to resolve latest
    let range: any;
    for (const possibleRange of target.ranges.sort(target.ranges[0].constructor.compare)) {
      if (!range) {
        range = possibleRange;
      }
      else if (possibleRange.gt(range) && !range.contains(possibleRange)) {
        range = possibleRange;
      }
    }

    const latestTarget = { registry: target.registry, name: target.name, range, unstable: target.unstable };

    const pkg = await getProvider(provider, this.providers).resolveLatestTarget.call(this, latestTarget, layer, parentUrl) as ExactPackage | { pkg: ExactPackage, subpath: `./${string}` | null } | null;
    if (pkg) {
      if ('pkg' in pkg)
        return pkg;
      return { pkg, subpath: null };
    }
    throw new JspmError(`Unable to resolve package ${latestTarget.registry}:${latestTarget.name} to "${latestTarget.range}"${importedFrom(parentUrl)}`);
  }

  async wasCommonJS (url: string): Promise<boolean> {
    // TODO: make this a provider hook
    const pkgUrl = await this.getPackageBase(url);
    if (!pkgUrl)
      return false;
    const pcfg = await this.getPackageConfig(pkgUrl);
    if (!pcfg)
      return false;
    const subpath = './' + url.slice(pkgUrl.length);
    return pcfg?.exports?.[subpath + '!cjs'] ? true : false;
  }

  async realPath (url: string): Promise<string> {
    if (!url.startsWith('file:') || this.preserveSymlinks)
      return url;
    let encodedColon = false;
    url = url.replace(/%3a/i, () => {
      encodedColon = true;
      return ':';
    });
    if (!realpath) {
      [{ realpath }, { pathToFileURL }] = await Promise.all([
        import('fs' as any),
        import('url' as any)
      ]);
    }
    const outUrl = pathToFileURL(await new Promise((resolve, reject) => realpath(new URL(url), (err, result) => err ? reject(err) : resolve(result)))).href;
    if (encodedColon)
      return 'file:' + outUrl.slice(5).replace(':', '%3a');
    return outUrl;
  }

  async finalizeResolve (url: string, parentIsCjs: boolean, env: string[], installer: Installer | null, pkgUrl: `${string}/`): Promise<string> {
    if (parentIsCjs && url.endsWith('/'))
      url = url.slice(0, -1);
    // Only CJS modules do extension searching for relative resolved paths
    if (parentIsCjs)
      url = await (async () => {
        // subfolder checks before file checks because of fetch
        if (await this.exists(url + '/package.json')) {
          const pcfg = await this.getPackageConfig(url) || {};
          if (env.includes('browser') && typeof pcfg.browser === 'string')
            return this.finalizeResolve(await legacyMainResolve.call(this, pcfg.browser, new URL(url)), parentIsCjs, env, installer, pkgUrl);
          if (env.includes('module') && typeof pcfg.module === 'string')
            return this.finalizeResolve(await legacyMainResolve.call(this, pcfg.module, new URL(url)), parentIsCjs, env, installer, pkgUrl);
          if (typeof pcfg.main === 'string')
            return this.finalizeResolve(await legacyMainResolve.call(this, pcfg.main, new URL(url)), parentIsCjs, env, installer, pkgUrl);
          return this.finalizeResolve(await legacyMainResolve.call(this, null, new URL(url)), parentIsCjs, env, installer, pkgUrl);
        }
        if (await this.exists(url + '/index.js'))
          return url + '/index.js';
        if (await this.exists(url + '/index.json'))
          return url + '/index.json';
        if (await this.exists(url + '/index.node'))
          return url + '/index.node';
        if (await this.exists(url))
          return url;
        if (await this.exists(url + '.js'))
          return url + '.js';
        if (await this.exists(url + '.json'))
          return url + '.json';
        if (await this.exists(url + '.node'))
          return url + '.node';
        return url;
      })();
    // Only browser maps apply to relative resolved paths
    if (env.includes('browser')) {
      pkgUrl = pkgUrl || await this.getPackageBase(url);
      if (url.startsWith(pkgUrl)) {
        const pcfg = await this.getPackageConfig(pkgUrl);
        if (pcfg && typeof pcfg.browser === 'object' && pcfg.browser !== null) {
          const subpath = './' + url.slice(pkgUrl.length);
          if (pcfg.browser[subpath]) {
            const target = pcfg.browser[subpath];
            if (target === false)
              throw new Error(`TODO: Empty browser map for ${subpath} in ${url}`);
            if (!target.startsWith('./'))
              throw new Error(`TODO: External browser map for ${subpath} to ${target} in ${url}`);
            // for browser mappings to the same module, avoid a loop
            if (pkgUrl + target.slice(2) === url)
              return url;
            return await this.finalizeResolve(pkgUrl + target.slice(2), parentIsCjs, env, installer, pkgUrl);
          }
        }
      }
    }
    // Node.js core resolutions
    if (installer && url.startsWith('node:')) {
      const { installUrl } = await installer.installTarget(url.slice(5), installer.stdlibTarget, 'new-secondary', pkgUrl, pkgUrl);
      return this.finalizeResolve(await this.resolveExport(installUrl, `./nodelibs/${url.slice(5)}`, env, parentIsCjs, url, installer, new URL(pkgUrl)), parentIsCjs, env, installer, installUrl);
    }
    return url;
  }

  // reverse exports resolution
  // returns _a_ possible export which resolves to the given package URL and subpath
  // also handles "imports"
  async getExportResolution (pkgUrl: `${string}/`, subpath: '.' | `./${string}`, originalSpecifier: string): Promise<'.' | `./${string}` | null> {
    const pcfg = await this.getPackageConfig(pkgUrl) || {};
    if (originalSpecifier[0] === '#') {
      if (pcfg.imports === undefined || pcfg.imports === null)
        return null;
      const match = getMapMatch(originalSpecifier, pcfg.imports as Record<string, ExportsTarget>);
      if (!match)
        return null;
      const targets = enumeratePackageTargets(pcfg.imports[match]);
      for (const curTarget of targets) {
        try {
          if (await this.finalizeResolve(curTarget, false, [], null, pkgUrl) === pkgUrl + subpath.slice(2)) {
            return '.';
          }
        }
        catch {}
      }
      return null;
    }
    if (pcfg.exports !== undefined && pcfg.exports !== null) {
      if (typeof pcfg.exports === 'string') {
        if (subpath !== '.')
          return null;
        const url = new URL(pcfg.exports, pkgUrl).href;
        try {
          if (await this.finalizeResolve(url, false, [], null, pkgUrl) === pkgUrl + subpath.slice(2))
            return '.';
        }
        catch {}
        try {
          if (await this.finalizeResolve(url, false, ['browser'], null, pkgUrl) === pkgUrl + subpath.slice(2))
            return '.';
        }
        catch {}
        return null;
      }
      else if (!allDotKeys(pcfg.exports)) {
        if (subpath !== '.')
          return null;
        const targets = enumeratePackageTargets(pcfg.exports);
        for (const curTarget of targets) {
          try {
            if (await this.finalizeResolve(new URL(curTarget, pkgUrl).href, false, [], null, pkgUrl) === pkgUrl + subpath.slice(2))
              return '.';
          }
          catch {}
        }
        return null;
      }
      else {
        let bestMatch;
        for (const expt of Object.keys(pcfg.exports) as ('.'  | `./${string}`)[]) {
          const targets = enumeratePackageTargets(pcfg.exports[expt]);
          for (const curTarget of targets) {
            if (curTarget.indexOf('*') === -1) {
              if (await this.finalizeResolve(new URL(curTarget, pkgUrl).href, false, [], null, pkgUrl) === pkgUrl + subpath.slice(2)) {
                if (bestMatch) {
                  if (originalSpecifier.endsWith(bestMatch.slice(2))) {
                    if (!originalSpecifier.endsWith(expt.slice(2)))
                      continue;
                  }
                  else if (!originalSpecifier.endsWith(expt.slice(2))) {
                    // Normal precedence = shortest export!
                    if (expt.length < bestMatch.length)
                      bestMatch = expt;
                  }
                }
                bestMatch = expt;
              }
            }
            else {
              const parts = curTarget.split('*');
              if (!subpath.startsWith(parts[0]))
                continue;
              const matchEndIndex = subpath.indexOf(parts[1], parts[0].length);
              if (matchEndIndex === -1)
                continue;
              const match = subpath.slice(parts[0].length, matchEndIndex);
              const substitutedTarget = curTarget.replace(/\*/g, match);
              if (subpath === substitutedTarget) {
                const prefix = expt.slice(0, expt.indexOf('*'));
                const suffix = expt.slice(expt.indexOf('*') + 1);
                if (bestMatch) {
                  if (originalSpecifier.endsWith(bestMatch.slice(2))) {
                    if (!originalSpecifier.endsWith(expt.slice(2).replace('*', match)) ||
                        bestMatch.startsWith(prefix) && bestMatch.endsWith(suffix))
                      continue;
                  }
                  else if (!originalSpecifier.endsWith(expt.slice(2).replace('*', match))) {
                    if (bestMatch.startsWith(prefix) && bestMatch.endsWith(suffix))
                      continue;
                  }
                }
                bestMatch = expt.replace('*', match);
              }
            }
          }
        }
        return bestMatch;
      }
    }
    else {
      if (subpath !== '.') {
        try {
          if (await this.finalizeResolve(new URL(subpath, new URL(pkgUrl)).href, false, [], null, pkgUrl) === pkgUrl + subpath.slice(2))
            return '.';
        }
        catch {}
        return null;
      }
      try {
        if (typeof pcfg.main === 'string' && await this.finalizeResolve(await legacyMainResolve.call(this, pcfg.main, new URL(pkgUrl), originalSpecifier, pkgUrl), false, [], null, pkgUrl) === pkgUrl + subpath.slice(2))
          return '.';
      }
      catch {}
      try {
        if (await this.finalizeResolve(await legacyMainResolve.call(this, null, new URL(pkgUrl), originalSpecifier, pkgUrl), false, [], null, pkgUrl) === pkgUrl + subpath.slice(2))
          return '.';
      }
      catch {}
      try {
        if (typeof pcfg.browser === 'string' && await this.finalizeResolve(await legacyMainResolve.call(this, pcfg.browser, new URL(pkgUrl), originalSpecifier, pkgUrl), false, ['browser'], null, pkgUrl) === pkgUrl + subpath.slice(2))
          return '.';
      }
      catch {}
      try {
        if (typeof pcfg.module === 'string' && await this.finalizeResolve(await legacyMainResolve.call(this, pcfg.module, new URL(pkgUrl), originalSpecifier, pkgUrl), false, ['module'], null, pkgUrl) === pkgUrl + subpath.slice(2))
          return '.';
        return null;
      }
      catch {}
    }
    return null;
  }

  // Note: updates here must be tracked in function above
  async resolveExport (pkgUrl: `${string}/`, subpath: string, env: string[], parentIsCjs: boolean, originalSpecifier: string, installer: Installer, parentUrl?: URL): Promise<string> {
    const pcfg = await this.getPackageConfig(pkgUrl) || {};

    function throwExportNotDefined () {
      throw new JspmError(`No '${subpath}' exports subpath defined in ${pkgUrl} resolving ${originalSpecifier}${importedFrom(parentUrl)}.`, 'MODULE_NOT_FOUND');
    }

    if (pcfg.exports !== undefined && pcfg.exports !== null) {
      function allDotKeys (exports: Record<string, any>) {
        for (let p in exports) {
          if (p[0] !== '.')
            return false;
        }
        return true;
      }
      if (typeof pcfg.exports === 'string') {
        if (subpath === '.')
          return this.finalizeResolve(new URL(pcfg.exports, pkgUrl).href, parentIsCjs, env, installer, pkgUrl);
        else
          throwExportNotDefined();
      }
      else if (!allDotKeys(pcfg.exports)) {
        if (subpath === '.')
          return this.finalizeResolve(resolvePackageTarget(pcfg.exports, pkgUrl, env, '', false), parentIsCjs, env, installer, pkgUrl);
        else
          throwExportNotDefined();
      }
      else {
        const match = getMapMatch(subpath, pcfg.exports as Record<string, ExportsTarget>);
        if (match) {
          let replacement = '';
          const wildcardIndex = match.indexOf('*');
          if (wildcardIndex !== -1) {
            replacement = subpath.slice(wildcardIndex, subpath.length - (match.length - wildcardIndex - 1));
          }
          else if (match.endsWith('/')) {
            replacement = subpath.slice(match.length);
          }
          const resolved = resolvePackageTarget(pcfg.exports[match], pkgUrl, env, replacement, false);
          if (resolved === null)
            throwExportNotDefined();
          return this.finalizeResolve(resolved, parentIsCjs, env, installer, pkgUrl);
        }
        throwExportNotDefined();
      }
    }
    else {
      if (subpath === '.' || parentIsCjs && subpath === './') {
        if (env.includes('browser') && typeof pcfg.browser === 'string')
          return this.finalizeResolve(await legacyMainResolve.call(this, pcfg.browser, new URL(pkgUrl), originalSpecifier, pkgUrl), parentIsCjs, env, installer, pkgUrl);
        if (env.includes('module') && typeof pcfg.module === 'string')
          return this.finalizeResolve(await legacyMainResolve.call(this, pcfg.module, new URL(pkgUrl), originalSpecifier, pkgUrl), parentIsCjs, env, installer, pkgUrl);
        if (typeof pcfg.main === 'string')
          return this.finalizeResolve(await legacyMainResolve.call(this, pcfg.main, new URL(pkgUrl), originalSpecifier, pkgUrl), parentIsCjs, env, installer, pkgUrl);
        return this.finalizeResolve(await legacyMainResolve.call(this, null, new URL(pkgUrl), originalSpecifier, pkgUrl), parentIsCjs, env, installer, pkgUrl);
      }
      else {
        return this.finalizeResolve(new URL(subpath, new URL(pkgUrl)).href, parentIsCjs, env, installer, pkgUrl);
      }
    }
  }

  // async dlPackage (pkgUrl: string, outDirPath: string, beautify = false) {
  //   if (existsSync(outDirPath))
  //     throw new JspmError(`Checkout directory ${outDirPath} already exists.`);

  //   if (!pkgUrl.endsWith('/'))
  //     pkgUrl += '/';

  //   const dlPool = new Pool(20);

  //   const pkgContents: Record<string, string | ArrayBuffer> = Object.create(null);

  //   const pcfg = await this.getPackageConfig(pkgUrl);
  //   if (!pcfg || !pcfg.files || !(pcfg.files instanceof Array))
  //     throw new JspmError(`Unable to checkout ${pkgUrl} as there is no package files manifest.`);

  //   await Promise.all((pcfg.files).map(async file => {
  //     const url = pkgUrl + file;
  //     await dlPool.queue();
  //     try {
  //       const res = await fetch(url, this.fetchOpts);
  //       switch (res.status) {
  //         case 304:
  //         case 200:
  //           const contentType = res.headers && res.headers.get('content-type');
  //           let contents: string | ArrayBuffer = await res.arrayBuffer();
  //           if (beautify) {
  //             if (contentType === 'application/javascript') {
  //               // contents = jsBeautify(contents);
  //             }
  //             else if (contentType === 'application/json') {
  //               contents = JSON.stringify(JSON.parse(contents.toString()), null, 2);
  //             }
  //           }
  //           return pkgContents[file] = contents;
  //         default: throw new JspmError(`Invalid status code ${res.status} looking up ${url} - ${res.statusText}`);
  //       }
  //     }
  //     finally {
  //       dlPool.pop();
  //     }
  //   }));

  //   for (const file of Object.keys(pkgContents)) {
  //     const filePath = outDirPath + '/' + file;
  //     mkdirp.sync(path.dirname(filePath));
  //     writeFileSync(filePath, Buffer.from(pkgContents[file]));
  //   }
  // }

  async analyze (resolvedUrl: string, parentUrl: string, system: boolean, isRequire: boolean, retry = true): Promise<Analysis> {
    const res = await fetch(resolvedUrl, this.fetchOpts);
    if (!res)
      throw new JspmError(`Unable to fetch URL "${resolvedUrl}" for ${parentUrl}`);
    switch (res.status) {
      case 200:
      case 304:
        break;
      case 404: throw new JspmError(`Module not found: ${resolvedUrl}${importedFrom(parentUrl)}`, 'MODULE_NOT_FOUND');
      default: throw new JspmError(`Invalid status code ${res.status} loading ${resolvedUrl}. ${res.statusText}`);
    }
    let source = await res.text();
    // TODO: headers over extensions for non-file URLs
    try {
      if (resolvedUrl.endsWith('.ts') || resolvedUrl.endsWith('.tsx') || resolvedUrl.endsWith('.jsx'))
        return await createTsAnalysis(source, resolvedUrl);

      if (resolvedUrl.endsWith('.json')) {
        try {
          JSON.parse(source);
          return { deps: [], dynamicDeps: [], cjsLazyDeps: null, size: source.length, format: 'json' };
        }
        catch {}
      }

      const [imports, exports] = parse(source) as any as [any[], string[]];
      if (imports.every(impt => impt.d > 0) && !exports.length && resolvedUrl.startsWith('file:')) {
        // Support CommonJS package boundary checks for non-ESM on file: protocol only
        if (isRequire) {
          if (!(resolvedUrl.endsWith('.mjs') || resolvedUrl.endsWith('.js') && (await this.getPackageConfig(await this.getPackageBase(resolvedUrl)))?.type === 'module'))
            return createCjsAnalysis(imports, source, resolvedUrl);
        }
        else if (resolvedUrl.endsWith('.cjs') ||
            resolvedUrl.endsWith('.js') && (await this.getPackageConfig(await this.getPackageBase(resolvedUrl)))?.type !== 'module') {
          return createCjsAnalysis(imports, source, resolvedUrl);
        }
      }
      return system ? createSystemAnalysis(source, imports, resolvedUrl) : createEsmAnalysis(imports, source, resolvedUrl);
    }
    catch (e) {
      if (!e.message || !e.message.startsWith('Parse error @:'))
        throw e;
      // fetch is _unstable_!!!
      // so we retry the fetch first
      if (retry) {
        try {
          return this.analyze(resolvedUrl, parentUrl, system, isRequire, false);
        }
        catch {}
      }
      // TODO: better parser errors
      if (e.message && e.message.startsWith('Parse error @:')) {
        const [topline] = e.message.split('\n', 1);
        const pos = topline.slice(14);
        let [line, col] = pos.split(':');
        const lines = source.split('\n');
        let errStack = '';
        if (line > 1)
         errStack += '\n  ' + lines[line - 2];
        errStack += '\n> ' + lines[line - 1];
        errStack += '\n  ' + ' '.repeat(col - 1) + '^';
        if (lines.length > 1)
          errStack += '\n  ' + lines[line];
        throw new JspmError(`${errStack}\n\nError parsing ${resolvedUrl}:${pos}`);
      }
      throw e;
    }
  }
}

export function enumeratePackageTargets (target: ExportsTarget, targets = new Set<`./${string}`>()): Set<`./${string}`> {
  if (typeof target === 'string') {
    targets.add(target);
  }
  else if (typeof target === 'object' && target !== null && !Array.isArray(target)) {
    for (const condition in target) {
      enumeratePackageTargets(target[condition], targets);
    }
    return targets;
  }
  else if (Array.isArray(target)) {
    // TODO: Validation for arrays
    for (const targetFallback of target) {
      enumeratePackageTargets(targetFallback, targets);
      return targets;
    }
  }
  return targets;
}

// Note: changes to this function must be updated in the functionn above too
export function resolvePackageTarget (target: ExportsTarget, packageUrl: string, env: string[], subpath: string, isImport: boolean): string | null {
  if (typeof target === 'string') {
    if (!target.startsWith('./')) {
      if (isImport)
        return target;
      throw new Error(`Invalid exports target ${target} resolving ./${subpath} in ${packageUrl}`)
    }
    if (!target.startsWith('./'))
      throw new Error('Invalid ')
    if (subpath === '')
      return new URL(target, packageUrl).href;
    if (target.indexOf('*') !== -1) {
      return new URL(target.replace(/\*/g, subpath), packageUrl).href;
    }
    else if (target.endsWith('/')) {
      return new URL(target + subpath, packageUrl).href;
    }
    else {
      throw new Error(`Expected pattern or path export resolving ./${subpath} in ${packageUrl}`);
    }
  }
  else if (typeof target === 'object' && target !== null && !Array.isArray(target)) {
    for (const condition in target) {
      if (condition === 'default' || env.includes(condition)) {
        const resolved = resolvePackageTarget(target[condition], packageUrl, env, subpath, isImport);
        if (resolved)
          return resolved;
      }
    }
  }
  else if (Array.isArray(target)) {
    // TODO: Validation for arrays
    for (const targetFallback of target) {
      return resolvePackageTarget(targetFallback, packageUrl, env, subpath, isImport);
    }
  }
  return null;
}

async function legacyMainResolve (this: Resolver, main: string | null, pkgUrl: URL, originalSpecifier: string, parentUrl?: URL) {
  let guess: string;
  if (main) {
    if (await this.exists(guess = new URL(`./${main}/index.js`, pkgUrl).href))
      return guess;
    if (await this.exists(guess = new URL(`./${main}/index.json`, pkgUrl).href))
      return guess;
    if (await this.exists(guess = new URL(`./${main}/index.node`, pkgUrl).href))
      return guess;
    if (await this.exists(guess = new URL(`./${main}`, pkgUrl).href))
      return guess;
    if (await this.exists(guess = new URL(`./${main}.js`, pkgUrl).href))
      return guess;
    if (await this.exists(guess = new URL(`./${main}.json`, pkgUrl).href))
      return guess;
    if (await this.exists(guess = new URL(`./${main}.node`, pkgUrl).href))
      return guess;
  }
  else {
    if (pkgUrl.protocol !== 'file:' && await this.exists(guess = new URL('./mod.ts', pkgUrl).href))
      return guess;
    if (await this.exists(guess = new URL('./index.js', pkgUrl).href))
      return guess;
    if (await this.exists(guess = new URL('./index.json', pkgUrl).href))
      return guess;
    if (await this.exists(guess = new URL('./index.node', pkgUrl).href))
      return guess;
  }
  // Not found.
  throw new JspmError(`Unable to resolve ${main ? main + ' in ' : ''}${pkgUrl} resolving ${originalSpecifier}${importedFrom(parentUrl)}.`, 'MODULE_NOT_FOUND');
}

function getMapMatch<T = any> (specifier: string, map: Record<string, T>): string | undefined {
  if (specifier in map) return specifier;
  let bestMatch;
  for (const match of Object.keys(map)) {
    const wildcardIndex = match.indexOf('*');
    if (!match.endsWith('/') && wildcardIndex === -1)
      continue;
    if (match.endsWith('/')) {
      if (specifier.startsWith(match)) {
        if (!bestMatch || match.length > bestMatch.length)
          bestMatch = match;
      }
    }
    else {
      const prefix = match.slice(0, wildcardIndex);
      const suffix = match.slice(wildcardIndex + 1);
      if (specifier.startsWith(prefix) && specifier.endsWith(suffix) && specifier.length > prefix.length + suffix.length) {
        if (!bestMatch || !bestMatch.startsWith(prefix) || !bestMatch.endsWith(suffix))
          bestMatch = match;
      }
    }
  }
  return bestMatch;
}

function allDotKeys (exports: Record<string, any>) {
  for (let p in exports) {
    if (p[0] !== '.')
      return false;
  }
  return true;
}
