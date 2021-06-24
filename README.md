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
  "imports": {
    "@jspm/generator": "https://ga.jspm.io/npm:@jspm/generator@1.0.0-beta.3/dist/generator.js",
    "es-module-lexer": "https://ga.jspm.io/npm:es-module-lexer@0.4.1/dist/lexer.cjs",
    "sver": "https://ga.jspm.io/npm:sver@1.8.3/sver.js",
    "sver/convert-range.js": "https://ga.jspm.io/npm:sver@1.8.3/convert-range.js"
  },
  "scopes": {
    "https://ga.jspm.io/": {
      "buffer": "https://ga.jspm.io/npm:@jspm/core@2.0.0-beta.7/nodelibs/buffer.js",
      "process": "https://ga.jspm.io/npm:@jspm/core@2.0.0-beta.7/nodelibs/process.js",
      "semver": "https://ga.jspm.io/npm:semver@6.3.0/semver.js"
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
  defaultProvider: 'jspm',
  env: ['production', 'browser'],
  cache: false,
});

// Install a new package into the import map
await generator.install('react');

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
 *     "react": "https://ga.jspm.io/npm:react@17.0.2/index.js",
 *     "react16": "https://ga.jspm.io/npm:react@16.14.0/index.js"
 *   },
 *   "scopes": { ... }
 * }
 */
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

#### defaultProvider

> Type: 'jspm' | 'jspm.system' | 'nodemodules' | 'skypack' | 'jsdelivr' | 'unpkg'<br/>
Default: 'jspm'<br/>
_The default provider to use for a new install. Providers are responsible for resolution from abstract package names and version ranges to exact URL locations._

Providers resolve package names and semver ranges to exact CDN package URL paths using provider hooks.

These hooks include version resolution and converting package versions into URLs and back again.

See `src/providers/[name].ts` for how to define a custom provider.

New providers can be merged in via PRs.

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
