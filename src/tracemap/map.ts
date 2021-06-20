import { baseUrl, isPlain } from "../common/url.js";
import * as json from "../common/json.js";
import { JspmError, throwInternalError } from "../common/err.js";
import { relativeUrl } from "../common/url.js";
import { alphabetize } from "../common/alphabetize.js";
import { defaultStyle } from '../common/source-style.js';

export interface IImportMap {
  baseUrl?: URL;
  imports?: Record<string, string | null>;
  scopes?: {
    [scope: string]: Record<string, string | null>;
  };
  integrity?: {
    [url: string]: string;
  };
  depcache?: {
    [url: string]: string[];
  };
}

export class ImportMap implements IImportMap {
  imports: Record<string, string | null> = Object.create(null);
  scopes: Record<string, Record<string, string | null>> = Object.create(null);
  integrity: Record<string, string> = Object.create(null);
  depcache: Record<string, string[]> = Object.create(null);
  baseUrl: URL = baseUrl;
  private mapStyle = defaultStyle;

  constructor (mapBaseUrl?: URL) {
    if (mapBaseUrl)
      this.baseUrl = mapBaseUrl;
  }

  clone () {
    const cloned = new ImportMap(this.baseUrl);
    cloned.extend(this);
    return cloned;
  }

  extend (map: IImportMap, overrideScopes = false) {
    const baseUrl = this.baseUrl.href;
    if (map.baseUrl && baseUrl !== map.baseUrl.href)
      this.rebase(map.baseUrl.href);
    Object.assign(this.imports, map.imports);
    if (overrideScopes) {
      Object.assign(this.scopes, map.scopes);
    }
    else if (map.scopes) {
      for (const scope of Object.keys(map.scopes))
        Object.assign(this.scopes[scope] = this.scopes[scope] || Object.create(null), map.scopes[scope]);
    }
    Object.assign(this.integrity, map.integrity);
    Object.assign(this.depcache, map.depcache);
    if (baseUrl !== this.baseUrl.href)
      this.rebase(baseUrl);
    return this;
  }

  sort () {
    this.imports = alphabetize(this.imports);
    this.scopes = alphabetize(this.scopes);
    this.depcache = alphabetize(this.depcache);
    this.integrity = alphabetize(this.integrity);
    for (const scope of Object.keys(this.scopes))
      this.scopes[scope] = alphabetize(this.scopes[scope]);
  }

  clearIntegrity () {
    this.integrity = Object.create(null);
  }

  clearDepcache () {
    this.depcache = Object.create(null);
  }

  setIntegrity (url: string, integrity: string) {
    this.integrity[url] = integrity;
  }

  addMapping (name: string, targetUrl: string, parent?: string | null) {
    if (!parent) {
      this.imports[name] = targetUrl;
    }
    else {
      if (!parent.endsWith('/'))
        throwInternalError();
      this.scopes[parent] = this.scopes[parent] || {};
      this.scopes[parent][name] = targetUrl;
    }
  }

  replace (pkgUrl: string, newPkgUrl: URL) {
    const newRelPkgUrl = relativeUrl(newPkgUrl, this.baseUrl);
    for (const impt of Object.keys(this.imports)) {
      const target = this.imports[impt];
      if (target !== null && target.startsWith(pkgUrl))
        this.imports[impt] = newRelPkgUrl + target.slice(pkgUrl.length);
    }
    for (const scope of Object.keys(this.scopes)) {
      const scopeImports = this.scopes[scope];
      const scopeUrl = new URL(scope, this.baseUrl).href;
      if (scopeUrl.startsWith(pkgUrl)) {
        const newScope = newRelPkgUrl + scopeUrl.slice(pkgUrl.length);
        delete this.scopes[scope];
        this.scopes[newScope] = scopeImports;
      }
      for (const name of Object.keys(scopeImports)) {
        const target = scopeImports[name];
        if (target !== null && target.startsWith(pkgUrl))
          scopeImports[name] = newRelPkgUrl + target.slice(pkgUrl.length);
      }
    }
    return this;
  }

  // TODO: flattening operation that combines subpaths where possible into folder maps
  combineSubpaths () {

  }

  flatten () {
    for (const scope of Object.keys(this.scopes)) {
      const scopeUrl = new URL(scope, this.baseUrl);
      let scopeBase: Record<string, string | null> | undefined, scopeBaseUrl: string | undefined;
      if (scopeUrl.origin === this.baseUrl.origin && scopeUrl.href.startsWith(this.baseUrl.href))
        scopeBaseUrl = this.baseUrl.href;
      else if (scopeUrl.href.startsWith(scopeUrl.origin))
        scopeBaseUrl = scopeUrl.origin + '/';
      if (scopeBaseUrl) scopeBase = this.scopes[scopeBaseUrl] || {};
      if (!scopeBase) continue;
      const scopeImports = this.scopes[scope];
      if (scopeBase === scopeImports) continue;
      let flattenedAll = true;
      for (const name of Object.keys(scopeImports)) {
        const existing = scopeBase[name];
        const target = scopeImports[name];
        if (target === null) continue;
        const targetUrl = new URL(target, this.baseUrl);
        if (this.imports[name] === targetUrl.href) {
          delete scopeImports[name];
        }
        else if (!existing || new URL(existing, this.baseUrl).href === targetUrl.href) {
          scopeBase[name] = relativeUrl(targetUrl, this.baseUrl);
          delete scopeImports[name];
          this.scopes[<string>scopeBaseUrl] = alphabetize(scopeBase);
        }
        else {
          flattenedAll = false;
        }
      }
      if (flattenedAll)
        delete this.scopes[scope];
    }
    for (const dep of Object.keys(this.depcache)) {
      if (this.depcache[dep].length === 0)
        delete this.depcache[dep];
    }
    return this;
  }

  rebase (newBaseUrl: string = this.baseUrl.href) {
    const oldBaseUrl = this.baseUrl;
    this.baseUrl = new URL(newBaseUrl, baseUrl);
    if (!this.baseUrl.pathname.endsWith('/')) this.baseUrl.pathname += '/';
    // unnormalized targets starting with / are ignored
    for (const impt of Object.keys(this.imports)) {
      const target = this.imports[impt];
      if (target !== null && target[0] !== '/')
        this.imports[impt] = relativeUrl(new URL(target, oldBaseUrl), this.baseUrl);
    }
    for (const scope of Object.keys(this.scopes)) {
      const newScope = relativeUrl(new URL(scope, oldBaseUrl), this.baseUrl);
      const scopeImports = this.scopes[scope];
      if (scope !== newScope) {
        delete this.scopes[scope];
        this.scopes[newScope] = scopeImports;
      }
      for (const name of Object.keys(scopeImports)) {
        const target = scopeImports[name];
        if (target !== null && target[0] !== '/')
          scopeImports[name] = relativeUrl(new URL(target, oldBaseUrl), this.baseUrl);
      }
    }
    const newDepcache = Object.create(null);
    for (const dep of Object.keys(this.depcache)) {
      const importsRebased = this.depcache[dep].map(specifier => {
        if (isPlain(specifier)) return specifier;
        return relativeUrl(new URL(specifier, oldBaseUrl), this.baseUrl);
      });
      const depRebased = relativeUrl(new URL(dep, oldBaseUrl), this.baseUrl);
      newDepcache[depRebased] = importsRebased;
    }
    this.depcache = newDepcache;
    const newIntegrity = Object.create(null);
    for (const dep of Object.keys(this.integrity)) {
      const integrityVal = this.integrity[dep];
      const depRebased = relativeUrl(new URL(dep, oldBaseUrl), this.baseUrl);
      newIntegrity[depRebased] = integrityVal;
    }
    this.integrity = newIntegrity;
    return this;
  }

  resolve (specifier: string, parentUrl: URL): URL | null {
    if (!isPlain(specifier)) return new URL(specifier, parentUrl);
    const scopeMatches = getScopeMatches(parentUrl, this.scopes, this.baseUrl);
    for (const [scope] of scopeMatches) {
      const mapMatch = getMapMatch(specifier, this.scopes[scope]);
      if (mapMatch) {
        const target = this.scopes[scope][mapMatch];
        if (target === null) return null;
        return new URL(target + specifier.slice(mapMatch.length), this.baseUrl);
      }
    }
    const mapMatch = getMapMatch(specifier, this.imports);
    if (mapMatch) {
      const target = this.imports[mapMatch];
      if (target === null) return null;
      return new URL(target + specifier.slice(mapMatch.length), this.baseUrl);
    }
    throw new JspmError(`Unable to resolve "${specifier}" from ${parentUrl.href}`, 'MODULE_NOT_FOUND');
  }

  toJSON () {
    const obj: any = {};
    if (Object.keys(this.imports).length) obj.imports = this.imports;
    if (Object.keys(this.scopes).length) obj.scopes = this.scopes;
    if (Object.keys(this.integrity).length) obj.integrity = this.integrity;
    if (Object.keys(this.depcache).length) obj.depcache = this.depcache;
    return obj;
  }

  toString (minify?: boolean) {
    const obj = this.toJSON();
    return json.stringifyStyled(obj, minify ? Object.assign(this.mapStyle, { indent: '', tab: '', newline: '' }) : this.mapStyle);
  }
}

const scopeCache = new WeakMap<Record<string, Record<string, string | null>>, [string, string][]>();
export function getScopeMatches (parentUrl: URL, scopes: Record<string, Record<string, string | null>>, baseUrl: URL): [string, string][] {
  const parentUrlHref = parentUrl.href;

  let scopeCandidates = scopeCache.get(scopes);
  if (!scopeCandidates) {
    scopeCandidates = Object.keys(scopes).map(scope => [scope, new URL(scope, baseUrl).href]);
    scopeCandidates = scopeCandidates.sort(([, matchA], [, matchB]) => matchA.length < matchB.length ? 1 : -1);
    scopeCache.set(scopes, scopeCandidates);
  }

  return scopeCandidates.filter(([, scopeUrl]) => {
    return scopeUrl === parentUrlHref || scopeUrl.endsWith('/') && parentUrlHref.startsWith(scopeUrl);
  });
}

export function getMapMatch<T = any> (specifier: string, map: Record<string, T>): string | undefined {
  if (specifier in map) return specifier;
  let curMatch;
  for (const match of Object.keys(map)) {
    const wildcard = match.endsWith('*');
    if (!match.endsWith('/') && !wildcard) continue;
    if (specifier.startsWith(wildcard ? match.slice(0, -1) : match)) {
      if (!curMatch || match.length > curMatch.length)
        curMatch = match;
    }
  }
  return curMatch;
}

export function getMapResolved (exportMatch: string, exportTarget: string | null, subpathTarget: string): string | null {
  if (exportTarget === null)
    return null;
  const wildcard = exportMatch.endsWith('*');
  const subpathTrailer = subpathTarget.slice(wildcard ? exportMatch.length - 1 : exportMatch.length);
  if (wildcard)
    return exportTarget.slice(2).replace(/\*/g, subpathTrailer);
  return exportTarget.slice(2) + subpathTrailer;
}
