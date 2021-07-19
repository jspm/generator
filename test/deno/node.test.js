import { Generator } from '@jspm/generator';
import { denoExec } from '#test/deno';

const generator = new Generator({
  mapUrl: 'about:blank',
  stdlib: new URL('../../jspm-core/', import.meta.url),
  env: ['production', 'node', 'deno', 'module']
});

// mocha 9 uses supports-color which assumes the "process" global
await generator.install('mocha@8');

await denoExec(generator.getMap(), `
  import mocha from 'mocha';

  console.log(mocha);
`);
