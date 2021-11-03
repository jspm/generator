import { Generator } from '@jspm/generator';
import assert from 'assert';

const generator = new Generator({
  mapUrl: import.meta.url,
  defaultProvider: 'jspm',
  env: ['production', 'browser'],
  resolutions: {
    dep: new URL('./local/dep/', import.meta.url).href
  }
});

await generator.install({ target: './local/pkg', subpath: './withdep' });
const json = generator.getMap();

assert.strictEqual(json.scopes['./'].dep, './local/dep/main.js');
