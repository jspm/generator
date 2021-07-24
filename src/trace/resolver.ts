import { ExactPackage, PackageConfig, PackageTarget, ExportsTarget } from '../install/package.js';
import { JspmError } from '../common/err.js';
import { Log } from '../common/log.js';
// @ts-ignore
import { fetch } from '#fetch';
import { importedFrom } from "../common/url.js";
import { parse } from 'es-module-lexer';
import { getProvider, defaultProviders, Provider } from '../providers/index.js';
import { Analysis, parseTs } from './analysis.js';
import { createEsmAnalysis } from './analysis.js';
import { createCjsAnalysis } from './cjs.js';
import { getMapMatch, resolveConditional } from '@jspm/import-map';

export class Resolver {
  log: Log;
  pcfgPromises: Record<string, Promise<void>> = Object.create(null);
  pcfgs: Record<string, PackageConfig | null> = Object.create(null);
  fetchOpts: any;
  providers = defaultProviders;
  constructor (log: Log, fetchOpts?: any) {
    this.log = log;
    this.fetchOpts = fetchOpts;
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

  parseUrlPkg (url: string): { pkg: ExactPackage, source: { layer: string, provider: string } } | undefined {
    for (const provider of Object.keys(this.providers)) {
      const providerInstance = this.providers[provider];
      const result = providerInstance.parseUrlPkg.call(this, url);
      if (result)
        return { pkg: 'pkg' in result ? result.pkg : result, source: { provider, layer: 'layer' in result ? result.layer : 'default' } };
    }
    return null;
  }

  pkgToUrl (pkg: ExactPackage, { provider, layer }: { provider: string, layer: string }): string {
    return getProvider(provider, this.providers).pkgToUrl.call(this, pkg, layer);
  }

  async getPackageBase (url: string) {
    const pkg = this.parseUrlPkg(url);
    if (pkg)
      return this.pkgToUrl(pkg.pkg, pkg.source);
  
    if (url.startsWith('node:'))
      return url;
    
    let testUrl: URL;
    try {
      testUrl = new URL('./', url);
    }
    catch {
      return url;
    }
    const rootUrl = new URL('/', testUrl).href;
    do {
      let responseUrl;
      if (responseUrl = await this.checkPjson(testUrl.href))
        return new URL('.', responseUrl).href;
      // No package base -> use directory itself
      if (testUrl.href === rootUrl)
        return new URL('./', url).href;
    } while (testUrl = new URL('../', testUrl));
  }

  // TODO split this into getPackageDependencyConfig and getPackageResolutionConfig
  // since "dependencies" come from package base, while "imports" come from local pjson
  async getPackageConfig (pkgUrl: string): Promise<PackageConfig | null> {
    if (!pkgUrl.endsWith('/'))
      throw new Error(`Internal Error: Package URL must end in "/". Got ${pkgUrl}`);
    if (!pkgUrl.startsWith('file:') && !pkgUrl.startsWith('http:') && !pkgUrl.startsWith('https:'))
      return null;
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
      case 404:
      case 406:
        return false;
      default: throw new JspmError(`Invalid status code ${res.status} loading ${resolvedUrl}. ${res.statusText}`);
    }
  }

  async resolveLatestTarget (target: PackageTarget, unstable: boolean, { provider, layer }: { provider: string, layer: string }, parentUrl?: string): Promise<ExactPackage> {
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

    const latestTarget = { registry: target.registry, name: target.name, range };

    const pkg = await getProvider(provider, this.providers).resolveLatestTarget.call(this, latestTarget, unstable, layer, parentUrl);
    if (pkg)
      return pkg;
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

  async finalizeResolve (url: string, parentIsCjs: boolean, isBrowser: boolean, pkgUrl?: string): Promise<string> {
    // Only CJS modules do extension searching for relative resolved paths
    if (parentIsCjs)
      url = await (async () => {
        if (await this.exists(url))
          return url;
        if (await this.exists(url + '.js'))
          return url + '.js';
        if (await this.exists(url + '.json'))
          return url + '.json';
        if (await this.exists(url + '.node'))
          return url + '.node';
        if (await this.exists(url + '/package.json')) {
          const pcfg = await this.getPackageConfig(url);
          if (isBrowser && typeof pcfg.browser === 'string')
            return this.finalizeResolve(new URL(pcfg.browser, url + '/').href, true, isBrowser, pkgUrl);
          if (typeof pcfg.main === 'string')
            return this.finalizeResolve(new URL(pcfg.main, url + '/').href, true, isBrowser, pkgUrl);
        }
        if (await this.exists(url + '/index.js'))
          return url + '/index.js';
        if (await this.exists(url + '/index.json'))
          return url + '/index.json';
        if (await this.exists(url + '/index.node'))
          return url + '/index.node';
        return url;
      })();
    // Only browser maps apply to relative resolved paths
    if (isBrowser) {
      pkgUrl = pkgUrl || await this.getPackageBase(url);
      if (url.startsWith(pkgUrl)) {
        const pcfg = await this.getPackageConfig(pkgUrl);
        if (typeof pcfg.browser === 'object' && pcfg.browser !== null) {
          const subpath = './' + url.slice(pkgUrl.length);
          if (pcfg.browser[subpath]) {
            // TODO: browser object mapings
            throw new Error('TODO: browser map of ' + subpath + ' with ' + JSON.stringify(pcfg.browser)); 
          }
        }
      }
    }
    return url;
  }

  async resolveExport (pkgUrl: string, subpath: string, env: string[], parentIsCjs: boolean, pkgName: string, parentUrl?: URL): Promise<string> {
    const pcfg = await this.getPackageConfig(pkgUrl) || {};

    function throwExportNotDefined () {
      throw new JspmError(`No '${subpath}' exports subpath defined in ${pkgUrl} resolving ${pkgName}${importedFrom(parentUrl)}.`, 'MODULE_NOT_FOUND');
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
          return this.finalizeResolve(new URL(pcfg.exports, pkgUrl).href, parentIsCjs, env.includes('browser'), pkgUrl);
        else
          throwExportNotDefined();
      }
      else if (!allDotKeys(pcfg.exports)) {
        if (subpath === '.')
          return this.finalizeResolve(resolvePackageTarget(pcfg.exports, pkgUrl, env), parentIsCjs, env.includes('browser'), pkgUrl);
        else
          throwExportNotDefined();
      }
      else {
        const match = getMapMatch(subpath, pcfg.exports as Record<string, ExportsTarget>);
        if (match) {        
          const resolved = resolvePackageTarget(pcfg.exports[match], pkgUrl, env);
          if (resolved === null)
            throwExportNotDefined();
          return this.finalizeResolve(resolved + subpath.slice(match.length), parentIsCjs, env.includes('browser'), pkgUrl);
        }
        throwExportNotDefined();
      }
    }
    else {
      const legacyResolve = async (subpath: string, pkgUrl: URL) => {
        let guess: string;
        if (subpath !== undefined) {
          if (await this.exists(guess = new URL(`./${subpath}/index.js`, pkgUrl).href)) {}
          else if (await this.exists(guess = new URL(`./${subpath}/index.json`, pkgUrl).href)) {}
          else if (await this.exists(guess = new URL(`./${subpath}/index.node`, pkgUrl).href)) {}
          else if (await this.exists(guess = new URL(`./${subpath}`, pkgUrl).href)) {}
          else if (await this.exists(guess = new URL(`./${subpath}.js`, pkgUrl).href)) {}
          else if (await this.exists(guess = new URL(`./${subpath}.json`, pkgUrl).href)) {}
          else if (await this.exists(guess = new URL(`./${subpath}.node`, pkgUrl).href)) {}
          else guess = undefined;
          if (guess) return guess;
          // Fallthrough.
        }
        if (await this.exists(guess = new URL('./index.js', pkgUrl).href)) {}
        else if (await this.exists(guess = new URL('./index.json', pkgUrl).href)) {}
        else if (await this.exists(guess = new URL('./index.node', pkgUrl).href)) {}
        else guess = undefined;
        if (guess) return guess;
        // Not found.
        throw new JspmError(`Unable to resolve ${subpath} in ${pkgUrl} resolving ${pkgName}${importedFrom(parentUrl)}.`, 'MODULE_NOT_FOUND');
      }
      if (subpath === '.') {
        if (env.includes('browser') && typeof pcfg.browser === 'string')
          return this.finalizeResolve(await legacyResolve(pcfg.browser, new URL(pkgUrl)), parentIsCjs, env.includes('browser'), pkgUrl);
        if (typeof pcfg.main === 'string')
          return this.finalizeResolve(await legacyResolve(pcfg.main, new URL(pkgUrl)), parentIsCjs, env.includes('browser'), pkgUrl);
        return this.finalizeResolve(await legacyResolve('index', new URL(pkgUrl)), parentIsCjs, env.includes('browser'), pkgUrl);
      }
      else {
        return this.finalizeResolve(await legacyResolve(subpath, new URL(pkgUrl)), parentIsCjs, env.includes('browser'), pkgUrl);
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

  async analyze (resolvedUrl: string, parentUrl?: URL, system = false, retry = false): Promise<Analysis> {
    const res = await fetch(resolvedUrl, this.fetchOpts);
    switch (res.status) {
      case 200:
      case 304:
        break;
      case 404: throw new JspmError(`Module not found: ${resolvedUrl}${importedFrom(parentUrl)}`, 'MODULE_NOT_FOUND');
      default: throw new JspmError(`Invalid status code ${res.status} loading ${resolvedUrl}. ${res.statusText}`);
    }
    let source = await res.text();
    try {
      if (resolvedUrl.endsWith('.ts') || resolvedUrl.endsWith('.tsx') || resolvedUrl.endsWith('.jsx'))
        source = await parseTs(source);
      const [imports, exports] = await parse(source) as any as [any[], string[]];
      if (imports.every(impt => impt.d > 0) && !exports.length && resolvedUrl.startsWith('file:')) {
        // Support CommonJS package boundary checks for non-ESM on file: protocol only
        if (!(resolvedUrl.endsWith('.js') || resolvedUrl.endsWith('.json') || resolvedUrl.endsWith('.node')) ||
            resolvedUrl.endsWith('.js') && (await this.getPackageConfig(await this.getPackageBase(resolvedUrl))).type !== 'module') {
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
          return this.analyze(resolvedUrl, parentUrl, system, false);
        }
        catch {}
      }
      // TODO: better parser errors
      if (e.message && e.message.startsWith('Parse error @:')) {
        const [topline] = e.message.split('\n', 1);
        const pos = topline.slice(14);
        let [line, col] = pos.split(':');
        const lines = source.split('\n');
        // console.log(source);
        if (line > 1)
          console.log('  ' + lines[line - 2]);
        console.log('> ' + lines[line - 1]);
        console.log('  ' + ' '.repeat(col - 1) + '^');
        if (lines.length > 1)
          console.log('  ' + lines[line]);
        throw new JspmError(`Error parsing ${resolvedUrl}:${pos}`);
      }
      throw e;
    }
  }
}

export function resolvePackageTarget (target: ExportsTarget, packageUrl: string, env: string[], subpath?: string | undefined): string | null {
  if (typeof target === 'string') {
    if (subpath === undefined)
      return new URL(target, packageUrl).href;
    if (target.indexOf('*') !== -1) {
      return new URL(target.replace(/\*/g, subpath), packageUrl).href;
    }
    else if (target.endsWith('/')) {
      return new URL(target + subpath, packageUrl).href;
    }
    else {
      throw new Error('Expected pattern or path export');
    }
  }
  else if (typeof target === 'object' && target !== null && !Array.isArray(target)) {
    for (const condition in target) {
      if (condition === 'default' || env.includes(condition)) {
        const resolved = resolvePackageTarget(target[condition], packageUrl, env, subpath);
        if (resolved)
          return resolved;
      }
    }
  }
  else if (Array.isArray(target)) {
    // TODO: Validation for arrays
    for (const targetFallback of target) {
      return resolvePackageTarget(targetFallback, packageUrl, env, subpath);
    }
  }
  return null;
}
function createSystemAnalysis(source: any, imports: any[], resolvedUrl: string): any {
  throw new Error('Function not implemented.');
}

