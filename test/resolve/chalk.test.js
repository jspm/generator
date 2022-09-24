import { Generator } from '@jspm/generator';
import assert from 'assert';

if (typeof document === 'undefined') {
  const generator = new Generator({
    mapUrl: import.meta.url,
    defaultProvider: 'nodemodules'
  });

  await generator.install('chalk');

  const json = generator.getMap();

  assert.equal(Object.keys(json.imports).length, 5);
  assert.equal(Object.keys(json.scopes['../../node_modules/']).length, 4);
}
