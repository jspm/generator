import { Generator, lookup } from '@jspm/generator';
import assert from 'assert';

const denoStdVersion = (await lookup('deno:path')).resolved.version;

{
  const generator = new Generator({
    mapUrl: new URL('../../', import.meta.url),
    inputMap: {
      imports: {
        'testing/asserts': 'https://deno.land/std@0.151.0/testing/asserts.ts'
      }
    }
  });

  await generator.install('denoland:oak/body.ts');

  const json = generator.getMap();

  assert.strictEqual(json.imports['oak/body.ts'], 'https://deno.land/x/oak@v11.0.0/body.ts');
  assert.strictEqual(json.imports['testing/asserts'], 'https://deno.land/std@0.151.0/testing/asserts.ts');

  await generator.update();

  {
    const json = generator.getMap();

    assert.strictEqual(json.imports['oak/body.ts'], 'https://deno.land/x/oak@v11.0.0/body.ts');
    assert.strictEqual(json.imports['testing/asserts'], 'https://deno.land/std@0.152.0/testing/asserts.ts');
  }
}

// {
//   const generator = new Generator();

//   await generator.traceInstall(new URL('./coremods/deno.js', import.meta.url).href);

//   const json = generator.getMap();

//   console.log(json);
// }

// {
//   const generator = new Generator();

//   await generator.install({ target: new URL('./coremods/', import.meta.url).href, subpath: './deno' });

//   const json = generator.getMap();

//   console.log(json);
// }

// {
//   const generator = new Generator();

//   try {
//     await generator.traceInstall(new URL('./coremods/deno.notfound.js', import.meta.url).href);
//   }
//   catch (e) {
//     console.log(e);
//   }
// }

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
  const generator = new Generator({
    mapUrl: new URL('../../', import.meta.url),
    defaultRegistry: 'denoland'
  });

  await generator.install('oak@10.6.0/body.ts');

  const json = generator.getMap();

  assert.strictEqual(json.imports['oak/body.ts'], 'https://deno.land/x/oak@v10.6.0/body.ts');
}

{
  const generator = new Generator();

  await generator.install('denoland:oak');

  const json = generator.getMap();

  assert.strictEqual(json.imports['oak'], 'https://deno.land/x/oak@v11.0.0/mod.ts');
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

  await generator.update();

  {
    const json = generator.getMap();

    assert.strictEqual(json.imports['fs'], `https://deno.land/std@${denoStdVersion}/fs/mod.ts`);
    assert.strictEqual(json.imports['path'], `https://deno.land/std@${denoStdVersion}/path/mod.ts`);
  }
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

  await generator.install('deno:testing/asserts');

  await generator.install('deno:async/abortable.ts');

  const json = generator.getMap();

  assert.strictEqual(json.imports['fs'], `https://deno.land/std@0.148.0/fs/mod.ts`);
  assert.strictEqual(json.imports['async/abortable.ts'], `https://deno.land/std@${denoStdVersion}/async/abortable.ts`);
  assert.strictEqual(json.imports['testing/asserts'], `https://deno.land/std@${denoStdVersion}/testing/asserts.ts`);

  await generator.update();

  {
    const json = generator.getMap();

    assert.strictEqual(json.imports['fs'], `https://deno.land/std@${denoStdVersion}/fs/mod.ts`);
    assert.strictEqual(json.imports['async/abortable.ts'], `https://deno.land/std@${denoStdVersion}/async/abortable.ts`);
    assert.strictEqual(json.imports['testing/asserts'], `https://deno.land/std@${denoStdVersion}/testing/asserts.ts`);
  }
}
