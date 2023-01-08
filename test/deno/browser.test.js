import assert from 'assert'
import { Generator } from '@jspm/generator';

const generator = new Generator({
  env: [
    "development",
    "browser",
    "module",
    "deno",
  ]
});

await generator.install('@babel/core');

const map = generator.getMap();

assert.ok(!map.scopes['https://ga.jspm.io/']['process'].endsWith('.ts'));
