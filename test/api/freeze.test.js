import { Generator, lookup, parseUrlPkg } from "@jspm/generator";
import assert from 'assert';

/**
 * This test pins down the semantics of the "freeze" option on the generator.
 *
 * When enabled, the entire input map is treated as a strict lockfile, meaning
 * no existing versions of any dependency will be changed by the generator. If
 * there's a secondary lock for "react", for instance, then even a primary
 * install will use that lock rather than latest. Freeze allows new dependencies
 * to be added, however, if they have no existing locks.
 *
 * When freeze is combined with "resolutions", the custom resolutions always
 * always take precedence over any of the freeze behaviour.
 *
 * When freeze is combined with "latest", the latest flag takes precedence and
 * all locks are upgraded to the latest compatible versions.
 */

async function checkScenario(scenario) {
  const generator = new Generator({
    freeze: true,
    mapUrl: import.meta.url,
    inputMap: scenario.map ?? {},

    ...(scenario.opts ?? {}),
  });

  // install dependencies:
  await Promise.all(scenario.install.map(pkg => generator.install(pkg)));
  const map = generator.getMap();

  // fetch installed versions
  let mdls = [];
  for (const url of Object.values(map.imports || {}))
    mdls.push(await parseUrlPkg(url));
  for (const scope of Object.keys(map.scopes || {}))
    for (const url of Object.values(map.scopes[scope]))
      mdls.push(await parseUrlPkg(url));
  function getVersions(pkg) {
    return mdls
      .filter(mdl => mdl.pkg.name === pkg)
      .map(mdl => mdl.pkg.version);
  }

  // check constraints
  for (let [pkg, version] of Object.entries(scenario.expect ?? {})) {
    if (version === "latest") version = (await lookup(pkg)).resolved.version;

    assert(
      getVersions(pkg).every(v => v === version),
      `freeze scenario "${scenario.name}" expected ${pkg}@${version}, but got [ ${getVersions(pkg).join(", ")} ]`,
    );
  }
}

await Promise.all([
  {
    name: "no existing locks",
    install: ["lit", "react"],
    expect: {
      lit: "latest",
      react: "latest",
    },
  },

  {
    name: "existing primary locks",
    map: {
      imports: {
        "lit-html": "https://ga.jspm.io/npm:lit-html@2.6.0/development/lit-html.js",
        "react": "https://ga.jspm.io/npm:react@18.1.0/dev.index.js",
      }
    },
    install: ["lit", "react"],
    expect: {
      "lit-html": "2.6.0", // primary lock is hit for a secondary install
      "react": "18.1.0", // primary lock is hit for a primary install
      "lit": "latest",
    },
  },

  {
    name: "existing secondary locks",
    map: {
      scopes: {
        "https://ga.jspm.io/": {
          "lit-html/is-server.js": "https://ga.jspm.io/npm:lit-html@2.6.0/development/is-server.js"
        }
      }
    },
    install: ["lit", "lit-html", "react"],
    expect: {
      "lit-html": "2.6.0", // secondary lock is hit for primary install
      "react": "latest",
      "lit": "latest",
    },
  },

  {
    name: "combined with resolutions",
    map: {
      imports: {
        "react": "https://ga.jspm.io/npm:react@18.1.0/dev.index.js",
      },
      scopes: {
        "https://ga.jspm.io/": {
          "lit-html/is-server.js": "https://ga.jspm.io/npm:lit-html@2.6.0/development/is-server.js"
        }
      }
    },
    opts: {
      resolutions: {
        "react": "18.2.0",
        "lit-html": "2.6.1",
      },
    },
    install: ["lit", "react"],
    expect: {
      "lit-html": "2.6.1", // resolution takes precedence
      "react": "18.2.0", // resolution takes precedence
      "lit": "latest",
    },
  },

  {
    name: "combined with latest",
    map: {
      imports: {
        "react": "https://ga.jspm.io/npm:react@18.1.0/dev.index.js",
        "chalk": "https://ga.jspm.io/npm:chalk@4.1.0/source/index.js",
      },
      scopes: {
        "https://ga.jspm.io/": {
          "lit-html/is-server.js": "https://ga.jspm.io/npm:lit-html@2.6.0/development/is-server.js"
        }
      }
    },
    opts: {
      latest: true,
    },
    install: ["lit", "react"],
    expect: {
      "lit-html": "latest",
      "react": "latest",
      "lit": "latest",
      "chalk": "4.1.0", // not touched by installs, so not bumped
    },
  },
].map(checkScenario));
