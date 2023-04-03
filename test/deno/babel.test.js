import { Generator } from "@jspm/generator";
import { denoExec } from "#test/deno";

const generator = new Generator({
  env: ["node", "deno"],
  resolutions: {
    // hack as deno bombs on circular imports in 7.21.0 (latest)
    "@babel/helper-create-class-features-plugin": "7.20.0"
  },
});

await generator.install("@babel/core@7.15.0");
await generator.install("assert");

const map = generator.getMap();

await denoExec(
  map,
  `
  import babel from '@babel/core';
  import assert from 'assert';

  const { code } = babel.transform('var p = 5');
  assert.strictEqual(code, 'var p = 5;');
`
);
