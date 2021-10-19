import { Generator } from '@jspm/generator';
import { denoExec } from '#test/deno.js';

const generator = new Generator({
  mapUrl: 'about:blank',
  stdlib: new URL('../../jspm-core/', import.meta.url),
  env: ['production', 'node', 'deno', 'module']
});

await generator.install('chalk');

await denoExec(generator.getMap(), `
  import chalk from 'chalk';

  console.log(chalk.red('IT WORKS'));
`);
