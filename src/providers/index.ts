import * as deno from "./deno.js";
import * as jspm from "./jspm.js";
import * as skypack from "./skypack.js";
import * as jsdelivr from "./jsdelivr.js";
import * as unpkg from "./unpkg.js";
import * as nodemodules from "./nodemodules.js";
import * as node from "./node.js";
import {
  PackageConfig,
  ExactPackage,
  LatestPackageTarget,
} from "../install/package.js";
import { Resolver } from "../trace/resolver.js";
import { Install } from "../generator.js";

export interface Provider {
  parseUrlPkg(
    this: Resolver,
    url: string
  ):
    | ExactPackage
    | { pkg: ExactPackage; subpath: `./${string}` | null; layer: string }
    | undefined;
  pkgToUrl(this: Resolver, pkg: ExactPackage, layer: string): `${string}/`;
  resolveLatestTarget(
    this: Resolver,
    target: LatestPackageTarget,
    layer: string,
    parentUrl: string
  ): Promise<ExactPackage | null>;
  resolveBuiltin?(
    this: Resolver,
    specifier: string,
    env: string[]
  ): string | Install | undefined;
  getPackageConfig?(
    this: Resolver,
    pkgUrl: string
  ): Promise<PackageConfig | null | undefined>;
  getFileList?(this: Resolver, pkgUrl: string): Promise<string[]>;
}

export const defaultProviders: Record<string, Provider> = {
  deno,
  jsdelivr,
  node,
  nodemodules,
  skypack,
  unpkg,
  "jspm.io": jspm,
};

export function getProvider(
  name: string,
  providers: Record<string, Provider> = defaultProviders
) {
  const provider = providers[name];
  if (provider) return provider;
  throw new Error("No " + name + " provider is defined.");
}

export const registryProviders: Record<string, string> = {
  "denoland:": "deno",
  "deno:": "deno",
};

export const mappableSchemes = new Set<String>(["npm", "deno", "node"]);

export const builtinSchemes = new Set<String>(["node", "deno"]);
