import { Generator } from '@jspm/generator';
import assert from 'assert';

const generator = new Generator({
  mapUrl: import.meta.url,
  env: ['production', 'browser']
});

try {
  await generator.install('@elliemae/ds-icons@1.53.3-rc.0');
  throw new Error('Install should have errorred');
}
catch (err) {
  assert.ok(err.message.includes('with error'))
}
