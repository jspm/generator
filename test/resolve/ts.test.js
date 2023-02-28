import { Generator } from "@jspm/generator";
import assert from "assert";

if (typeof document === "undefined") {
  const generator = new Generator({
    mapUrl: import.meta.url,
    defaultProvider: "nodemodules",
  });

  await generator.link("./tspkg/main.ts");

  assert.strictEqual(
    generator.getAnalysis(new URL("./tspkg/dep.ts", import.meta.url)).format,
    "typescript"
  );
}
