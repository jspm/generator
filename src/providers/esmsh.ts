import { ExactPackage, PackageConfig } from "../install/package.js";
import { Resolver } from "../trace/resolver.js";
// @ts-ignore
import { fetch } from "#fetch";
import { JspmError } from "../common/err.js";

const cdnUrl = "https://esm.sh/";

export async function pkgToUrl(pkg: ExactPackage): Promise<`${string}/`> {
  // The wildcard '*' at the end tells the esm.sh CDN to externalise all
  // dependencies instead of bundling them into the returned module file.
  //   see https://esm.sh/#docs
  return `${cdnUrl}*${pkg.name}@${pkg.version}/`;
}

const exactPkgRegEx = /^(?:v\d+\/)?\*?((?:@[^/\\%@]+\/)?[^./\\%@][^/\\%@]*)@([^\/]+)(\/.*)?$/;

export function parseUrlPkg(url: string) {
  if (!url.startsWith(cdnUrl)) return;
  const [, name, version] = url.slice(cdnUrl.length).match(exactPkgRegEx) || [];
  if (!name || !version) return;
  return { registry: "npm", name, version };
}

// esm.sh serves im/exports on their "exports" subpaths, whereas the generator
// expects them to be served on their filesystem paths, so we have to rewrite
// the package.json before doing anything with it:
export async function getPackageConfig(
  this: Resolver,
  pkgUrl: string
): Promise<PackageConfig | null> {
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
    case 500:
      this.pcfgs[pkgUrl] = null;
      return;
    default:
      throw new JspmError(
        `Invalid status code ${res.status} reading package config for ${pkgUrl}. ${res.statusText}`
      );
  }

  const pcfg = await res.json();
  return pcfg;
}

// Use JSPM version resolver for now:
export { resolveLatestTarget } from "./jspm.js";
