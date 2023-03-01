import { LatestPackageTarget } from "../install/package.js";
import { ExactPackage } from "../install/package.js";
import { Resolver } from "../trace/resolver.js";
// @ts-ignore
import { fetch } from "#fetch";
import { JspmError, throwInternalError } from "../common/err.js";
import { importedFrom } from "../common/url.js";

export async function pkgToUrl(pkg: ExactPackage): Promise<`${string}/`> {
  const url = pkg.name.split("#");
  if (url.length === 1) {
    // TODO: this happens when we have existing ExactPackages from an input
    // map that was using a different provider, need async to resolve
    throwInternalError("Unimplemented in nodemodules: pkgToUrl");
  }

  return `${decodeBase64(url[1])}/`;
}

export async function parseUrlPkg(
  this: Resolver,
  url: string
): Promise<ExactPackage | null> {
  const nodeModulesIndex = url.lastIndexOf("/node_modules/");
  if (nodeModulesIndex === -1) return null;

  const nameAndSubpaths = url.slice(nodeModulesIndex + 14).split("/");
  const name =
    nameAndSubpaths[0][0] === "@"
      ? `${nameAndSubpaths[0]}/${nameAndSubpaths[1]}`
      : nameAndSubpaths[0];
  const nodeModules = `${url.slice(0, nodeModulesIndex + 14)}${name}`;

  // TODO: make this async and do a pcfg lookup for the version
  return {
    name: `${name}#${encodeBase64(nodeModules)}`,
    registry: "node_modules",
    version: "1.0.0",
  };
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

  // Local packages might not have a package.json, and hence have no version:
  const pcfg = await this.getPackageConfig(`${curUrl.href}/`);
  const version = pcfg?.version || "";

  // Providers need to be able to translate between canonical package specs and
  // URLs in a one-to-one fashion. The nodemodules provider breaks this contract
  // as a node_modules folder may contain multiple copies of a given package
  // and version, and if the user has local packages installed then "identical"
  // packages may have different contents! To work around this we attach the
  // base64-encoded URL of the package to the package name, which we can then
  // reverse to get the correct URL back in pkgToUrl:
  return {
    registry: "node_modules",
    name: `target.name#${encodeBase64(curUrl.href)}`,
    version: version,
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

function encodeBase64(data: string): string {
  if (typeof window !== "undefined") {
    return window.btoa(data);
  }

  return Buffer.from(data).toString("base64");
}

function decodeBase64(data: string): string {
  if (typeof window !== "undefined") {
    return window.atob(data);
  }

  return Buffer.from(data, "base64").toString("utf8");
}
