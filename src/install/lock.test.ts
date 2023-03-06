import {
  ExactPackage,
  PackageTarget,
} from "@jspm/generator/install/package.js";
import {
  changeProvider,
  changeRegistry,
} from "@jspm/generator/install/lock.js";
import { Provider } from "@jspm/generator/providers/index.js";
import { Generator } from "@jspm/generator";
import { encodeBase64 } from "@jspm/generator/common/b64.js";
import { strictEqual } from "assert";

const rootUrl = new URL("../../", import.meta.url);
const g = new Generator({
  mapUrl: rootUrl.href,
});
const r = g.traceMap.resolver;

{
  async function testForRegistry(
    registry: string,
    n: string,
    v: string,
    isNull: boolean = false
  ) {
    const pkg: ExactPackage = {
      name: n,
      version: v,
      registry,
    };

    // Should have switched to "npm" registry, as that's what jspm.io tracks:
    const provider = { provider: "jspm.io", layer: "default" };
    const res = await changeProvider(pkg, provider, r, rootUrl);
    if (isNull) {
      strictEqual(res, null);
    } else {
      strictEqual(res.name, "chalk");
      strictEqual(res.registry, "npm");
      strictEqual(res.version, "4.1.2");
    }
  }

  // Must match the version of "chalk" installed locally!
  await testForRegistry("npm", "chalk", "4.1.2");
  await testForRegistry("deno", "chalk", "4.1.2", true);
  await testForRegistry("denoland", "chalk", "4.1.2", true);
  await testForRegistry(
    "node_modules",
    "chalk",
    encodeBase64(new URL("./node_modules/chalk/", rootUrl).href)
  );
}
