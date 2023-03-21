import { Generator } from "@jspm/generator";
import { denoExec } from "#test/deno";

const generator = new Generator({
  mapUrl: import.meta.url,
  env: ["production", "deno", "module"],
  defaultProvider: "esm.sh",
});

// Install the NPM assert shim and use it to test itself!
await generator.install('npm:assert@2.0.0');
await denoExec(
  generator.getMap(),
  `
  import { ok } from 'assert';
  ok(1 === 1);
  `
);
