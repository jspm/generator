import { Generator } from '@jspm/generator';
import assert from 'assert';

const generator = new Generator({
  mapUrl: new URL('../../', import.meta.url),
  defaultProvider: 'deno'
});

await generator.install('oak@10.6.0');

const json = generator.getMap();

assert.strictEqual(json.imports['oak'], 'https://deno.land/x/oak@v10.6.0/mod.ts');
