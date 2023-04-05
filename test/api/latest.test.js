import { Generator, lookup, parseUrlPkg } from "@jspm/generator";
import assert from "assert";

/**
 * NPM has the following behaviour with respect to primary and secondary
 * locks and the package.json constraints during installs:
 *
 * primary out-of-range: install latest compatible version
 * primary in-range:     install latest compatible version
 * scndary out-of-range: install latest compatible version
 * scndary in-range:     use lock
 *
 * We should have the same behaviour by default, except for the case of a
 * primary lock that isn't in the package.json, which we should keep as the
 * user likely installed something manually.
 */

const baseUrl = new URL("./local/latest/", import.meta.url);
function generator(inputMap = {}) {
  return new Generator({
    baseUrl,
    inputMap,
  });
}
async function getMapFor(pkgs, res={}) {
  const g = new Generator({ resolutions: res });
  await Promise.all(pkgs.map(pkg => g.install(pkg)));
  return g.getMap();
}

// Latest in-range version of "react", which is "16.13.1", with dependencies:
//      "loose-envify": "^1.1.0"
//      "object-assign": "^4.1.1"
//      "prop-types": "^15.6.2"
const [latestReact, latestObjectAssign] = await (async () => {
  const g = generator();
  await g.install("react");
  const map = g.getMap();
  return [
    (await parseUrlPkg(map.imports["react"])).pkg,
    (await parseUrlPkg(map.scopes["https://ga.jspm.io/"]["object-assign"])).pkg,
    (await parseUrlPkg(map.scopes["https://ga.jspm.io/"]["prop-types/checkPropTypes"])).pkg,
  ];
})();

// // primary not in package.json
// // shouldn't be removed or changed in any way
// {
//   const g = generator(await getMapFor(['lit@^2.0.0']));
//   await g.install();
// 
//   const map = g.getMap();
//   assert.deepStrictEqual(
//     (await parseUrlPkg(map.imports["lit"])).pkg,
//     (await lookup("lit@^2.0.0")).resolved,
//   );
// }
// 
// // primary out-of-range
// // should be replaced with an in-range latest
// {
//   const g = generator(await getMapFor(["react@16.14.0"]));
//   await g.install();
// 
//   const map = g.getMap();
//   assert.deepStrictEqual(
//     (await parseUrlPkg(map.imports["react"])).pkg,
//     latestReact,
//   );
// }
// 
// // primary in-range but not latest
// // should be replaced with in-range latest
// {
//   const g = generator(await getMapFor(["react@16.13.0"]));
//   await g.install();
// 
//   const map = g.getMap();
//   assert.deepStrictEqual(
//     (await parseUrlPkg(map.imports["react"])).pkg,
//     latestReact,
//   );
// }
// 
// // primary in-range but not latest, installed under alias
// // should be replaced with in-range latest
// {
//   const g = generator(await getMapFor([{
//     alias: "alias",
//     target: "react@16.13.0"
//   }]));
//   await g.install();
// 
//   const map = g.getMap();
//   assert.deepStrictEqual(
//     (await parseUrlPkg(map.imports["alias"])).pkg,
//     latestReact,
//   );
// }
// 
// // secondary out-of-range
// // should be replaced with in-range latest
// {
//   const g = generator(await getMapFor(["react@16.13.0"], {
//     "object-assign": "~4.0.0",
//   }));
//   await g.install();
// 
//   const map = g.getMap();
//   assert.deepStrictEqual(
//     (await parseUrlPkg(map.scopes["https://ga.jspm.io/"]["object-assign"])).pkg,
//     latestObjectAssign,
//   );
// }
// 
// // secondary in-range
// // should use the existing lock
// {
//   const imap = await getMapFor(["react@16.13.0"], {
//     "prop-types": "15.6.2",
//   });
//   const propTypes = 
//     (await parseUrlPkg(imap.scopes["https://ga.jspm.io/"]["prop-types/checkPropTypes"])).pkg;
//   const g = generator(imap);
//   await g.install();
// 
//   const map = g.getMap();
//   assert.deepStrictEqual(
//     (await parseUrlPkg(map.scopes["https://ga.jspm.io/"]["prop-types/checkPropTypes"])).pkg,
//     propTypes,
//   );
// }

// primary custom mapping
// should not be touched
{
  const g = generator({
    imports: {
      "react": "https://code.jquery.com/jquery-3.6.4.min.js",
    },
  });
  await g.install();

  const map = g.getMap();
  assert.deepStrictEqual(
    map.imports.react,
    "https://code.jquery.com/jquery-3.6.4.min.js",
  );
}
