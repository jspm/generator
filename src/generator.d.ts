import { ImportMap } from '@jspm/import-map';

export type LogStream = () => AsyncGenerator<{ type: string, message: string }, never, unknown>;

export interface GeneratorOptions {
  mapUrl?: URL | string;
  defaultProvider?: string;
  env?: string[];
  cache?: 'offline' | boolean;
  stdlib?: string;
  providers?: Record<string, string>;
}

export interface Install {
  target: string;
  subpath?: '.' | `./${string}`;
  subpaths?: ('.' | `./${string}`)[];
  alias?: string;
}

export interface IImportMap {
  imports: Record<string, string>;
  scopes?: Record<string, Record<string, string>>;
}

export interface ExactPackage {
  registry: string;
  name: string;
  version: string;
}

export declare class Generator {
  logStream: LogStream;
  constructor ({ mapUrl, env, defaultProvider, cache, stdlib }?: GeneratorOptions);
  install (install: string | Install | (string | Install)[]): Promise<{
    staticDeps: string[];
    dynamicDeps: string[];
  }>;
  importMap: ImportMap;
  getMap (): IImportMap;
  getAnalysis (url: string | URL): ModuleAnalysis;
  traceInstall (specifier: string, parentUrl?: string | URL): Promise<{
    staticDeps: string[];
    dynamicDeps: string[];
  }>;
}

export interface ModuleAnalysis {
  format: 'commonjs' | 'esm' | 'system' | 'json' | 'typescript';
  staticDeps: string[];
  dynamicDeps: string[];
  cjsLazyDeps: string[] | null;
}

export interface LookupOptions {
  provider?: string;
  cache?: 'offline' | boolean;
}

export declare function lookup (install: string | Install, lookupOptions?: LookupOptions): Promise<{
  install: {
    target: {
      registry: string;
      name: string;
      range: string;
    };
    subpath: string;
    alias: string;
  },
  resolved: {
    registry: string;
    name: string;
    version: string;
  }
}>;

export declare function getPackageConfig (pkg: string | URL | ExactPackage, lookupOptions?: LookupOptions): Promise<Object | null>;

export declare function clearCache (): void;
