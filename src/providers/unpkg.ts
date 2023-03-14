import { ExactPackage } from "../install/package.js";

const cdnUrl = "https://unpkg.com/";

export async function pkgToUrl(pkg: ExactPackage): Promise<`${string}/`> {
  return `${cdnUrl}${pkg.name}@${pkg.version}/`;
}

const exactPkgRegEx = /^((?:@[^/\\%@]+\/)?[^./\\%@][^/\\%@]*)@([^\/]+)(\/.*)?$/;

export function parseUrlPkg(url: string) {
  if (!url.startsWith(cdnUrl)) return;
  const [, name, version] = url.slice(cdnUrl.length).match(exactPkgRegEx) || [];
  if (name && version) {
    return { registry: "npm", name, version };
  }
}

// Use JSPM version resolver for now
export { resolveLatestTarget } from "./jspm.js";
