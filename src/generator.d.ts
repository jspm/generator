export type LogStream = () => AsyncGenerator<{ type: string, message: string }, never, unknown>;

export interface GeneratorOptions {
    mapUrl?: URL | string;
    defaultProvider?: string;
    env?: string[];
    cache?: string | boolean;
    stdlib?: string;
}

export interface Install {
    target: string;
    subpath?: '.' | `./${string}`;
    subpaths?: ('.' | `./${string}`)[];
    alias?: string;
}

export declare function clearCache(): void;

export declare class Generator {
    logStream: LogStream;
    constructor({ mapUrl, env, defaultProvider, cache, stdlib }?: GeneratorOptions);
    lookup(install: string | Install): Promise<{
        registry: string;
        name: string;
        version: string;
        subpath: any;
    }>;
    install(install: string | Install | (string | Install)[]): Promise<{
        staticDeps: string[];
        dynamicDeps: string[];
    }>;
    getMap(): any;
}
