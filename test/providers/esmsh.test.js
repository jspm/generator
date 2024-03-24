import { Generator } from "@jspm/generator";
import assert from "assert";

const generator = new Generator({
  mapUrl: import.meta.url,
  defaultProvider: "esm.sh",
  env: ["production", "browser"],
});

await generator.install("lit@2.0.0-rc.1");
const json = generator.getMap();

assert.strictEqual(json.imports.lit, "https://esm.sh/*lit@2.0.0-rc.1");

const scope = json.scopes["https://esm.sh/"];
assert.ok(scope["@lit/reactive-element"]);
assert.ok(scope["lit-element/lit-element.js"]);
assert.ok(scope["lit-html"]);

await generator.install("twind");

{
  const json = generator.getMap();
  assert.ok(json.imports.twind);
}