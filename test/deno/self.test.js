import { Generator } from "@jspm/generator";
import { denoExec } from "#test/deno";

function replaceAll(str, pattern, replacement) {
  let last;
  while (last !== str) {
    last = str;
    str = str.replace(pattern, replacement);
  }
  return str;
}

const generator = new Generator({
  mapUrl: "about:blank",
  env: ["production", "node", "deno", "module", "source"],
});

const targetUrl = new URL("../../", import.meta.url).href;

await generator.install({ alias: "@jspm/generator", target: targetUrl });

const map = generator.getMap();

// console.log(replaceAll(JSON.stringify(map, null, 2), targetUrl, 'https://ga.jspm.io/npm:@jspm/generator@1.0.0-beta.7/'));

await denoExec(
  generator.getMap(),
  `
  import { Generator } from '@jspm/generator';
  import { assertEquals } from "https://deno.land/std@0.100.0/testing/asserts.ts";

  const generator = new Generator({
    mapUrl: 'about:blank',
    env: ['production', 'node', 'deno', 'module', 'source']
  });

  // inception!
  await generator.install({ alias: '@jspm/generator', target: ${JSON.stringify(
    targetUrl
  )} });
  const map = generator.getMap();

  assertEquals(map.imports, ${JSON.stringify(map.imports)})
`
);
