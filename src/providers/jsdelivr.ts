import { ExactPackage } from "../install/package.js";

export const name = 'jsdelivr';

const cdnUrl = 'https://cdn.jsdelivr.net/';

export const layers = { default: cdnUrl };

export function pkgToUrl (pkg: ExactPackage) {
  return cdnUrl + pkg.registry + '/' + pkg.name + '@' + pkg.version + '/';
}

const exactPkgRegEx = /^([^\/]+)\/((?:@[^/\\%@]+\/)?[^./\\%@][^/\\%@]*)@([^\/]+)(\/.*)?$/;
export function parseUrlPkg (url: string): ExactPackage | undefined {
  if (!url.startsWith(cdnUrl))
    return;
  const [, registry, name, version] = url.slice(cdnUrl.length).match(exactPkgRegEx) || [];
  return { registry, name, version };
}

// Use JSPM verion resolver for now
export { resolveLatestTarget } from './jspm.js';
