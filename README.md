# JSPM Generator

Package Import Map Generation Tool

For an interactive UI for this tool running on JSPM.IO, see `https://generator.jspm.io`.

### Usage

Try it out in the JSPM sandbox [here](), (running with its own generated import map on JSPM).

```
npm install @jspm/generator
```

`@jspm/generator` only ships as an ES module, so to use it in Node.js add `"type": "module"` to your package.json file
or write an `.mjs` to load it:

generate.mjs
```js
import { Generator } from '@jspm/generator';

const generator = new Generator({
  mapUrl: import.meta.url,
  defaultProvider: 'jspm',
  env: ['production', 'browser']
});

// install a new package into the import map
await generator.install('react');

// install a package to a custom alias
await generator.install({ alias: 'custom', target: 'react@16' });

// install a specific subpath of a package
await generator.install({ target: 'lit', subpath: './html.js' });

// Outputs the import map with "imports" entries for "react" and "custom",
// And "scopes" entries for "react-dom", the dependencies of "custom", and the dependencies of app.js
JSON.stringify(generator.getMap(), null, 2);
```

Like a file-system-based package manager, JSPM will dedupe dependencies in the import map and resolve version
ranges to enable maximum code sharing.

### API

// TODO: fill this out

### Providers

Providers resolve package names and semver ranges to exact CDN package URL paths.

Supported providers include "jspm", "skypack", "jsdelivr", "unpkg".

New providers can be merged in via PRs and custom provider configuration will be provided soon.

## Contributing

**All pull requests welcome!**

### License

MIT
