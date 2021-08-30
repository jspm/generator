import { clearCache, Generator } from '@jspm/generator';
import { denoExec } from '#test/deno';

// clearCache();

const generator = new Generator({
  env: ['node', 'deno']
});

await generator.install('@babel/core@7.14.5');

const map = generator.getMap();

await denoExec(map, `
  import babel from '@babel/core';

  console.log(babel.transform('var p = 5'));
`);
