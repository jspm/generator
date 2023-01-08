import { Generator } from '@jspm/generator';
import assert from 'assert';

const generator = new Generator({
  mapUrl: import.meta.url,
  defaultProvider: 'esm',
  env: ['production', 'browser']
});

await generator.install('react@16');
const json = generator.getMap();
assert.strictEqual(json.imports.react, 'https://esm.sh/react@16.14.0/index.js');
