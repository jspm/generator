import { Generator } from "@jspm/generator";
import assert from "assert";

const generator = new Generator({
  inputMap: {
    imports: {
        react: "https://ga.jspm.io/npm:react@17.0.1/dev.index.js",
    },
  },
  mapUrl: import.meta.url,
  env: ["production", "browser"],
  freeze: true, // lock versions
});

await generator.install();
const json = generator.getMap();

// Install with too many arguments should throw:
try {
  await generator.install("too", "many");
  assert(false);
} catch {
  /* expected to throw */
}

// Install with no arguments should install all pins:
assert.strictEqual(
  json.imports.react,
  "https://ga.jspm.io/npm:react@17.0.1/index.js"
);
