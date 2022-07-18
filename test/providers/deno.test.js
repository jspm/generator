import { Generator } from '@jspm/generator';
import assert from 'assert';

{
  const generator = new Generator({
    mapUrl: new URL('../../', import.meta.url),
    defaultRegistry: 'denoland'
  });

  await generator.install('oak@10.6.0');

  const json = generator.getMap();

  assert.strictEqual(json.imports['oak'], 'https://deno.land/x/oak@v10.6.0/mod.ts');
}

{
  const generator = new Generator();

  await generator.install('denoland:oak');

  const json = generator.getMap();

  assert.strictEqual(json.imports['oak'], 'https://deno.land/x/oak@v10.6.0/mod.ts');
}

{
  const generator = new Generator();

  await generator.install('deno:path');

  const json = generator.getMap();

  assert.strictEqual(json.imports['path'], 'https://deno.land/std@0.148.0/path/mod.ts');
}
