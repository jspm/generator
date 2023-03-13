import { parseUrlPkg } from "@jspm/generator";
import assert from "assert";

const pkg = await parseUrlPkg("https://ga.jspm.io/npm:react@17.0.1/index.js");
console.log(pkg);
assert.strictEqual(pkg.source.provider, "jspm.io");
assert.strictEqual(pkg.source.layer, "default");
assert.strictEqual(pkg.pkg.name, "react");
assert.strictEqual(pkg.pkg.version, "17.0.1");
assert.strictEqual(pkg.pkg.registry, "npm");
