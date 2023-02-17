import { Generator } from "@jspm/generator";
import assert from "assert";

const generator = new Generator({
  mapUrl: new URL('./versionbumps/importmap.json', import.meta.url),
  baseUrl: new URL('./versionbumps/', import.meta.url),
  
  inputMap: {
    imports: {
      "es-module-lexer": "https://ga.jspm.io/npm:es-module-lexer@0.10.5/dist/lexer.js"
    }
  }
});

await generator.traceInstall('x');

const json = generator.getMap();

console.log(json);

// assert.strictEqual(
//   json.imports.custom,
//   "https://ga.jspm.io/npm:react@16.14.0/index.js"
// );
