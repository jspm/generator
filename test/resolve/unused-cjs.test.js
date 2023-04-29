import { Generator } from "@jspm/generator";
import assert from "assert";

const generator = new Generator({
  mapUrl: import.meta.url,
});

// Should not throw, index file doesn't use CJS:
await generator.install("./unusedcjspkg");

// Should throw, uses module global:
await (async () => {
  try {
    await generator.install("./unusedcjspkg/cjs.js");
    assert(false);
  } catch {}
})();
