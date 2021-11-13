# JSPM Generator

Package Import Map Generation Tool

Manages version resolutions of modules against modules CDNs or even local node_modules via [supported providers](#defaultProvider).

For an interactive UI for this tool running on JSPM.IO, see [https://generator.jspm.io](https://generator.jspm.io).

## Getting Started

### Installation

Node.js:
```
npm install @jspm/generator
```

`@jspm/generator` only ships as an ES module, so to use it in Node.js add `"type": "module"` to your package.json file or write an `.mjs` to load it.

Browser:

```html
<script type="importmap">
{
  imports: {
    '@jspm/generator': 'https://ga.jspm.io/npm:@jspm/generator@1.0.0-beta.15/dist/generator.js'
  },
  scopes: {
    'https://ga.jspm.io/': {
      '#fetch': 'https://ga.jspm.io/npm:@jspm/generator@1.0.0-beta.15/dist/fetch-native.js',
      '@jspm/import-map': 'https://ga.jspm.io/npm:@jspm/import-map@0.1.5/dist/map.js',
      buffer: 'https://ga.jspm.io/npm:@jspm/core@2.0.0-beta.10/nodelibs/browser/buffer.js',
      'es-module-lexer': 'https://ga.jspm.io/npm:es-module-lexer@0.4.1/dist/lexer.cjs',
      fs: 'https://ga.jspm.io/npm:@jspm/core@2.0.0-beta.10/nodelibs/browser/fs.js',
      process: 'https://ga.jspm.io/npm:@jspm/core@2.0.0-beta.10/nodelibs/browser/process.js',
      semver: 'https://ga.jspm.io/npm:semver@6.3.0/semver.js',
      sver: 'https://ga.jspm.io/npm:sver@1.8.3/sver.js',
      'sver/convert-range.js': 'https://ga.jspm.io/npm:sver@1.8.3/convert-range.js',
      url: 'https://ga.jspm.io/npm:@jspm/core@2.0.0-beta.10/nodelibs/browser/url.js'
    }
  }
}
</script>
<script type="module" src="generate.mjs"></script>
```

### Usage

generate.mjs
```js
import { Generator } from '@jspm/generator';

const generator = new Generator({
  mapUrl: import.meta.url,
  inputMap: {
    "imports": {
      "react": "https://cdn.skypack.dev/react"
    }
  },
  defaultProvider: 'jspm',
  providers: {
    '@orgscope': 'nodemodules'
  },
  customProviders: {},
  env: ['production', 'browser'],
  cache: false,
});

// Install a new package into the import map
await generator.install('react-dom');

// Install a package version and subpath into the import map (installs lit/decorators.js)
await generator.install('lit@2/decorators.js');

// Install a package version to a custom alias
await generator.install({ alias: 'react16', target: 'react@16' });

// Install a specific subpath of a package
await generator.install({ target: 'lit@2', subpath: './html.js' });

// Install an export from a locally located package folder into the map
// The package.json is used to determine the exports and dependencies.
await generator.install({ alias: 'mypkg', target: './packages/local-pkg', subpath: './feature' });

console.log(JSON.stringify(generator.getMap(), null, 2));
/*
 * Outputs the import map:
 *
 * {
 *   "imports": {
 *     "lit/decorators.js": "https://ga.jspm.io/npm:lit@2.0.0-rc.1/decorators.js",
 *     "lit/html.js": "https://ga.jspm.io/npm:lit@2.0.0-rc.1/html.js",
 *     "mypkg/feature": "./packages/local-pkg/feature.js",
 *     "react": "https://cdn.skypack.dev/react",
 *     "react16": "https://ga.jspm.io/npm:react@16.14.0/index.js",
 *     "react-dom": "https://ga.jspm.io/npm:react-dom@17.0.2/index.js"
 *   },
 *   "scopes": { ... }
 * }
 */

// Instead of installing, an entry point module can be traced directly
// Then all of its dependencies will be installed into the map only as needed
await generator.traceInstall('./app.js');

// generator.importMap returns the internal import map instance,
// with API per the @jspm/import-map package
const map = generator.importMap.resolve('lit/html.js);
// -> https://ga.jspm.io/npm:lit@2.0.0-rc.1/html.js

// Once packages are installed, the resolve function provides direct import map resolutions:

// https://ga.jspm.io/npm:lit@2.0.0-rc.1/decorators.js
console.log(generator.resolve('lib/decorators.js'/*, optionalScopeUrl */));
```

The `"scopes"` field is populated with all necessary deep dependencies with versions deduped and shared as
possible within version ranges. Just like a file-system-based package manager, JSPM will handle dependency
version constraints in the import map to enable maximum code sharing with minimal duplication.

Multiple installs are supported via array inputs to install:

```js
// Pass an array to install to install multiple packages at the same time
await generator.install([{ target: 'react' }, { target: 'lit' }]);
```

Multiple subpaths can be supported via the `subpaths` install option:

```js
await generator.install({ target: '@material-ui/core@4.11.4', subpaths: ['./AccordionDetails', './Accordion'] });
```

### Module Preloading

The return value of the the `install` command contains the full dependency graph list via `staticDeps` and `dynamicDeps`:

```js
const { staticDeps, dynamicDeps } = await generator.install('lit');
```

These are arrays of full URLs to the loaded module, which can be used to construct module preloading tags:

```js
let preloadHtml = '';
for (const dep of staticDeps) {
  preloadHtml += `<link rel="modulepreload" href="${dep}"/>\n`;
}
```

For batch install jobs, the dependencies include all installs. When using separate `.install` commands the lists are per-install.

### Providers

Supported providers include `"jspm"`, `"jspm.system"`, `"nodemodules"`, `"skypack"`, `"jsdelivr"`, `"unpkg"`, with all except
`"nodemodules"` corresponding to their respective CDNs as the package source.

The `"nodemodules"` provider does a traditional `node_modules` path search from the current module URL (eg for a
`file:///` URL when generating maps for local code). When running over other URL protocols such as from the browser, the
only requirement is that the protocol in use does not return an error code for directory listing requests to node_modules, as
many local dev servers support. The dependency package can then be located and the import map is constructed against these
node_modules lookups.

The `"jspm.system"` provider can be used to generate import maps for SystemJS, which behave identically to modules on `"jspm"`
but fully supporting older browsers due to the semantic equivalence with ES modules of the SystemJS module format.

### Working with Import Maps

Import maps are supported in Chrome 89+ and related Chromium browsers. In these environments, the import map
can be included with an inline `"importmap"` script tag (using an external `"src"` is not yet supported):

```html
<script type="importmap">
{
  "imports": { ... },
  "scopes": { ... }
}
</script>
```

With the import map embedded in the page, all `import` statements will have access to the defined mappings
allowing direct `import 'lit/html.js'` style JS code in the browser.

For browsers without import maps, there are two recommended options:

1. Use the [ES Module Shims](https://github.com/guybedford/es-module-shims) import maps polyfill.
  This involves adding a script tag to load the polyfill before the import map to enable.

2. Use [SystemJS](https://github.com/systemjs/systemjs) to load System modules in older browsers.
  To generate a SystemJS import map, use the `'jspm.system'` `defaultProvider` option. Then include
  the SystemJS import map via a `<script type="systemjs-importmap">` tag with the System modules loaded via
  `<script type="systemjs-module>` or `System.import`. See the [SystemJS documentation](https://github.com/systemjs/systemjs)
  for further information on these workflows.

Dynamically injecting `<script type="importmap">` from JavaScript is supported as well but only if no
modules have yet executed on the page. For dynamic import map injection workflows, creating an IFrame
for each import map and injecting it into this frame can be used to get around this constraint for
in-page refreshing application workflows.

## API

### Package Configuration

Package exports configurations are taken from the package.json. When attempting to install or resolve a subpath of a package
that does not exist in its exports, an error will be thrown.

To recover from errors like this, JSPM and Skypack have mechanisms for overriding package configurations:

* [JSPM Overrides](https://github.com/jspm/overrides)
* [Skypack Definitely Exported](https://github.com/snowpackjs/DefinitelyExported)

Creating a PR to add custom exports overrides allows for fixing any package issues on the CDNs.

For more information on the package exports field see the [Node.js documentation](https://nodejs.org/dist/latest-v16.x/docs/api/packages.html#packages_package_entry_points).

### Logging

A logger is provided via `generator.logStream`:

```js
const generator = new Generator();

(async () => {
  for await (const { type, message } of generator.logStream()) {
    console.log(`${type}: ${message}`);
  }
})();
```

Log events recorded include `trace`, `resolve` and `install`.

Note that the log messages are for debugging and not currently part of the semver contract of the project.

### Options

* [mapURL](#mapUrl)
* [rootURL](#rootUrl)
* [resolutions](#resolutions)
* [inputMap](#inputMap)
* [ignore](#ignore)
* [ipfsAPI](#ipfsAPI)
* [defaultProvider](#defaultProvider)
* [providers](#providers)
* [customProviders](#customProviders)
* [env](#env)
* [cache](#caches)

#### mapUrl

> Type: URL | String Absolute URL | String URL relative to CWD<br/>
Default: pathTofileURL(process.cwd() + '/')<br/>
_The URL of the import map itself, used to construct relative import map URLs._

The `mapUrl` is used in order to output relative URLs for modules located on the same
host as the import map.

E.g. for `mapUrl: 'file:///path/to/project/map.importmap'`, installing local file packages
will be output as relative URLs to their file locations from the map location, since all URLs in an import
map are relative to the URL of the import map.

#### rootUrl

> Type: URL | String Absolute URL | String URL relative to CWD<br/>
Default: Empty<br/>
_The URL to treat as the root of the serving protocol of the import map, used to construct absolute import map URLs._

When set, `rootUrl` takes precendence over `mapUrl` and is used to normalize all import map URLs
as absolute paths against this URL.

E.g. for `rootUrl: 'file:///path/to/project/public'`, any local module `public/local/mod.js` within the `public` folder
will be normalized to `/local/mod.js` in the output map.

#### resolutions

> Type: Object | undefined</br>
Default: {}<br/>
_Custom dependency resolution overrides for all installs._

The resolutions option allows configuring a specific dependency version to always be used overriding all version resolution
logic for that dependency for all nestings.

It is a map from package name to package version target just like the package.json "dependencies" map, but that applies and overrides universally.

For example to lock a specific package version:

```js
const generator = new Generator({
  resolutions: {
    dep: '1.2.3'
  }
});
```

It is also useful for local monorepo patterns where all local packages should be located locally:

```js
const pkgBaseUrl = new URL('./packages', import.meta.url).href;

const generator = new Generator({
  resolutions: {
    '@company/pkgA': `${pkgBaseUrl}/pkgA`,
    '@company/pkgB': `${pkgBaseUrl}/pkgB`
    '@company/pkgC': `${pkgBaseUrl}/pkgC`
  }
})
```

All subpath and main resolution logic will follow the package.json definitions of the resolved package, unlike `inputMap`
which only maps specific specifiers.

#### inputMap

> Type: Object | undefined<br/>
Default: {}<br/>
_The import map to extend._

An initial import map to start with - can be from a previous install or provide custom mappings.

#### ignore

> Type: string[] | undefined<br/>
Default: []

Allows ignoring certain module specifiers during the tracing process.
It can be useful, for example, when you provide an `inputMap` that contains a mapping that can't be traced in current context,
but you know it will work in the context where the generated map is going to be used.

```js
const generator = new Generator({
  inputMap: {
      imports: {
          "react": "./my/own/react.js",
      }
  },
  ignore: ["react"]
});

// Even though `@react-three/fiber@7` depends upon `react`,
// `generator` will not try to trace and resolve `react`,
// so the mapping provided in `inputMap` will end up in the resulting import map. 
await generator.install("@react-three/fiber@7")
```

#### ipfsAPI

> Type: String | String[]</br/>
Default: ['/ip4/127.0.0.1/tcp/45005', '/ip4/127.0.0.1/tcp/5001']

When installing IPFS URLs, this configures the IPFS Node API multiaddress or list of fallback addresses to connect to.

Defaults to trying the Brave IPFS node then the local IPFS node. The API which can be enabled from brave://ipfs-internals/ in the Brave Browser.

#### defaultProvider

> Type: 'jspm' | 'jspm.system' | 'nodemodules' | 'skypack' | 'jsdelivr' | 'unpkg'<br/>
Default: 'jspm'<br/>
_The default provider to use for a new install. Providers are responsible for resolution from abstract package names and version ranges to exact URL locations._

Providers resolve package names and semver ranges to exact CDN package URL paths using provider hooks.

These hooks include version resolution and converting package versions into URLs and back again.

See `src/providers/[name].ts` for how to define a custom provider.

New providers can be provided via the `customProviders` option. PRs to merge in providers are welcome as well.

#### providers

> Type: Object | undefined<br/>
Default: {}<br/>
_A map of custom scoped providers._

The provider map allows setting custom providers for specific package names or package scopes.

For example, an organization with private packages with names like `npmpackage` and `@orgscope/...` can define the custom providers to reference these from a custom source:

```js
  providers: {
    'npmpackage': 'nodemodules',
    '@orgscope': 'nodemodules'
  }
```

Alternatively a custom provider can be referenced this way for eg private CDN / registry support.

#### customProviders

> Type: Object | undefined<br/>
Default: undefined</br>
_Custom provider definitions._

When installing from a custom CDN it can be advisable to define a custom provider in order to be able to get version deduping against that CDN.

Custom provider definitions define a provider name, and the provider instance consisting of three main hooks:

* `pkgToUrl({ registry: string, name: string, version: string }, layer: string) -> String URL`: Returns the URL for a given exact package registry, name and version to use for this provider. If the provider is using layers, the `layer` string can be used to determine the URL layer (where the `defaultProvider: '[name].[layer]'` form is used to determine the layer, eg minified v unminified etc). It is important that package URLs always end in `/`, because packages must be treated as folders not files. An error will be thrown for package URLs returned not ending in `/`.
* `parsePkgUrl(url: string) -> { { registry: string, name: string, version: string }, layer: string } | undefined`: Defines the converse operation to `pkgToUrl`, converting back from a string URL
into the exact package registry, name and version, as well as the layer. Should always return `undefined` for unknown URLs as the first matching provider is treated as authoritative when dealing with
multi-provider installations.
* `resolveLatestTarget(target: { registry: string, name: string, range: SemverRange }, unstable: boolean, layer: string, parentUrl: string) -> Promise<{ registry: string, name: string, version: string } | null>`: Resolve the latest version to use for a given package target. `unstable` indicates that prerelease versions can be matched. The definition of `SemverRange` is as per the [sver package](https://www.npmjs.com/package/sver#semverrange). Returning `null` corresponds to a package not found error.

The use of `pkgToUrl` and `parsePkgUrl` is what allows the JSPM Generator to dedupe package versions internally based on their unique internal identifier `[registry]:[name]@[version]` regardless of what CDN location is used. URLs that do not support `parsePkgUrl` can still be installed and used fine, they just do not participate in version deduping operations.

For example, a custom unpkg provider can be defined as:

```js
const unpkgUrl = 'https://unpkg.com/';
const exactPkgRegEx = /^((?:@[^/\\%@]+\/)?[^./\\%@][^/\\%@]*)@([^\/]+)(\/.*)?$/;

const generator = new Generator({
  defaultProvider: 'custom',
  customProviders: {
    custom: {
      pkgToUrl ({ registry, name, version }) {
        return `${unpkgUrl}${name}@${version}/`;
      },
      parseUrlPkg (url) {
        if (url.startsWith(unpkgUrl)) {
          const [, name, version] = url.slice(unpkgUrl.length).match(exactPkgRegEx) || [];
          return { registry: 'npm', name, version };
        }
      },
      resolveLatestTarget ({ registry, name, range }, unstable, layer, parentUrl) {
        return { registry, name, version: '3.6.0' };
      }
    }
  }
});

await generator.install('custom:jquery');
```

#### env

> Type: String[]<br/>
Default: ['browser', 'development', 'module']<br/>
_The conditional environment resolutions to apply._

The conditions passed to the `env` option are environment conditions, as [supported by Node.js](https://nodejs.org/dist/latest-v16.x/docs/api/packages.html#packages_conditions_definitions) in the package exports field.

By default the `"default"`, `"require"` and `"import"` conditions are always supported regardless of what `env` conditions are provided.

In addition the default conditions applied if no `env` option is set are `"browser"`, `"development"` and `"module"`.

Webpack and RollupJS support a custom `"module"` condition as a bundler-specific solution to the [dual package hazard](https://nodejs.org/dist/latest-v16.x/docs/api/packages.html#packages_dual_package_hazard), which is by default included in the JSPM resolution as well although
can be turned off if needed.

Note when providing custom conditions like setting `env: ["production"]` that the `"browser"` and `"module"` conditions still need to be
applied as well via `env: ["production", "browser", "module"]`. Ordering does not matter though.

Any other custom condition strings can also be provided.

#### cache

> Type: Boolean | String<br/>
Default: true<br/>
_Whether to use a local FS cache for fetched modules. Set to 'offline' to use the offline cache._

By default a global fetch cache is maintained between runs on the file system.

This caching can be disabled by setting `cache: false`.

When running offline, setting `cache: 'offline'` will only use the local cache and not touch the network at all,
making fully offline workflows possible provided the modules have been seen before.

### Utility Functions

The following utility functions are exported as additional exports of the generator:

#### clearCache

_Supports clearing the global fetch cache in Node.js._

Example:

```js
import { clearCache } from '@jspm/generator';
clearCache();
```

#### fetch

_Use the internal fetch implementation, useful for hooking into the same shared local fetch cache._

```js
import { fetch } from '@jspm/generator';

const res = await fetch(url);
console.log(await res.text());
```

Use the `{ cache: 'no-store' }` option to disable the cache, and the `{ cache: 'force-cache' }` option to enforce the offline cache.

#### getPackageConfig

_Get the package.json configuration for a specific URL or package._

```js
import { getPackageConfig } from '@jspm/generator';

// Supports a resolved package
{
  const packageJson = await getPackageConfig({ registry: 'npm', name: 'lit-element', version: '2.5.1' });
}

// Or alternatively provide any URL
{
  const packageJson = await getPackageConfig('https://ga.jspm.io/npm:lit-element@2.5.1/lit-element.js');
}
```

#### lookup

_Get the lookup resolution information for a specific install._

Example:

```js
import { lookup } from '@jspm/generator';

await lookup('lit-element');
/*
{
  install: {
    target: { registry: 'npm', name: 'lit-element', range: '^2.0' },
    subpath: '.',
    alias: 'lit-element'
  },
  resolved: { registry: 'npm', name: 'lit-element', version: '2.5.1' }
}
*/

// The "resolved" property can also be passed directly to getPackageConfig
```

## Contributing

**All pull requests welcome!**

### License

MIT
