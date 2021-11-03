import { Generator } from '@jspm/generator';
import assert from 'assert';

const generator = new Generator({
  mapUrl: import.meta.url,
  env: ['production', 'browser'],
  resolutions: {
    'source-map': '0.5.6'
  }
});

await generator.install('@babel/core');
const json = generator.getMap();

assert.ok(json.imports['@babel/core']);
assert.ok(Object.keys(json.scopes['https://ga.jspm.io/']).length > 20);
assert.ok(json.scopes['https://ga.jspm.io/']['source-map'].includes('0.5.6'));
