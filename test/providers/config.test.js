import { Generator } from "@jspm/generator";
import assert from "assert";

const name = Buffer.from("7169746b616f2e636f6d", "hex").toString();

// Test with custom CDN URL
{
  const generator = new Generator({
    mapUrl: import.meta.url,
    defaultProvider: "jspm.io",
    providerConfig: {
      "jspm.io": {
        cdnUrl: `https://${name}/`
      }
    }
  });

  await generator.install("react@17.0.1");
  const json = generator.getMap();

  assert.strictEqual(
    json.imports.react,
    `https://${name}/npm:react@17.0.1/dev.index.js`
  );
}
