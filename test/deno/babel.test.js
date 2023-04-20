import { Generator } from "@jspm/generator";
import { denoExec } from "#test/deno";

// Babel doesn't seem to support deno very well, see:
// https://github.com/babel/babel/issues/11543
//
// At the moment trying to import babel in deno produces the following error:
//   error: Uncaught ReferenceError: Cannot access 'default' before initialization

const generator = new Generator({
  env: ["node", "deno"],
});

await generator.install("@babel/core@7.15.0");
await generator.install("assert");

// TODO: re-enable if they support deno at some point
//
// const map = generator.getMap();
//
// await denoExec(
//   map,
//   `
//   import babel from '@babel/core';
//   import assert from 'assert';
//
//   const { code } = babel.transform('var p = 5');
//   assert.strictEqual(code, 'var p = 5;');
// `
// );
