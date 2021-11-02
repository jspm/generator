import { Generator } from '@jspm/generator';
import assert from 'assert';

const generator = new Generator({
  mapUrl: import.meta.url,
  defaultProvider: 'jspm',
  env: ['production', 'browser']
});

await generator.install({ target: './local/pkg', subpath: './withdep2' });
const json = generator.getMap();
assert.strictEqual(json.imports['localpkg/withdep2'], './local/pkg/c.js');
assert.strictEqual(json.scopes['./'].dep2, './local/dep/main.js');
