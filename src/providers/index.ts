import * as deno from "./deno.js";
import * as jspm from "./jspm.js";
import * as skypack from "./skypack.js";
import * as jsdelivr from "./jsdelivr.js";
import * as unpkg from "./unpkg.js";
import * as node from "./node.js";
import {
  PackageConfig,
  ExactPackage,
  LatestPackageTarget,
} from "../install/package.js";
import { Resolver } from "../trace/resolver.js";
import { Install } from "../generator.js";
import { JspmError } from "../common/err.js";

export interface Provider {
  parseUrlPkg(
    this: Resolver,
    url: string
  ):
    | ExactPackage
    | { pkg: ExactPackage; subpath: `./${string}` | null; layer: string }
    | null;

  pkgToUrl(
    this: Resolver,
    pkg: ExactPackage,
    layer: string
  ): Promise<`${string}/`>;

  resolveLatestTarget(
    this: Resolver,
    target: LatestPackageTarget,
    layer: string,
    parentUrl: string
  ): Promise<ExactPackage | null>;

  ownsUrl?(this: Resolver, url: string): boolean;

  resolveBuiltin?(
    this: Resolver,
    specifier: string,
    env: string[]
  ): string | Install | null;

  getPackageConfig?(
    this: Resolver,
    pkgUrl: string
  ): Promise<PackageConfig | null>;
}

export const defaultProviders: Record<string, Provider> = {
  deno,
  jsdelivr,
  node,
  skypack,
  unpkg,
  "jspm.io": jspm,
};

export function getProvider(name: string, providers: Record<string, Provider>) {
  const provider = providers[name];
  if (provider) return provider;
  throw new JspmError(`No provider named "${name}" has been defined.`);
}

export const registryProviders: Record<string, string> = {
  "denoland:": "deno",
  "deno:": "deno",
};

export const mappableSchemes = new Set<String>(["npm", "deno", "node"]);

export const builtinSchemes = new Set<String>(["node", "deno"]);
