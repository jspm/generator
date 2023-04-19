import { Generator } from "@jspm/generator";
import assert from "assert";
import fs from "fs/promises";
import { fileURLToPath } from "url";

const expectedResults = {
  "primary-in-range": {
    "wayfarer": "https://ga.jspm.io/npm:wayfarer@6.6.4/index.js",
    "xtend": "https://ga.jspm.io/npm:xtend@4.0.2/immutable.js",
  },
  "primary-out-range": {
    "wayfarer": "https://ga.jspm.io/npm:wayfarer@6.6.4/index.js",
    "xtend": "https://ga.jspm.io/npm:xtend@4.0.2/immutable.js",
  },
  "secondary-in-range": {
    "wayfarer": "https://ga.jspm.io/npm:wayfarer@6.6.2/index.js",
    "xtend": "https://ga.jspm.io/npm:xtend@4.0.1/immutable.js",
  },
  "secondary-out-range": {
    "wayfarer": "https://ga.jspm.io/npm:wayfarer@6.6.2/index.js",
    "xtend": "https://ga.jspm.io/npm:xtend@4.0.2/immutable.js",
  },
  "primary-not-latest-secondary-in-range": {
    "wayfarer": "https://ga.jspm.io/npm:wayfarer@6.6.4/index.js",
    "xtend": "https://ga.jspm.io/npm:xtend@4.0.1/immutable.js",
  },
  "primary-not-latest-secondary-out-range": {
    "wayfarer": "https://ga.jspm.io/npm:wayfarer@6.6.4/index.js",
    "xtend": "https://ga.jspm.io/npm:xtend@4.0.2/immutable.js",
  },
}

for (const [name, expected] of Object.entries(expectedResults)) {
  const gen = new Generator({
    baseUrl: new URL(`./${name}/`, import.meta.url),
    inputMap: JSON.parse(await fs.readFile(
      fileURLToPath(new URL(`./${name}/importmap.json`, import.meta.url))
    )),
  });

  await gen.install("wayfarer");
  const map = JSON.stringify(gen.getMap(), null, 2);
  for (const [pkg, resolution] of Object.entries(expected)) {
    assert(
      map.includes(resolution), 
      `${name}: ${pkg} should have resolution ${resolution}:\n${map}`,
    );
  }
}
