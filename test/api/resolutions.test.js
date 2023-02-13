import { Generator } from "@jspm/generator";
import assert from "assert";

const generator = new Generator({
  mapUrl: import.meta.url,
  env: ["production", "browser"],
  resolutions: {
    semver: "6.2.0",
  },
});

await generator.install("@babel/core@7.16.0");
const json = generator.getMap();

assert.ok(json.imports["@babel/core"]);
assert.ok(Object.keys(json.scopes["https://ga.jspm.io/"]).length > 20);
assert.ok(json.scopes["https://ga.jspm.io/"]["semver"].includes("6.2.0"));
