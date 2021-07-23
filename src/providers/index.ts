import * as jspm from './jspm.js';
import * as skypack from './skypack.js';
import * as jsdelivr from './jsdelivr.js';
import * as unpkg from './unpkg.js';
import * as nodemodules from './nodemodules.js';
import { PackageConfig, ExactPackage, LatestPackageTarget } from '../install/package.js';
import { Resolver } from '../trace/resolver.js';

export interface Provider {
  parseUrlPkg (this: Resolver, url: string): ExactPackage | { pkg: ExactPackage, layer: string } | undefined;
  pkgToUrl (this: Resolver, pkg: ExactPackage, layer: string): string;
  resolveLatestTarget (this: Resolver, target: LatestPackageTarget, unstable: boolean, layer: string, parentUrl: string): Promise<ExactPackage | null>;

  getPackageConfig? (this: Resolver, pkgUrl: string): Promise<PackageConfig | null | undefined>;
  // getFileList? (this: Resolver, pkgUrl: string): Promise<string[]>;
}

export const defaultProviders: Record<string, Provider> = {
  jsdelivr,
  jspm,
  nodemodules,
  skypack,
  unpkg
};

export function getProvider (name: string, providers: Record<string, Provider> = defaultProviders) {
  const provider = providers[name];
  if (provider)
    return provider;
  throw new Error('No ' + name + ' provider is defined.');
}
