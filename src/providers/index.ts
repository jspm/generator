import * as jspm from './jspm.js';
import * as skypack from './skypack.js';
import * as jsdelivr from './jsdelivr.js';
import * as unpkg from './unpkg.js';
import * as nodemodules from './nodemodules.js';
import { PackageConfig, ExactPackage } from '../install/package.js';
import { Resolver } from '../install/resolver.js';
import { PackageTarget } from '../install/package.js';

export interface Provider {
  name: string;
  parseUrlPkg (this: Resolver, url: string): ExactPackage | { pkg: ExactPackage, layer: string } | undefined;
  pkgToUrl (this: Resolver, pkg: ExactPackage, layer: string): string;
  getPackageConfig? (this: Resolver, pkgUrl: string): Promise<PackageConfig | null | undefined>;
  resolveLatestTarget (this: Resolver, target: PackageTarget, unstable: boolean, layer: string, parentUrl: string): Promise<ExactPackage | null>;
  getFileList? (this: Resolver, pkgUrl: string): Promise<string[]>;
}

export const providers: Record<string, Provider> = {
  jsdelivr,
  jspm,
  nodemodules,
  skypack,
  unpkg
};

export function getProvider (name: string) {
  const provider = providers[name];
  if (provider)
    return provider;
  throw new Error('No ' + name + ' provider is defined.');
}
