import { ExactPackage } from "../install/package.js";

// The wildcard '*' at the end tells the esm.sh CDN to externalise all
// dependencies instead of bundling them into the returned module file.
//   see https://esm.sh/#docs
const cdnUrl = "https://esm.sh/*";

export async function pkgToUrl(pkg: ExactPackage): Promise<`${string}/`> {
  return `${cdnUrl}${pkg.name}@${pkg.version}/`;
}

const exactPkgRegEx = /^((?:@[^/\\%@]+\/)?[^./\\%@][^/\\%@]*)@([^\/]+)(\/.*)?$/;

export function parseUrlPkg(url: string) {
  if (!url.startsWith(cdnUrl)) return;
  const [, name, version] = url.slice(cdnUrl.length).match(exactPkgRegEx) || [];
  if (!name || !version) return;
  return { registry: "npm", name, version };
}

// Use JSPM version resolver for now:
export { resolveLatestTarget } from "./jspm.js";
