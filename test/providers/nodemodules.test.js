import { Generator } from "@jspm/generator";
import assert from "assert";

let generator = new Generator({
  mapUrl: new URL("../../", import.meta.url),
  defaultProvider: "nodemodules",
});

await generator.install("lit-element");
await generator.install("lit-html");

let json = generator.getMap();
assert.strictEqual(
  json.imports["lit-element"],
  "./node_modules/lit-element/lit-element.js"
);
assert.strictEqual(
  json.scopes["./node_modules/lit-element/"]["lit-html/"],
  "./node_modules/lit-html/"
);

// Check that we can reinstall using the jspm.io provider, and then go back to
// the nodemodules provider, without affecting the resolutions:

generator = new Generator({
  mapUrl: new URL("../../", import.meta.url),
  defaultProvider: "jspm.io",
  inputMap: json,
});
await generator.reinstall();
json = generator.getMap();

generator = new Generator({
  mapUrl: new URL("../../", import.meta.url),
  defaultProvider: "nodemodules",
  inputMap: json,
});
await generator.reinstall();
json = generator.getMap();
assert.strictEqual(
  json.imports["lit-element"],
  "./node_modules/lit-element/lit-element.js"
);
assert.strictEqual(
  json.scopes["./node_modules/lit-element/"]["lit-html/"],
  "./node_modules/lit-html/"
);
