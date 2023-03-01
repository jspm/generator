import { LatestPackageTarget } from "../install/package.js";
import { ExactPackage } from "../install/package.js";
import { Resolver } from "../trace/resolver.js";
// @ts-ignore
import { fetch } from "#fetch";
import { JspmError } from "../common/err.js";
import { importedFrom } from "../common/url.js";

export function pkgToUrl(pkg: ExactPackage): `${string}/` {
  return `${new URL(pkg.version + pkg.name).href}/`;
}

export function parseUrlPkg(
  this: Resolver,
  url: string
): ExactPackage | undefined {
  const nodeModulesIndex = url.lastIndexOf("/node_modules/");
  if (nodeModulesIndex === -1) return undefined;
  const version = url.slice(0, nodeModulesIndex + 14);
  const pkgParts = url.slice(nodeModulesIndex + 14).split("/");
  const name =
    pkgParts[0][0] === "@" ? pkgParts[0] + "/" + pkgParts[1] : pkgParts[0];
  return { registry: "node_modules", name, version };
}

export async function resolveLatestTarget(
  this: Resolver,
  target: LatestPackageTarget,
  _layer: string,
  parentUrl: string
): Promise<ExactPackage | null> {
  let curUrl = new URL(`node_modules/${target.name}`, parentUrl);
  const rootUrl = new URL(`/node_modules/${target.name}`, parentUrl).href;
  const isScoped = target.name[0] === "@";

  // Mimics the node resolution algorithm: look for a node_modules in the
  // current directory with a package matching the target, and if you can't
  // find it then recurse through the parent directories until you do.
  // TODO: we don't currently handle the target's version constraints here
  while (!(await dirExists.call(this, curUrl))) {
    if (curUrl.href === rootUrl) return null; // failed to resolve

    curUrl = new URL(
      `../../${isScoped ? "../" : ""}node_modules/${target.name}`,
      curUrl
    );
  }

  // Providers need to be able to translate between canonical package specs and
  // URLs in a one-to-one fashion. The nodemodules provider breaks this contract
  // as a node_modules folder may contain multiple copies of a given package
  // and version, and if the user is doing local install overrides then these
  // "identical" packages may have different contents! To work around this we
  // attach the base64-encoded URL of the package to the package name, which
  // we can then reverse to get the correct URL back in pkgToUrl:
  return {
    registry: "node_modules",
    name: target.name,
    version: curUrl.href.slice(0, -target.name.length),
  };
}

async function dirExists(url: URL, parentUrl?: string) {
  const res = await fetch(url, this.fetchOpts);
  switch (res.status) {
    case 304:
    case 200:
      return true;
    case 404:
      return false;
    default:
      throw new JspmError(
        `Invalid status code ${res.status} looking up "${url}" - ${
          res.statusText
        }${importedFrom(parentUrl)}`
      );
  }
}
