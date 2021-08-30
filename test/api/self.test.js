import { Generator } from '@jspm/generator';
import assert from 'assert';

const generator = new Generator({
  mapUrl: import.meta.url
});

const { staticDeps, dynamicDeps } = await generator.install('@jspm/generator');

assert.strictEqual(staticDeps.length, 106);
assert.strictEqual(dynamicDeps.length, 0);

const json = generator.getMap();

assert.strictEqual(json.imports['@jspm/generator'], '../../dist/generator.js');
assert.strictEqual(json.scopes['../../']['#fetch'], '../../dist/fetch-native.js');
assert.strictEqual(json.scopes['https://ga.jspm.io/']['semver'], 'https://ga.jspm.io/npm:semver@6.3.0/semver.js');
