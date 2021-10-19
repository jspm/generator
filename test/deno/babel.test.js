import { Generator } from '@jspm/generator';
import { denoExec } from '#test/deno.js';

const generator = new Generator({
  env: ['node', 'deno'],
  stdlib: '@jspm/core@2.0.0-beta.10' // Pending https://github.com/babel/babel/issues/13863
});

await generator.install('@babel/core@7.15.0');
await generator.install('assert');

const map = generator.getMap();

await denoExec(map, `
  import babel from '@babel/core';
  import assert from 'assert';

  const { code } = babel.transform('var p = 5');
  assert.strictEqual(code, 'var p = 5;');
`);
