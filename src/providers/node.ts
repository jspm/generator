import { ExactPackage, LatestPackageTarget } from "../install/package.js";
import { Resolver } from "../trace/resolver.js";
import { resolveLatestTarget as jspmResolveLatestTarget, pkgToUrl as jspmPkgToUrl } from './jspm.js';
import { SemverRange } from 'sver';

export const nodeBuiltinSet = new Set<string>([
  '_http_agent',         '_http_client',        '_http_common',
  '_http_incoming',      '_http_outgoing',      '_http_server',
  '_stream_duplex',      '_stream_passthrough', '_stream_readable',
  '_stream_transform',   '_stream_wrap',        '_stream_writable',
  '_tls_common',         '_tls_wrap',           'assert',
  'assert/strict',       'async_hooks',         'buffer',
  'child_process',       'cluster',             'console',
  'constants',           'crypto',              'dgram',
  'diagnostics_channel', 'dns',                 'dns/promises',
  'domain',              'events',              'fs',
  'fs/promises',         'http',                'http2',
  'https',               'inspector',           'module',
  'net',                 'os',                  'path',
  'path/posix',          'path/win32',          'perf_hooks',
  'process',             'punycode',            'querystring',
  'readline',            'repl',                'stream',
  'stream/promises',     'string_decoder',      'sys',
  'timers',              'timers/promises',     'tls',
  'trace_events',        'tty',                 'url',
  'util',                'util/types',          'v8',
  'vm',                  'wasi',                'worker_threads',
  'zlib'
]);

export function pkgToUrl (pkg: ExactPackage) {
  if (pkg.registry !== 'node')
    return jspmPkgToUrl(pkg, 'default');
  return 'node:' + pkg.name;
}

export function parseUrlPkg (url: string): ExactPackage | undefined {
  if (!url.startsWith('node:'))
    return;
  return { registry: 'node', name: url.slice(5), version: '' };
}

export async function getPackageConfig () {
  return null;
}

export async function resolveLatestTarget (this: Resolver, target: LatestPackageTarget, _layer: string, parentUrl: string): Promise<{ pkg: ExactPackage, subpath: `./${string}` } | null> {
  let resolved = (await jspmResolveLatestTarget.call(this, { registry: 'npm', name: '@jspm/core', range: new SemverRange('*') }, _layer, parentUrl)) as ExactPackage | { pkg: ExactPackage, subpath: `./${string}` | null } | null;
  if (!resolved)
    return null;
  const pkg = 'pkg' in resolved ? resolved.pkg : resolved;
  return { pkg, subpath: `./nodelibs/${target.name}` };
}
