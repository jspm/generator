import { Generator, lookup } from '@jspm/generator';
import assert from 'assert';

const denoStdVersion = (await lookup('deno:path')).resolved.version;

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

  assert.strictEqual(json.imports['path'], `https://deno.land/std@${denoStdVersion}/path/mod.ts`);
}

{
  const generator = new Generator({
    inputMap: {
      imports: {
        'fs': 'https://deno.land/std@0.148.0/fs/mod.ts'
      }
    },
    freeze: true
  });

  await generator.install('deno:path');

  const json = generator.getMap();

  // Note: The stdlib should probably automatically stay in sync
  assert.strictEqual(json.imports['fs'], `https://deno.land/std@0.148.0/fs/mod.ts`);
  assert.strictEqual(json.imports['path'], `https://deno.land/std@${denoStdVersion}/path/mod.ts`);
}

{
  const generator = new Generator({
    inputMap: {
      imports: {
        'fs': 'https://deno.land/std@0.148.0/fs/mod.ts'
      }
    }
  });

  await generator.install('deno:path');

  const json = generator.getMap();

  assert.strictEqual(json.imports['fs'], `https://deno.land/std@0.148.0/fs/mod.ts`);
  assert.strictEqual(json.imports['path'], `https://deno.land/std@${denoStdVersion}/path/mod.ts`);

  // TODO:
  // await generator.update();

  // {
  //   const json = generator.getMap();

  //   assert.strictEqual(json.imports['fs'], `https://deno.land/std@${denoStdVersion}/fs/mod.ts`);
  //   assert.strictEqual(json.imports['path'], `https://deno.land/std@${denoStdVersion}/path/mod.ts`);
  // }
}
