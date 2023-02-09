import { Generator } from '@jspm/generator';
import assert from 'assert';

// TODO(bubblyworld): This test should be failing, as the current version of
// @jspm/generator is >1.0.0 and therefore local source files should not be
// linked by the generator here.

const generator = new Generator({
  mapUrl: import.meta.url,
  env: ['source']
});

const { staticDeps, dynamicDeps } = await generator.install('@jspm/generator@1.0.0-beta.13');

assert.ok(staticDeps.length < 50);
assert.ok(dynamicDeps.length > 100);

const json = generator.getMap();

assert.strictEqual(json.imports['@jspm/generator'], '../../lib/generator.js');
assert.strictEqual(json.scopes['../../']['#fetch'], '../../lib/common/fetch-native.js');
assert.strictEqual(json.scopes['https://ga.jspm.io/']['semver'], 'https://ga.jspm.io/npm:semver@6.3.0/semver.js');
