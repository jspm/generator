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

const exactPkgRegEx =
  /^(?:v\d+\/)?\*?((?:@[^/\\%@]+\/)?[^./\\%@][^/\\%@]*)@([^\/]+)(\/.*)?$/;

export function parseUrlPkg(url: string) {
  if (!url.startsWith(cdnUrl)) return;
  const [, name, version] = url.slice(cdnUrl.length).match(exactPkgRegEx) || [];
  if (!name || !version) return;
  return { registry: "npm", name, version };
}

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

  // esm.sh uses exports paths as paths
  // so we rewrite all exports paths to point to their internal path and let esm.sh do resolution
  // note: strictly speaking we should add ?conditions=... here for the condition set
  // but that will require some more wiring
  if (pcfg.exports) {
    // in the conditional expoort case, paths seem to work?
    // so go with that
    if (Object.keys(pcfg.exports).every((key) => !key.startsWith("./"))) {
      pcfg.exports["."] = pcfg.exports;
    } else {
      // let esm.sh resolve conditions
      for (const key of Object.keys(pcfg.exports)) {
        pcfg.exports[key] = key;
      }
    }
    // wildcard key for esmsh to do its own fallback resolution too
    pcfg.exports["./*"] = "./*";
  }
  if (pcfg.imports) {
    for (const key of Object.keys(pcfg.imports)) {
      pcfg.imports[key] = key;
    }
  }
  return pcfg;
}

// Use JSPM version resolver for now:
export { resolveLatestTarget } from "./jspm.js";
