import { ExactPackage } from "../install/package.js";

export const name = 'skypack';

export const cdnUrl = 'https://cdn.skypack.dev/';

export function pkgToUrl (pkg: ExactPackage) {
  return cdnUrl + pkg.name + '@' + pkg.version + '/';
}

const exactPkgRegEx = /^((?:@[^/\\%@]+\/)?[^./\\%@][^/\\%@]*)@([^\/]+)(\/.*)?$/;
export function parseUrlPkg (url: string): ExactPackage | undefined {
  if (!url.startsWith(cdnUrl))
    return;
  const [,, name, version] = url.slice(cdnUrl.length).match(exactPkgRegEx) || [];
  return { registry: 'npm', name, version };
}

// Use JSPM verion resolver for now
export { resolveLatestTarget } from './jspm.js';
