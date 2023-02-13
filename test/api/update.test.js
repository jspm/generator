import { Generator } from "@jspm/generator";
import assert from "assert";

{
  const generator = new Generator({
    inputMap: {
      imports: {
        react: "https://ga.jspm.io/npm:react@17.0.1/dev.index.js",
      },
      scopes: {
        "https://ga.jspm.io/": {
          "object-assign":
            "https://ga.jspm.io/npm:object-assign@4.1.0/index.js",
        },
      },
    },
    mapUrl: import.meta.url,
    defaultProvider: "jspm",
    env: ["production", "browser"],
  });

  await generator.update("react");
  const json = generator.getMap();

  assert.strictEqual(
    json.imports.react,
    "https://ga.jspm.io/npm:react@17.0.2/index.js"
  );
  assert.strictEqual(
    json.scopes["https://ga.jspm.io/"]["object-assign"],
    "https://ga.jspm.io/npm:object-assign@4.1.1/index.js"
  );
  assert.strictEqual(Object.keys(json.imports).length, 1);
  assert.strictEqual(Object.keys(json.scopes["https://ga.jspm.io/"]).length, 1);
}

{
  const generator = new Generator({
    inputMap: {
      imports: {
        lit: "https://ga.jspm.io/npm:lit@2.2.4/index.js",
        "lit/directive.js": "https://ga.jspm.io/npm:lit@2.2.4/directive.js",
      },
      scopes: {
        "https://ga.jspm.io/": {
          "@lit/reactive-element":
            "https://ga.jspm.io/npm:@lit/reactive-element@1.3.4/reactive-element.js",
          "lit-element/lit-element.js":
            "https://ga.jspm.io/npm:lit-element@3.2.2/lit-element.js",
          "lit-html": "https://ga.jspm.io/npm:lit-html@2.2.7/lit-html.js",
          "lit-html/directive.js":
            "https://ga.jspm.io/npm:lit-html@2.2.7/directive.js",
        },
      },
    },
    mapUrl: import.meta.url,
    defaultProvider: "jspm",
    env: ["production", "browser"],
  });

  await generator.update("lit");
  const json = generator.getMap();

  assert.strictEqual(
    json.imports.lit,
    "https://ga.jspm.io/npm:lit@2.6.1/index.js"
  );
  assert.strictEqual(
    json.imports["lit/directive.js"],
    "https://ga.jspm.io/npm:lit@2.6.1/directive.js"
  );
}
