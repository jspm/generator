# JSPM Generator

Package Import Map Generation Tool

For an interactive UI for this tool running on JSPM.IO, see [https://generator.jspm.io](https://generator.jspm.io).

### Usage

```
npm install @jspm/generator
```

`@jspm/generator` only ships as an ES module, so to use it in Node.js add `"type": "module"` to your package.json file
or write an `.mjs` to load it:

generate.mjs
```js
import { Generator } from '@jspm/generator';

const generator = new Generator({
  /*
   * Default: process.cwd() + '/'
   * 
   * The URL of the import map itself
   * 
   * This is used in order to output relative URLs for modules located on the same
   * host as the import map.
   * (Eg for `file:///path/to/project/map.importmap`, installing local file packages will
   * be output as relative URLs to the import map location supporting any host)
   */  
  mapUrl: import.meta.url,

  /*
   * Default: 'jspm'
   * Supported: 'jspm', 'jspm.system', 'skypack', 'jsdelivr', 'unpkg'.
   */
  defaultProvider: 'jspm',

  /*
   * Default: ['development', 'browser']
   * 
   * The conditional environment resolutions to apply.
   * 
   * See https://nodejs.org/dist/latest-v16.x/docs/api/packages.html#packages_conditional_exports
   * for more info
   */
  env: ['production', 'browser'],

  /*
   * Default: true
   *
   * Whether to use a local FS cache for fetched modules
   * Set to 'offline' to use the offline cache
   */
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

// Pass an array to install to install multiple packages at the same time
await generator.install([{ target: 'react' }, { target: 'lit' }]);

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

### Package Configuration

Package exports configurations are taken from the package.json. When attempting to install or resolve a subpath of a package
that does not exist in its exports, an error will be thrown.

To recover from errors like this, JSPM and Skypack have mechanisms for overriding package configurations:

* [JSPM Overrides](https://github.com/jspm/overrides)
* [Skypack Definitely Exported](https://github.com/snowpackjs/DefinitelyExported)

Creating a PR to add custom exports overrides allows for fixing any package issues on the CDNs.

For more information on the package exports field see the [Node.js documentation](https://nodejs.org/dist/latest-v16.x/docs/api/packages.html#packages_package_entry_points).

### Environment Conditions

The conditions passed to the `env` option are environment conditions, as [supported by Node.js](https://nodejs.org/dist/latest-v16.x/docs/api/packages.html#packages_conditions_definitions) in the package exports field.

By default the `"default"`, `"require"` and `"import"` conditions are always supported regardless of what `env` conditions are provided.

Webpack and RollupJS support a custom `"module"` condition as a bundler-specific solution to the [dual package hazard](https://nodejs.org/dist/latest-v16.x/docs/api/packages.html#packages_dual_package_hazard).

In cases where you find there are CommonJS and ESM variants of the same package being included, and resolving a `"module"` condition
would avoid this, this can be set for example via `"env": ["module", "browser", "development"]`.

Any other custom condition strings can also be provided.

### Caching

By default a global fetch cache is maintained between runs on the file system.

This caching can be disabled by setting `cache: false`.

When running offline, setting `cache: 'offline'` will only use the local cache and not touch the network at all,
making fully offline workflows possible provided the modules have been seen before.

To clear the global cache, a `clearCache` function is also exported:

```js
import { clearCache } from '@jspm/generator';
clearCache();
```

### Logging

A logger is provided via:

```js
import { logStream } from '@jspm/generator';
(async () => {
  for await (const { type, message } of logStream()) {
    console.log(`${type}: ${message}`);
  }
})();
```

Log events recorded include `trace`, `resolve` and `install`.

Note that the log messages are for debugging and not currently part of the semver contract of the project.

### Providers

Providers resolve package names and semver ranges to exact CDN package URL paths using provider hooks.

These hooks include version resolution and converting package versions into URLs and back again.

See `src/providers/[name].ts` for how to define a custom provider.

Supported providers include "jspm", "jspm.system", "skypack", "jsdelivr", "unpkg".

New providers can be merged in via PRs.

## Contributing

**All pull requests welcome!**

### License

MIT
