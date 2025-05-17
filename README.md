# ⚠️ ARCHIVED

**The JSPM Generator repository has moved into the JSPM Monorepo.**

**Please visit the new project location: [https://github.com/jspm/jspm](https://github.com/jspm/jspm/tree/main/generator)**

---

This is the core import map generation project for the [JSPM CLI](https://github.com/jspm/jspm).

* **Local Linking**: map packages to your local `node_modules` folder
* **Common CDNs**: Resolve against common CDNs like [jspm.io](https://jspm.io/), [jsDelivr](https://jsdelivr.com), [UNPKG](https://unpkg.com/) and [more](#customProviders)
* **Universal Semantics**: Implements [universal CDN resolution](https://jspm.org/docs/cdn-resolution.md) semantics, based on an extension of the Node.js resolution
* **Conditional Resolution**: Map different versions of a module based on environment
* **Dependency Versioning**: Respects the version constraints in local and remote `package.json` files
* **Package Entrypoints**: Handles node-style package exports, imports and own-name resolution

See the [documentation](https://jspm.org/docs/generator) and [getting started](https://jspm.org/docs/getting-started) guide on jspm.org.

## Contributing

Contributions welcome.

Build and test workflows use [Chomp](https://chompbuild.com).

## License

Apache-2.0
