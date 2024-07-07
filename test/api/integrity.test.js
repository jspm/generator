import { Generator } from "@jspm/generator";
import assert from "assert";

const generator = new Generator({ integrity: true });

await generator.install("react@16");

const json = generator.getMap();

assert.strictEqual(
  json.imports.react,
  "https://ga.jspm.io/npm:react@16.14.0/dev.index.js"
);
assert.strictEqual(
  json.integrity["https://ga.jspm.io/npm:react@16.14.0/dev.index.js"],
  "sha384-9Mi1J+3gFLBPlgiPETEugnpEPEy1odxLTBsMnqO6Z6r0btFl5v4D/UYAmGqfhaLr"
);
