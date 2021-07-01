import { Generator } from '@jspm/generator';
import { denoExec } from '#test/deno';

const generator = new Generator({
  mapUrl: 'about:blank',
  stdlib: new URL('../../jspm-core/', import.meta.url),
  env: ['production', 'node', 'deno', 'module']
});

const targetUrl = new URL('../../', import.meta.url).href;

await generator.install({ alias: '@jspm/generator', target: targetUrl });

const map = generator.getMap();

await denoExec(generator.getMap(), `
  import { Generator } from '@jspm/generator';
  import { assertEquals } from "https://deno.land/std@0.100.0/testing/asserts.ts";

  const generator = new Generator({
    mapUrl: 'about:blank',
    stdlib: new URL('../../jspm-core/', ${JSON.stringify(import.meta.url)}),
    env: ['production', 'node', 'deno', 'module']
  });

  // inception!
  await generator.install({ alias: '@jspm/generator', target: ${JSON.stringify(targetUrl)} });
  const map = generator.getMap();

  assertEquals(map, ${JSON.stringify(map)})
`);
