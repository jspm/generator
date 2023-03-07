<div align="center">
  <img style="display: inline-block; width: 100px; height: 100pz" src="./media/logo.png"/>
  <h1 style="display: inline-block">JSPM Generator API Docs</h1>
</div>

For details on the supported options in the [Generator](./classes/Generator.md) constructor, see [GeneratorOptions](./interfaces/GeneratorOptions.md). Documentation for the rest of the package exports can be found in the [modules page](./modules.md).

## Package Configuration

Package exports configurations are taken from the package.json. When attempting to install or resolve a subpath of a package
that does not exist in its exports, an error will be thrown.

To recover from errors like this, JSPM and Skypack have mechanisms for overriding package configurations:

* [JSPM Overrides](https://github.com/jspm/overrides)
* [Skypack Definitely Exported](https://github.com/snowpackjs/DefinitelyExported)

Creating a PR to add custom exports overrides allows for fixing any package issues on the CDNs.

For more information on the package exports field see the [Node.js documentation](https://nodejs.org/dist/latest-v16.x/docs/api/packages.html#packages_package_entry_points).

## Logging

A logger is provided via `generator.logStream`:

```js
const generator = new Generator();

(async () => {
  for await (const { type, message } of generator.logStream()) {
    console.log(`${type}: ${message}`);
  }
})();
```

Log events recorded include `trace`, `resolve` and `install`.

Note that the log messages are for debugging and not currently part of the semver contract of the project.

Alternatively set the environment variable `JSPM_GENERATOR_LOG` to enable default console logging.
