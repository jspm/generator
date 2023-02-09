import { Generator } from '@jspm/generator';
import assert from 'assert';

// Mimic calling the generator from the ./local/pkg package:
const mapUrl = new URL('./local/pkg/importmap.json', import.meta.url).href;
console.log(mapUrl);

let generator = new Generator({
  mapUrl,
  defaultProvider: 'jspm',
  env: ['production', 'browser']
});

// Installing the package from within itself should resolve locally, since the
// package.json has a local export for ".":
await generator.traceInstall('localpkg');
let json = generator.getMap();
assert.strictEqual(json.imports['localpkg'], './index.js');

// Uninstalling using the same generator instance should remove the install 
// entirely and return an empty map:
await generator.uninstall('localpkg');
assert.ok(!generator.getMap().imports);

// Uninstalling using a new generator instance should _also_ remove the install
// from the import map, i.e. the generator should be able to reconstruct the
// context given just an input map:
generator = new Generator({
  mapUrl,
  defaultProvider: 'jspm',
  env: ['production', 'browser'],
  inputMap: json,
});

// Uninstalling the package should get rid of it:
await generator.uninstall('localpkg');
json = generator.getMap();
assert.ok(!json.imports);
