import { ExactPackage } from "../install/package.js";

const cdnUrl = "https://cdn.jsdelivr.net/";

export async function pkgToUrl(pkg: ExactPackage): Promise<`${string}/`> {
  return `${cdnUrl}${pkg.registry}/${pkg.name}@${pkg.version}/`;
}

const exactPkgRegEx =
  /^([^\/]+)\/((?:@[^/\\%@]+\/)?[^./\\%@][^/\\%@]*)@([^\/]+)(\/.*)?$/;

export function parseUrlPkg(url: string) {
  if (!url.startsWith(cdnUrl)) return;
  const [, registry, name, version] =
    url.slice(cdnUrl.length).match(exactPkgRegEx) || [];
  return { registry, name, version };
}

// Use JSPM verion resolver for now
export { resolveLatestTarget } from "./jspm.js";
