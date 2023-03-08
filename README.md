<div align="center">
  <img style="display: inline-block; width: 100px; height: 100pz" src="./logo.png"/>
  <h1 style="display: inline-block">JSPM Generator</h1>
</div>

[**JSPM Generator**](https://www.npmjs.com/package/@jspm/generator) is the core library of the [JSPM project](https://jspm.org) for managing and linking the dependencies of JavaScript modules using [**import maps**](https://github.com/WICG/import-maps), constructing the correct linkage via the import map to execute any graph of modules in a given environment, including the browser and host runtimes like Node.js or [Deno](https://deno.land).

JSPM Generator handles all aspects of managing and creating import maps by tracing out the dependency graph of your code using [JSPM module resolution rules](docs/RESOLUTION.md), based on an extension of the Node.js resolution to _all URLs_.

Supports various common scenarios with import map generation including:

* **Local Linking:** map packages to your local `node_modules` folder
* [**Common CDNs:**](https://github.com/jspm/generator#defaultProvider) resolve against [jspm.io](https://jspm.io/), [UNPKG](https://unpkg.com/), [Skypack](https://www.skypack.dev/), [jsDelivr](https://jsdelivr.com) and [more](#customProviders)
* [**Conditional Resolution:**](https://nodejs.org/dist/latest-v19.x/docs/api/packages.html#conditional-exports) map different versions of a module based on environment
* [**Dependency Versioning:**](https://docs.npmjs.com/specifying-dependencies-and-devdependencies-in-a-package-json-file) respects the version constraints in your `package.json`
* [**Package Entrypoints:**](https://nodejs.org/dist/latest-v19.x/docs/api/packages.html#package-entry-points) handles node-style package exports, imports and own-name resolution

For a CLI-based tool, see [jspm/jspm](https://github.com/jspm/jspm).
<br>
For a web-based UI, see [https://generator.jspm.io](https://generator.jspm.io).

## Getting Started

This is a guide to basic usage. If you prefer details, see the [API documentation](docs/API.md) instead.

### Installation

* **Node.js:**
```
npm install @jspm/generator
```

Note that `@jspm/generator` only ships as [ESM](https://nodejs.org/dist/latest-v19.x/docs/api/esm.html), so to use it in Node.js you will either have to add `"type": "module"` to your `package.json`, or add a `.mjs` extension to the importing file. See the [Node.js documentation](https://nodejs.org/dist/latest-v19.x/docs/api/esm.html#enabling) for details.


* **Deno / Browser:**

You can get an import map for `@jspm/generator` [here](https://generator.jspm.io/#U2NhYGBkDM0rySzJSU1hcMgqLsjVT0/NSy1KLMkvcjDUM9AzBgB0jFHUJAA). Alternatively, you can generate one yourself using the [online tool](https://generator.jspm.io) or the [CLI](https://github.com/jspm/jspm).

### Generating Import Maps

A minimal example of creating an input map from scratch is:

```js
import { Generator } from '@jspm/generator';

const generator = new Generator({
  // The URL of the import map, for normalising relative URLs:
  mapUrl: import.meta.url,
  
  // The default CDN to use for external package resolutions:
  defaultProvider: 'jspm',
  
  // The environment(s) to target. Note that JSPM will use these to resolve
  // conditional exports in any package it encounters:
  env: ['production', 'browser', 'module'],
});

// Install the main entry point of the latest version of a package:
await generator.install('react-dom');

// Install a particular entry point of a package:
await generator.install('lit@2/decorators.js');
await generator.install({ target: 'lit@2', subpath: './html.js' });

// Install to a custom alias:
await generator.install({ target: 'react@16', alias: 'react16' });

// Install from a local package:
await generator.install({
  target: './packages/local-pkg',
  alias: 'mypkg'
  subpath: './feature',
});

// Output the import map:
console.log(JSON.stringify(generator.getMap(), null, 2));
```
```json
{
  "imports": {
    "lit/decorators.js": "https://ga.jspm.io/npm:lit@2.0.0-rc.1/decorators.js",
    "lit/html.js": "https://ga.jspm.io/npm:lit@2.0.0-rc.1/html.js",
    "mypkg/feature": "./packages/local-pkg/feature.js",
    "react": "./local/react.js",
    "react16": "https://ga.jspm.io/npm:react@16.14.0/index.js",
  },
  "scopes": { ... }
}
```

### Tracing and Installing Dependencies

The `generator.install` function can be used to install a package (along with its secondary dependencies) into an import map. By default, version constraints are taken from the `package.json` of the import map's parent package. If no constraints are found, the generator will look up the latest available version of the package:

```js
import { Generator } from "@jspm/generator";

const generator = new Generator({
  mapUrl: import.meta.url,
  env: ['production', 'module', 'browser'],
});

await generator.install('react');
console.log(JSON.stringify(generator.getMap(), null, 2));
```
```json
{
  "imports": {
    "lit": "https://ga.jspm.io/npm:lit@2.6.1/index.js"
  },
  "scopes": { ... }
}
```

In some cases you may have a particular module you want to run, such as your application's entry point, and you want to trace and install _all_ of the dependencies of that module. This can be done using the `generator.traceInstall` function:

```js
// file: ./mapping.js
import * as lit from 'lit';
```

```js
// file: generate.js
import { Generator } from "@jspm/generator";

const generator = new Generator({
  mapUrl: import.meta.url,
  env: ['production', 'module', 'browser'],
});

await generator.traceInstall('./mapping.js');
console.log(JSON.stringify(generator.getMap(), null, 2));
```
```json
{
  "imports": {
    "lit": "https://ga.jspm.io/npm:lit@2.6.1/index.js"
  },
  "scopes": { ... }
}
```

### Working with Existing Import Maps

An import map can be passed to the generator with the `inputMap` option, which will be used as the starting point for any further operations. This allows you to add, upgrade or remove dependencies from an existing import map, enabling an iterative workflow:

```js
const generator = new Generator({
  env: ['production', 'module', 'browser'],
  inputMap: {
    "imports": {
      "react": "https://ga.jspm.io/npm:react@17.0.1/dev.index.js"
    },
    "scopes": {
      "https://ga.jspm.io/": {
        "object-assign": "https://ga.jspm.io/npm:object-assign@4.1.0/index.js"
      }
    }
  }
});

await generator.install('lit');
console.log(JSON.stringify(generator.getMap(), null, 2));
```
```json
{
  "imports": {
    "lit": "https://ga.jspm.io/npm:lit@2.2.7/index.js",
    "react": "https://ga.jspm.io/npm:react@17.0.1/index.js"
  },
  "scopes": { ... }
}
```

The generator treats all primary dependencies (the `"imports"`) as _locked_, meaning they will not be upgraded or removed by any operation unless you either:
1. Explicitly request a change by running an operation against that dependency.
2. Change the environment(s) targeted by the generator (e.g. going from 'development' to 'production').

Any secondary dependencies (the `"scopes"`) will be upgraded or pruned as necessary to satisfy the primary dependencies. To reinstall all of the secondary dependencies (if you made manual changes, for instance), you can can run `generator.install` with no arguments:

```js
const generator = new Generator({
  env: ['production', 'module', 'browser'],
  inputMap: {
    "imports": {
      "react": "https://ga.jspm.io/npm:react@17.0.0/dev.index.js"
    }
  }
});

await generator.install();
console.log(JSON.stringify(generator.getMap(), null, 2));
```
```json
{
  imports: {
    react: 'https://ga.jspm.io/npm:react@17.0.0/index.js'
  },
  scopes: {
    'https://ga.jspm.io/': {
      'object-assign': 'https://ga.jspm.io/npm:object-assign@4.1.1/index.js'
    }
  }
}
```

To update primary dependencies, you can use `jspm.update`. By default, version constraints are taken from the `package.json` of the import map's parent package. If no constraints are found, the generator will fall back to bumping the _minor_ version of the dependency to latest:


```js
const generator = new Generator({
  env: ['production', 'module', 'browser'],
  inputMap: {
    "imports": {
      "react": "https://ga.jspm.io/npm:react@17.0.0/dev.index.js"
    }
  }
});

// Use generator.update() with no arguments to update all primary dependencies.
await generator.update('react');
console.log(generator.getMap());
```
```json
{
  imports: {
    react: 'https://ga.jspm.io/npm:react@17.0.2/index.js'
  },
  scopes: {
    'https://ga.jspm.io/': {
      'object-assign': 'https://ga.jspm.io/npm:object-assign@4.1.1/index.js'
    }
  }
}
```

### Mapping Locally Against `node_modules`

If you have an existing Node.js ESM project, you can use the generator's `nodemodules` provider to map packages to your `node_modules` folder instead of using an external CDN. This is useful for offline development:

```js
import { Generator } from '@jspm/generator';

const generator = new Generator({
  mapUrl: import.meta.url,
  env: ['production', 'browser', 'module'],
  defaultProvider: 'nodemodules',
});

// Assuming you have run 'npm install lit' in the same directory already:
await generator.install('lit');
console.log(JSON.stringify(generator.getMap(), null, 2));
```
```json
{
  "imports": {
    "lit": "./node_modules/lit/index.js"
  },
  "scopes": { ... }
}
```

### Using an Import Map

In order to actually _use_ an import map in an HTML page, the import map must be included as follows:

```html
<script type="importmap">
{
  "imports": { ... },
  "scopes": { ... }
}
</script>
```

With the import map embedded in this way, all javascript `import` statements executed by that page will have access to the defined mappings. This enables the use of bare-specifier imports, such as `import 'lit/html.js'` or `import 'react'`, directly in the browser!

Dynamically injecting `<script type="importmap">` tags using JavaScript will also work, provided that no modules try to use an import mapping before the injection occurs. For dynamic import map injection, creating an IFrame for each map and injecting the maps into these frames can be used as a work-around.

To target browsers without import map support, we recommend the [ES Module Shims](https://github.com/guybedford/es-module-shims) polyfill. This is a highly optimized polyfill with near-native performance - see the [performance benchmarks](https://github.com/guybedford/es-module-shims/blob/main/bench/README.md).

### Working Directly with HTML

Instead of manually adding import maps to your page, you can use `generator.htmlInject` to trace the inline modules in an HTML file and inject an import map back into it:

```js
import { generator } from '@jspm/generator';

const generator = new generator({
  mapurl: import.meta.url,
  env: ['production', 'browser', 'module'],
});

console.log(await generator.htmlinject(`
  <!doctype html>
  <script type="module">import 'react'</script>
`, {
  trace: true,
  esmoduleshims: true
  
}));
```
```html
<!doctype html>
<!-- generated by @jspm/generator - https://github.com/jspm/generator -->
<script async src="https://ga.jspm.io/npm:es-module-shims@1.6.3/dist/es-module-shims.js" crossorigin="anonymous"></script>
<script type="importmap">
{
  "imports": {
    "react": "https://ga.jspm.io/npm:react@18.2.0/index.js"
  }
}
</script>
<script type="module">import 'react'</script>
```

### Module Preloading and Integrity

The `generator.htmlInject` function supports injecting module preload tags, as well as integrity attributes for the modules. Preload tags ensure that all of your module dependencies are loaded up front, preventing additional round trips to the server, and integrity attributes prevent your modules from being tampered with in-transit:

```js
import { Generator } from '@jspm/generator';

const generator = new Generator({
  mapUrl: import.meta.url,
  env: ['production', 'browser', 'module'],
  inputMap: {
    imports: {
      react: "https://ga.jspm.io/npm:react@18.2.0/index.js",
    }
  },
});

console.log(await generator.htmlInject(`<!doctype html>`, {
  esModuleShims: true,
  integrity: true,
  preload: true,
}));
```
```html
<!doctype html><!-- Generated by @jspm/generator - https://github.com/jspm/generator -->
<script async src="https://ga.jspm.io/npm:es-module-shims@1.6.3/dist/es-module-shims.js" crossorigin="anonymous" integrity="sha384-R+gcUA3XvOcqevJ058aqe2+i0fMjGxEgXlstX2GcuHSwkr03d6+GPKDBbCTlt9pt"></script>
<script type="importmap">
{
  "imports": {
    "react": "https://ga.jspm.io/npm:react@18.2.0/index.js"
  }
}
</script>
<link rel="modulepreload" href="https://ga.jspm.io/npm:react@18.2.0/index.js" integrity="sha384-i6bD4Fz1JxnWeeJ6W+zAMk/LgkWeHJ/B+22ykUkjaKgPupuM4UDtOU/2bSE8sEyC" />
```

The `generator.htmlInject` function supports injecting module preload tags, as well as integrity attributes for the modules. Preload tags ensure that all of your module dependencies are loaded up front, preventing additional round trips to the server, and integrity attributes prevent your modules from being tampered with in-transit:

```js
import { Generator } from '@jspm/generator';

const generator = new Generator({
  mapUrl: import.meta.url,
  env: ['production', 'browser', 'module'],
  inputMap: {
    imports: {
      react: "https://ga.jspm.io/npm:react@18.2.0/index.js",
    }
  },
});

console.log(await generator.htmlInject(`<!doctype html>`, {
  esModuleShims: true,
  integrity: true,
  preload: true,
}));
```
```html
<!doctype html><!-- Generated by @jspm/generator - https://github.com/jspm/generator -->
<script async src="https://ga.jspm.io/npm:es-module-shims@1.6.3/dist/es-module-shims.js" crossorigin="anonymous" integrity="sha384-R+gcUA3XvOcqevJ058aqe2+i0fMjGxEgXlstX2GcuHSwkr03d6+GPKDBbCTlt9pt"></script>
<script type="importmap">
{
  "imports": {
    "react": "https://ga.jspm.io/npm:react@18.2.0/index.js"
  }
}
</script>
<link rel="modulepreload" href="https://ga.jspm.io/npm:react@18.2.0/index.js" integrity="sha384-i6bD4Fz1JxnWeeJ6W+zAMk/LgkWeHJ/B+22ykUkjaKgPupuM4UDtOU/2bSE8sEyC" />
```

### Using a Different CDN

Package resolution in JSPM is handled using the concept of a [provider](./docs/interfaces/GeneratorOptions.md#defaultprovider), which is something that knows how to translate between versioned packages and URLs. The list of providers that are supported by the generator out-of-the-box is:

* `"jspm.io"` - The **default provider**, resolves to the `jspm.io` CDN.
* `"nodemodules"` - For **local workflows**, resolves to the local `node_modules` folder.
* `"jspm.io#system"` - Resolves to the `jspm.io`, but with the SystemJS module format.
* `"skypack"` - Resolves to the Skypack CDN.
* `"jsdelivr"` - Resolves to the jsDelivr CDN.
* `"unpkg"` - Resolves to the unpkg CDN.
* `"deno"` - Resolves to the Deno CDN.
* `"denoland"` - Resolves to the Deno CDN.

Unlike the other providers, which simply hook into their respective external CDNs, the `"nodemodules"` provider does an NPM-style `node_modules` search from the current module URL. This is typically a `file:///` URL when generating import maps for local modules, but other protocols are supported too so long as directory listing requests for `node_modules` are permitted (this is the case for most local development server tools).

The `"jspm.io#system"` provider can be used to generate import maps for [SystemJS](https://github.com/systemjs/systemjs), with resolutions that behave identically to those of the `"jspm"` provider, but which fully support older browsers using the SystemJS module format.

## API

See the [API documentation](./docs/API.md).

## Contributing

**All pull requests welcome!**

## License

MIT
