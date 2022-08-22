import { JspmError } from "../common/err.js";
import { baseUrl, isRelative } from "../common/url.js";
// @ts-ignore
import sver from 'sver';
const { SemverRange } = sver;
// @ts-ignore
import convertRange from 'sver/convert-range.js';
import { InstallTarget } from "./installer.js";
import { Resolver } from "../trace/resolver.js";
import { urlToNiceStr } from "../common/url.js";

export interface ExactPackage {
  registry: string;
  name: string;
  version: string;
}

export type ExportsTarget = `./${string}` | null | { [condition: string]: ExportsTarget } | ExportsTarget[];
export type ImportsTarget = string | null | { [condition: string]: ExportsTarget } | ExportsTarget[];

export interface PackageConfig {
  registry?: string;
  name?: string;
  version?: string;
  main?: string;
  files?: string[];
  module?: string;
  browser?: string | Record<string, string | false>;
  imports?: Record<string, ExportsTarget>;
  exports?: ExportsTarget | Record<string, ExportsTarget>;
  type?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface PackageTarget {
  registry: string;
  name: string;
  ranges: any[];
  unstable: boolean;
}

export interface LatestPackageTarget {
  registry: string;
  name: string;
  range: any;
  unstable: boolean;
}

const supportedProtocols = ['https', 'http', 'data', 'file', 'ipfs'];
export async function parseUrlTarget (resolver: Resolver, targetStr: string, parentUrl?: URL): Promise<{ alias: string, target: URL, subpath: '.' | `./${string}` } | undefined> {
  const registryIndex = targetStr.indexOf(':');
  if (isRelative(targetStr) || registryIndex !== -1 && supportedProtocols.includes(targetStr.slice(0, registryIndex))) {
    const subpathIndex = targetStr.indexOf('|');
    let subpath: '.' | `./${string}`
    if (subpathIndex === -1) {
      subpath = '.';
    }
    else {
      subpath = `./${targetStr.slice(subpathIndex + 1)}` as `./${string}`;
      targetStr = targetStr.slice(0, subpathIndex);
    }
    const target = new URL(targetStr + (targetStr.endsWith('/') ? '' : '/'), parentUrl || baseUrl);
    const pkgUrl = await resolver.getPackageBase(target.href);

    const alias = (pkgUrl ? await resolver.getPackageConfig(pkgUrl) : null)?.name || target.pathname.split('/').slice(0, -1).pop() as string;
    if (!alias)
      throw new JspmError(`Unable to determine an alias for target package ${target.href}`);
    return { alias, target, subpath };
  }
}

// ad-hoc determination of local path v remote package for eg "jspm deno react" v "jspm deno react@2" v "jspm deno ./react.ts" v "jspm deno react.ts"
const supportedRegistries = ['npm', 'github', 'deno', 'nest', 'denoland'];
export function isPackageTarget (targetStr: string): boolean {
  if (isRelative(targetStr))
    return false;
  const registryIndex = targetStr.indexOf(':');
  if (registryIndex !== -1 && supportedRegistries.includes(targetStr.slice(0, registryIndex)))
    return true;
  const pkg = parsePkg(targetStr);
  if (!pkg)
    return false;
  if (pkg.pkgName.indexOf('@') !== -1)
    return true;
  if (targetStr.endsWith('.ts') || targetStr.endsWith('.js') || targetStr.endsWith('.mjs'))
    return false;
  return true;
}

export function pkgUrlToNiceString (resolver: Resolver, pkgUrl: string) {
  const pkg = resolver.parseUrlPkg(pkgUrl);
  if (pkg) {
    const subpath = pkgUrl.slice(resolver.pkgToUrl(pkg.pkg, this.defaultProvider).length);
    return pkgToStr(pkg.pkg) + subpath;
  }
  if (pkgUrl.startsWith('file:')) {
    return urlToNiceStr(pkgUrl);
  }
  return pkgUrl;
}

export async function toPackageTarget (resolver: Resolver, targetStr: string, parentPkgUrl: URL, defaultRegistry: string): Promise<{ alias: string, target: InstallTarget, subpath: '.' | `./${string}` }> {
  const urlTarget = await parseUrlTarget(resolver, targetStr, parentPkgUrl);
  if (urlTarget)
    return urlTarget;

  const registryIndex = targetStr.indexOf(':');

  // TODO: package aliases support as per https://github.com/npm/rfcs/blob/latest/implemented/0001-package-aliases.md
  const versionOrScopeIndex = targetStr.indexOf('@');
  if (targetStr.indexOf(':') !== -1 && versionOrScopeIndex !== -1 && versionOrScopeIndex < registryIndex)
    throw new Error(`Package aliases not yet supported. PRs welcome.`);

  const pkg = parsePkg(targetStr);
  if (!pkg)
    throw new JspmError(`Invalid package name ${targetStr}`);

  let alias = pkg.pkgName;
  const versionIndex = pkg.pkgName.indexOf('@', 1);
  if (versionIndex !== -1)
    alias = pkg.pkgName.slice(registryIndex + 1, versionIndex);
  else
    alias = pkg.pkgName.slice(registryIndex + 1);

  return {
    alias,
    target: newPackageTarget(pkg.pkgName, parentPkgUrl, defaultRegistry),
    subpath: pkg.subpath as '.' | `./{string}`
  };
}

export function newPackageTarget (target: string, parentPkgUrl: URL, defaultRegistry: string, depName?: string): InstallTarget {
  let registry: string, name: string, ranges: any[];

  const registryIndex = target.indexOf(':');

  if (target.startsWith('./') || target.startsWith('../') || target.startsWith('/') || registryIndex === 1)
    return new URL(target, parentPkgUrl);

  registry = registryIndex < 1 ? defaultRegistry : target.slice(0, registryIndex);

  if (registry === 'file')
    return new URL(target.slice(registry.length + 1), parentPkgUrl);

  if (registry === 'https' || registry === 'http')
    return new URL(target);

  const versionIndex = target.lastIndexOf('@');
  let unstable = false;
  if (versionIndex > registryIndex + 1) {
    name = target.slice(registryIndex + 1, versionIndex);
    const version = target.slice(versionIndex + 1);
    ranges = (depName || SemverRange.isValid(version)) ? [new SemverRange(version)] : version.split('||').map(v => convertRange(v));
    if (version === '')
      unstable = true;
  }
  else if (registryIndex === -1 && depName) {
    name = depName;
    ranges = SemverRange.isValid(target) ? [new SemverRange(target)] : target.split('||').map(v => convertRange(v));
  }
  else {
    name = target.slice(registryIndex + 1);
    ranges = [new SemverRange('*')];
  }

  if (registryIndex === -1 && name.indexOf('/') !== -1 && name[0] !== '@')
    registry = 'github';

  const targetNameLen = name.split('/').length;
  if (targetNameLen > 2 || targetNameLen === 1 && name[0] === '@')
    throw new JspmError(`Invalid package target ${target}`);

  return { registry, name, ranges, unstable };
}

export function pkgToStr (pkg: ExactPackage) {
  return `${pkg.registry ? pkg.registry + ':' : ''}${pkg.name}${pkg.version ? '@' + pkg.version : ''}`;
}

export function parsePkg (specifier: string): { pkgName: string, subpath: '.' | `./${string}` } | undefined {
  let sepIndex = specifier.indexOf('/');
  if (specifier[0] === '@') {
    if (sepIndex === -1) return;
    sepIndex = specifier.indexOf('/', sepIndex + 1);
  }
  // TODO: Node.js validations like percent encodng checks
  if (sepIndex === -1)
    return { pkgName: specifier, subpath: '.' };
  return { pkgName: specifier.slice(0, sepIndex), subpath: `.${specifier.slice(sepIndex)}` as '.' | `./${string}` };
}

// export function getPackageName (specifier: string, parentUrl: string) {
//   let sepIndex = specifier.indexOf('/');
//   if (specifier[0] === '@') {
//     if (sepIndex === -1)
//       throw new Error(`${specifier} is not an invalid scope name${importedFrom(parentUrl)}.`);
//     sepIndex = specifier.indexOf('/', sepIndex + 1);
//   }
//   return sepIndex === -1 ? specifier : specifier.slice(0, sepIndex);
// }
