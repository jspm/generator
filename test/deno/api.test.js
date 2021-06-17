import { Generator } from '@jspm/generator';
import { denoExec } from '#test/deno';

const generator = new Generator({
  mapUrl: 'about:blank',
  stdlib: new URL('../../jspm-core/', import.meta.url),
  env: ['production', 'node', 'deno', 'module']
});


// (async () => {
//   for await (const { type, message } of generator.logStream())
//     console.log(`${type}: ${message}`);
// })();
if (false) {

await generator.install('cowsay');

await denoExec(generator.getMap(), `
  import cowsay from 'cowsay';

  console.log(cowsay.say({
    text : "I'm a moooodule",
    e : "oO",
    T : "U "
  }));
`);
}