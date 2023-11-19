import { Generator, lookup } from "@jspm/generator";
import assert from "assert";

const myorgUrl = "https://unpkg.com/";
const exactPkgRegEx = /^((?:@[^/\\%@]+\/)?[^./\\%@][^/\\%@]*)@([^\/]+)(\/.*)?$/;

const generator = new Generator({
  defaultProvider: "myorg",
  defaultRegistry: "myorg",
  customProviders: {
    myorg: {
      ownsUrl(url) {
        return url.startsWith(myorgUrl);
      },
      pkgToUrl({ registry, name, version }) {
        return `${myorgUrl}${name}@${version}/`;
      },
      async getPackageConfig(pkgUrl) {
        const pcfg = await (await fetch(pkgUrl)).json();
        if (pcfg.dependencies) {
          let dependencies = {};
          for (let [name, target] in pcfg.dependencies) {
            if (target.indexOf(':') === -1)
              target = 'myorg:' + target;
            dependencies[name] = target;
          }
          pcfg.dependencies = dependencies;
        }
        return pcfg;
      },
      parseUrlPkg(url) {
        if (url.startsWith(myorgUrl)) {
          const [, name, version] = url.slice(myorgUrl.length).match(exactPkgRegEx) || [];
          return { registry: "myorg", name, version };
        }
      },
      
      async resolveLatestTarget(
        { registry, name, range, unstable },
        layer,
        parentUrl
      ) {
        assert.ok(registry === 'myorg');
        const { resolved: { name: resolvedName, version: resolvedVersion } } = await lookup(`${name}@${range.toString()}`);
        return { registry: 'myorg', name: resolvedName, version: resolvedVersion };
      },
    },
  },
});

await generator.install("myorg:lit");

const json = generator.getMap();

assert.ok(
  json.imports.lit.startsWith('https://unpkg.com/lit@')
);
