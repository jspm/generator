import { Generator } from '@jspm/generator';
import assert from 'assert';

const generator = new Generator({
  mapUrl: import.meta.url,
  env: ['source']
});

const { staticDeps, dynamicDeps } = await generator.install('@jspm/generator@1.0.0-beta.13');

assert.ok(staticDeps.length > 150);
assert.strictEqual(dynamicDeps.length, 0);

const json = generator.getMap();

assert.strictEqual(json.imports['@jspm/generator'], '../../lib/generator.js');
assert.strictEqual(json.scopes['../../']['#fetch'], '../../lib/common/fetch-native.js');
assert.strictEqual(json.scopes['https://ga.jspm.io/']['semver'], 'https://ga.jspm.io/npm:semver@6.3.0/semver.js');
