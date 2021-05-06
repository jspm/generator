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
  env: ['production', 'browser']
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

### Providers

Providers resolve package names and semver ranges to exact CDN package URL paths using provider hooks.

These hooks include version resolution and converting package versions into URLs and back again.

See `src/providers/[name].ts` for how to define a custom provider.

Supported providers include "jspm", "skypack", "jsdelivr", "unpkg".

New providers can be merged in via PRs.

## Contributing

**All pull requests welcome!**

### License

MIT
