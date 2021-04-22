import * as jspm from './jspm.js';
import * as skypack from './skypack.js';
import * as jsdelivr from './jsdelivr.js';
import * as unpkg from './unpkg.js';
import { PackageConfig, ExactPackage } from '../install/package.js';
import { Resolver } from '../install/resolver.js';
import { PackageTarget } from '../install/package.js';

export interface Provider {
  name: string;
  cdnUrl: string;
  parseUrlPkg (this: Resolver, url: string): ExactPackage | undefined;
  pkgToUrl (this: Resolver, pkg: ExactPackage): string;
  getPackageConfig? (this: Resolver, pkgUrl: string): Promise<PackageConfig | null | undefined>;
  resolveLatestTarget (this: Resolver, target: PackageTarget, unstable: boolean, parentUrl?: string): Promise<ExactPackage | null>;
  getFileList? (this: Resolver, pkgUrl: string): Promise<string[]>;
}

const providers: Record<string, Provider> = {
  jspm, skypack, jsdelivr, unpkg
};

export function getProvider (name: string) {
  const provider = providers[name];
  if (provider)
    return provider;
  throw new Error('No ' + name + ' provider is defined.');
}

export function getUrlProvider (url: string) {
  for (const cdnUrl of Object.keys(providers)) {
    if (url.startsWith(cdnUrl)) {
      return providers[cdnUrl];
    }
  }
}
