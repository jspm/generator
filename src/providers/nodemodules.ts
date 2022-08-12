import { LatestPackageTarget } from "../install/package.js";
import { ExactPackage } from "../install/package.js";
import { Resolver } from "../trace/resolver.js";
// @ts-ignore
import { fetch } from '#fetch';
import { JspmError } from "../common/err.js";
import { importedFrom } from "../common/url.js";

export function pkgToUrl (pkg: ExactPackage) {
  return new URL(pkg.version + pkg.name + '/').href;
}

export function parseUrlPkg (this: Resolver, url: string): ExactPackage | undefined {
  const nodeModulesIndex = url.lastIndexOf('/node_modules/');
  if (nodeModulesIndex === -1)
    return undefined;
  const version = url.slice(0, nodeModulesIndex + 14);
  const pkgParts = url.slice(nodeModulesIndex + 14).split('/');
  const name = pkgParts[0][0] === '@' ? pkgParts[0] + '/' + pkgParts[1] : pkgParts[0];
  return { registry: 'node_modules', name, version };
}

async function dirExists (url: URL, parentUrl?: string) {
  const res = await fetch(url, this.fetchOpts);
  switch (res.status) {
    case 304:
    case 200:
      return true;
    case 404:
      return false;
    default:
      throw new JspmError(`Invalid status code ${res.status} looking up "${url}" - ${res.statusText}${importedFrom(parentUrl)}`);
  }
}

export async function resolveLatestTarget (this: Resolver, target: LatestPackageTarget, _layer: string, parentUrl: string): Promise<ExactPackage | null> {
  let curUrl = new URL(`node_modules/${target.name}`, parentUrl);
  const rootUrl = new URL(`/node_modules/${target.name}`, parentUrl).href;
  while (!(await dirExists.call(this, curUrl))) {b
    if (curUrl.href === rootUrl)
      return null;
    curUrl = new URL(`../../${target.name.indexOf('/') === -1 ? '' : '../'}node_modules/${target.name}`, curUrl);
  }
  return { registry: 'node_modules', name: target.name, version: curUrl.href.slice(0, -target.name.length) };
}
