import { Generator } from '@jspm/generator';
import assert from 'assert';

const generator = new Generator({
  mapUrl: import.meta.url,
  defaultProvider: 'jspm',
  env: ['production', 'browser']
});

await generator.install('react@16');
const json = generator.getMap();
assert.strictEqual(json.imports.react, 'https://ga.jspm.io/npm:react@16.14.0/index.js');

const map = generator.getMapInstance();
assert.strictEqual(map.resolve('react'), 'https://ga.jspm.io/npm:react@16.14.0/index.js');
