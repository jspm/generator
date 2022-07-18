import { Generator } from '@jspm/generator';
import assert from 'assert';

const generator = new Generator({
  mapUrl: import.meta.url,
  defaultProvider: 'jspm',
  env: ['production', 'browser']
});

await generator.traceInstall('./local/pkg/b.js');

const json = generator.getMap();
assert.strictEqual(json.scopes['./local/pkg/'].dep, './local/dep/main.js');
