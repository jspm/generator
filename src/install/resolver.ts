import { ExactPackage, PackageConfig, PackageTarget, ExportsTarget } from './package.js';
import { JspmError } from '../common/err.js';
import { Log } from '../common/log.js';
// @ts-ignore
import { fetch } from '#fetch';
import { baseUrl, importedFrom } from "../common/url.js";
import { computeIntegrity } from "../common/integrity.js";
// @ts-ignore
import { parse } from 'es-module-lexer';
// @ts-ignore
import { getProvider, defaultProviders, Provider } from '../providers/index.js';

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

  async resolveExports (pkgUrl: string, env: string[]): Promise<Record<string, string>> {
    const pcfg = await this.getPackageConfig(pkgUrl) || {};

    // conditional resolution from conditions
    // does in-browser package resolution
    // index.js | index.json
    // main[.js|.json|.node|'']
    // 
    // Because of extension checks on CDN, we do .js|.json|.node FIRST (if not already one of those extensions)
    // all works out
    // exports are exact files
    // done
    const exports = Object.create(null);
    if (pcfg.exports !== undefined && pcfg.exports !== null) {
      function allDotKeys (exports: Record<string, any>) {
        for (let p in exports) {
          if (p[0] !== '.')
            return false;
        }
        return true;
      }
      if (typeof pcfg.exports === 'string') {
        exports['.'] = pcfg.exports;
      }
      else if (!allDotKeys(pcfg.exports)) {
        exports['.'] = resolvePackageTarget(pcfg.exports, pkgUrl, env);
      }
      else {
        for (const expt of Object.keys(pcfg.exports)) {
          exports[expt] = resolvePackageTarget((pcfg.exports as Record<string, ExportsTarget>)[expt], pkgUrl, env);
        }
      }
    }
    else {
      if (typeof pcfg.browser === 'string') {
        exports['.'] = pcfg.browser.startsWith('./') ? pcfg.browser : './' + pcfg.browser;
      }
      else if (typeof pcfg.main === 'string') {
        exports['.'] = pcfg.main.startsWith('./') ? pcfg.main : './' + pcfg.main;
      }
      if (typeof pcfg.browser === 'object') {
        for (const subpath of Object.keys(pcfg.browser)) {
          if (subpath.startsWith('./')) {
            if (exports['.'] === subpath)
              exports['.'] = pcfg.browser[subpath];
            exports[subpath] = pcfg.browser[subpath];
          }
          else {
            this.log('todo', `Non ./ subpaths in browser field: ${pcfg.name}.browser['${subpath}'] = ${pcfg.browser[subpath]}`);
          }
        }
      }
      if (!exports['./'])
        exports['./'] = './';
      if (!exports['.'])
        exports['.'] = '.';
    }

    return exports;
  }

  async getIntegrity (url: string) {
    const res = await fetch(url, this.fetchOpts);
    switch (res.status) {
      case 200: case 304: break;
      case 404: throw new Error(`URL ${url} not found.`);
      default: throw new Error(`Invalid status code ${res.status} requesting ${url}. ${res.statusText}`);
    }
    return computeIntegrity(await res.text());
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

  private async parseTs (source: string) {
    // @ts-ignore
    const { default: ts } = await import(eval('"typescript"'));
    return ts.transpileModule(source, {
      compilerOptions: {
        jsx: ts.JsxEmit.React,
        module: ts.ModuleKind.ESNext
      }
    }).outputText;
  }

  async analyze (resolvedUrl: string, parentUrl?: URL, system = false): Promise<Analysis> {
    const res = await fetch(resolvedUrl, this.fetchOpts);
    switch (res.status) {
      case 200:
      case 304:
        break;
      case 404: throw new JspmError(`Module not found: ${resolvedUrl}${importedFrom(parentUrl)}`);
      default: throw new JspmError(`Invalid status code ${res.status} loading ${resolvedUrl}. ${res.statusText}`);
    }
    let source = await res.text();
    try {
      if (resolvedUrl.endsWith('.ts') || resolvedUrl.endsWith('.tsx') || resolvedUrl.endsWith('.jsx'))
        source = await this.parseTs(source);
      const [imports] = await parse(source) as any as [string[]];
      return system ? createSystemAnalysis(source, imports, resolvedUrl) : createEsmAnalysis(imports, source, resolvedUrl);
    }
    catch (e) {
      if (!e.message || !e.message.startsWith('Parse error @:'))
        throw e;
      // fetch is _unstable_!!!
      // so we retry the fetch first
      const res = await fetch(resolvedUrl, this.fetchOpts);
      switch (res.status) {
        case 200:
        case 304:
          break;
        case 404: throw new JspmError(`Module not found: ${resolvedUrl}${importedFrom(parentUrl)}`);
        default: throw new JspmError(`Invalid status code ${res.status} loading ${resolvedUrl}. ${res.statusText}`);
      }
      source = await res.text();
      try {
        const [imports] = await parse(source) as any as [string[]];
        return system ? createSystemAnalysis(source, imports, resolvedUrl) : createEsmAnalysis(imports, source, resolvedUrl);
      }
      catch (e) {
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

interface Analysis {
  deps: string[],
  dynamicDeps: string[],
  size: number,
  integrity: string,
  system?: boolean
}

function createEsmAnalysis (imports: any, source: string, url: string): Analysis {
  if (!imports.length && registerRegEx.test(source))
    return createSystemAnalysis(source, imports, url);
  const deps: string[] = [];
  const dynamicDeps: string[] = [];
  for (const impt of imports) {
    if (impt.d === -1) {
      deps.push(source.slice(impt.s, impt.e));
      continue;
    }
    // dynamic import -> deoptimize trace all dependencies (and all their exports)
    if (impt.d >= 0) {
      const dynExpression = source.slice(impt.s, impt.e);
      if (dynExpression.startsWith('"') || dynExpression.startsWith('\'')) {
        try {
          dynamicDeps.push(JSON.parse('"' + dynExpression.slice(1, -1) + '"'));
        }
        catch (e) {
          console.warn('TODO: Dynamic import custom expression tracing.');
        }
      }
    }
  }
  const size = source.length;
  return { deps, dynamicDeps, size, integrity: computeIntegrity(source), system: false };
}

const registerRegEx = /^\s*(\/\*[^\*]*(\*(?!\/)[^\*]*)*\*\/|\s*\/\/[^\n]*)*\s*System\s*\.\s*register\s*\(\s*(\[[^\]]*\])\s*,\s*\(?function\s*\(\s*([^\),\s]+\s*(,\s*([^\),\s]+)\s*)?\s*)?\)/;
function createSystemAnalysis (source: string, imports: string[], url: string): Analysis {
  const [, , , rawDeps, , , contextId] = source.match(registerRegEx) || [];
  if (!rawDeps)
    return createEsmAnalysis(imports, source, url);
  const deps = JSON.parse(rawDeps.replace(/'/g, '"'));
  const dynamicDeps: string[] = [];
  if (contextId) {
    const dynamicImport = `${contextId}.import(`;
    let i = -1;
    while ((i = source.indexOf(dynamicImport, i + 1)) !== -1) {
      const importStart = i + dynamicImport.length + 1;
      const quote = source[i + dynamicImport.length];
      if (quote === '"' || quote === '\'') {
        const importEnd = source.indexOf(quote, i + dynamicImport.length + 1);
        if (importEnd !== -1) {
          try {
            dynamicDeps.push(JSON.parse('"' + source.slice(importStart, importEnd) + '"'));
            continue;
          }
          catch (e) {}
        }
      }
      console.warn('TODO: Dynamic import custom expression tracing.');
    }
  }
  const size = source.length;
  return { deps, dynamicDeps, size, integrity: computeIntegrity(source), system: true };
}
