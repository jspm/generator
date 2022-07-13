import { Generator } from '@jspm/generator';
import assert from 'assert';

const generator = new Generator({
  mapUrl: new URL('../../', import.meta.url),
  defaultProvider: 'deno'
});

await generator.install('oak');

const json = generator.getMap();

console.log(json);
