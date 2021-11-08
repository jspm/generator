import { Generator } from '@jspm/generator';
import assert from 'assert';

const generator = new Generator({
  baseUrl: new URL('../', import.meta.url),
  mapUrl: import.meta.url,
  defaultProvider: 'jspm',
  env: ['production', 'browser'],
  resolutions: {
    dep: './api/local/dep/'
  }
});

await generator.install({ target: './api/local/pkg', subpath: './withdep' });
const json = generator.getMap();

assert.strictEqual(json.scopes['./'].dep, './local/dep/main.js');
