import { ExactPackage, PackageConfig, PackageTarget, ExportsTarget } from './package.js';
import { JspmError } from '../common/err.js';
import { Log } from '../common/log.js';
import { fetch } from '../common/fetch.js';
import { importedFrom } from "../common/url.js";
import { computeIntegrity } from "../common/integrity.js";
// @ts-ignore
import { parse } from 'es-module-lexer';
// @ts-ignore
import { getProvider, getUrlProvider } from '../providers/index.js';
// @ts-ignore
import process from 'process';
// @ts-ignore
import { pathToFileURL } from 'url';

export class Resolver {
  log: Log;
  pcfgPromises: Record<string, Promise<void>> = Object.create(null);
  pcfgs: Record<string, PackageConfig | null> = Object.create(null);
  fetchOpts: any;
  constructor (log: Log, fetchOpts?: any) {
    this.log = log;
    this.fetchOpts = fetchOpts;
  }

  parseUrlPkg (url: string): ExactPackage | undefined {
    return getUrlProvider(url).provider?.parseUrlPkg.call(this, url);
  }

  pkgToUrl (pkg: ExactPackage, { provider, layer }: { provider: string, layer: string }): string {
    return getProvider(provider).pkgToUrl.call(this, pkg, layer);
  }

  async getPackageBase (url: string) {
    const pkg = this.parseUrlPkg(url);
    if (pkg) {
      const { provider, layer } = getUrlProvider(url);
      return this.pkgToUrl(pkg, { provider: provider!.name, layer });
    }
  
    if (url.startsWith('node:'))
      return url;
    
    let testUrl = new URL('./', url);
    do {
      let responseUrl;
      if (responseUrl = await this.checkPjson(testUrl.href))
        return new URL('.', responseUrl).href;
      // if hitting the base and we are in the cwd, use the cwd
      if (testUrl.pathname === '/') {
        const cwd = pathToFileURL(process.cwd()) + '/';
        if (url.startsWith(cwd))
          return cwd;
        return testUrl.href;
      }
    } while (testUrl = new URL('../', testUrl));
  }

  // TODO split this into getPackageDependencyConfig and getPackageResolutionConfig
  // since "dependencies" come from package base, while "imports" come from local pjson
  async getPackageConfig (pkgUrl: string): Promise<PackageConfig | null> {
    if (!pkgUrl.endsWith('/'))
      throw new Error(`Internal Error: Package URL must end in "/". Got ${pkgUrl}`);
    let cached = this.pcfgs[pkgUrl];
    if (cached) return cached;
    if (!this.pcfgPromises[pkgUrl])
      this.pcfgPromises[pkgUrl] = (async () => {
        const { provider } = getUrlProvider(pkgUrl);
        if (provider) {
          const pcfg = await provider.getPackageConfig?.call(this, pkgUrl);
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
      Object.keys(pjson.optionalDependencies || {})
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
    const pkg = await getProvider(provider).resolveLatestTarget.call(this, target, unstable, layer, parentUrl);
    if (pkg)
      return pkg;
    throw new JspmError(`Unable to resolve package ${target.registry}:${target.name} to "${target.ranges.join(' || ')}"${importedFrom(parentUrl)}`);
  }

  async wasCommonJS (url: string): Promise<boolean> {
    // TODO: make this a provider hook
    const pkgUrl = await this.getPackageBase(url, );
    if (!pkgUrl)
      return false;
    const pcfg = await this.getPackageConfig(pkgUrl);
    if (!pcfg)
      return false;
    const subpath = './' + url.slice(pkgUrl.length);
    return pcfg?.exports?.[subpath + '!cjs'] ? true : false;
  }

  async resolveExports (pkgUrl: string, env: string[], subpathFilter?: string): Promise<Record<string, string>> {
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
        exports['.'] = getExportsTarget(pcfg.exports, env);
      }
      else {
        for (const expt of Object.keys(pcfg.exports)) {
          exports[expt] = getExportsTarget((pcfg.exports as Record<string, ExportsTarget>)[expt], env);
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

    if (subpathFilter) {
      subpathFilter = './' + subpathFilter;
      const filteredExports = Object.create(null);
      for (const key of Object.keys(exports)) {
        if (key.startsWith(subpathFilter) && (key.length === subpathFilter.length || key[subpathFilter.length] === '/')) {
          filteredExports['.' + key.slice(subpathFilter.length)] = exports[key];
        }
        else if (key.endsWith('*')) {
          const patternBase = key.slice(0, -1);
          if (subpathFilter.startsWith(patternBase)) {
            const replacement = subpathFilter.slice(patternBase.length);
            filteredExports['.'] = replaceTargets(exports[key], replacement);
            filteredExports['./*'] = replaceTargets(exports[key], replacement + '/*');
          }
        }
      }
      function replaceTargets (target: ExportsTarget, replacement: string): ExportsTarget {
        if (Array.isArray(target)) {
          return [...target.map(target => replaceTargets(target, replacement))];
        }
        else if (typeof target === 'object' && target !== null) {
          const newTarget: Record<string, ExportsTarget> = {};
          for (const key of Object.keys(target))
            newTarget[key] = replaceTargets(target[key], replacement);
          return newTarget;
        }
        else if (typeof target === 'string') {
          return target.replace(/\*/g, replacement);
        }
        return target;
      }
      return filteredExports;
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
    const ts = await import(eval('typescript'));
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
      const [imports] = await parse(source);
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
        const [imports] = await parse(source);
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

export function getExportsTarget(target: ExportsTarget, env: string[]): string | null {
  if (typeof target === 'string') {
    return target;
  }
  else if (typeof target === 'object' && target !== null && !Array.isArray(target)) {
    for (const condition in target) {
      if (condition === 'default' || env.includes(condition)) {
        const resolved = getExportsTarget(target[condition], env);
        if (resolved)
          return resolved;
      }
    }
  }
  else if (Array.isArray(target)) {
    // TODO: Validation for arrays
    for (const targetFallback of target) {
      return getExportsTarget(targetFallback, env);
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
