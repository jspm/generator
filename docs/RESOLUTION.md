# JSPM Resolution Rules

### Goals

* Enable comprehensive version resolution over arbitrary CDN installs.
* Universal resolution standard for URLs that supports package resolution features expected for modern workflows (conditional resolution, dependency version resolution, basic resolution rules).
* Base this entirely off of the Node.js resolution rules as an extension of Node.js resolution to arbitrary URLs. This ensures backwards compatibility, builds on known patterns, and grows the ecosystem potential.

### Key Concepts

#### Package

A package is a well-formed URL ending in a "/" that lies on a package boundary.

#### Package Boundary

All URLs are contained within a package boundary. For any URL, the package boundary can be found based on the following rule.

A package boundary is a URL, u, ending in a "/", satisfying one of the following two properties:

1. The URL corresponds to a well-known CDN package format which designates the package boundary. For example, https://deno.land/x/[pkgname]@vx.y.z/ is a package boundary due to the rules of the Deno CDN. These rules are hard-coded based on the unique CDN semantics.
2. `new URL('./package.json', u)` is an existing package.json file.
3. The URL corresponds to a root URL of a host.

For (2), this involves hierarchically checking parent URLs for the existence of a package.json file, until we reach the root of the host.

(2) provides compatibility with the Node.js ecosystem and also provides a convention for determining network package boundaries such that packages copied from the local file system to be hosted on static URLs can still support package configuration-based resolution information.

(1) enables well-known CDNs to have their own custom boundary and configuration rules that avoid unnecessary GET requests to determine network package boundaries.

(1) is always checked before (2) above.

#### Package Configuration

Every package boundary has a package configuration.

1. If the URL corresponds to a well-known CDN then that CDN can provide any custom package configuration API which takes as input the package boundary and returns the package configuration.
2. Otherwise, if the package has a package.json in its package boundary, then as per the previous section this provides the package configuration.

Package configuration is a JSON file with the following optional fields that are used by the resolver:

* **name**: The package name according to itself. A package may be aliased when imported by other importers, but this name is the name the package aliases itself. This enables [package own name resolution](https://nodejs.org/dist/latest-v18.x/docs/api/packages.html#self-referencing-a-package-using-its-name) (`import('name/export')`) working from within the modules of the package itself, identical to the Node.js package resolution.
* **imports**: The internal [package imports](https://nodejs.org/dist/latest-v18.x/docs/api/packages.html#subpath-imports), as per Node.js package resolution.
* **exports**: The internal [package exports](https://nodejs.org/dist/latest-v18.x/docs/api/packages.html#subpath-exports), as per Node.js package resolution.
* **dependencies**: The internal package dependencies, as per npm.
* **peerDependencies**: The internal package peerDependencies, as per npm.
* **optionalDependencies**: The internal package optionalDependencies, as per npm.

#### Conditional Environment

A list of condition names under which resolution is being performed.

In Node.js `"exports"` and `"imports"` resolution, [custom condition names](https://nodejs.org/dist/latest-v18.x/docs/api/packages.html#conditional-exports) can be used to branch resolutions. These define both properties of the environment (eg production versus development) as well as the environment itself, via [well-known runtime names](https://runtime-keys.proposal.wintercg.org/).

In order to select a specific branch for resolution, a list of applicable conditions must be provided to the resolution algorithm. For example: `"browser"`, `"production"`, `"module"`.

#### Bare Specifier

A bare specifier as defined in the HTML specification is a string that does not start with `"./"`, `"../"`, `"/"` and is not a valid URL.

Bare specifiers are explicitly handled by a package lookup system or import map, import maps should always take preference in bare specifier resolutions falling back on unmatched specifiers to an optional internal package lookup system.

The resolution rules for how to get from a bare specifier to an exact URL are explained in the next section as an extension of the Node.js resolution system to arbitrary URLs.

#### Resolution

Resolution must be performed to a specific conditional environment.

The resolution rules for CDNs extend the Node.js resolution rules from file:/// URLs all URLs.

The rules follow the [specification algorithm](https://nodejs.org/dist/latest-v18.x/docs/api/esm.html#resolution-algorithm), with a very brief summary being:

1. If the specifier starts with `"./"`, `"../"`, `"/"` or is a valid URL, then resolve it to the parent and return the resolved URL.
1. The specifier is now a bare specifier and follows the bare specifier resolution rules (which in turn can be supported via an import map or internal package import system):
  1. If the specifier starts with "#" then use the [`"imports"`](https://nodejs.org/dist/latest-v18.x/docs/api/packages.html#subpath-imports) resolution of the parent package boundary.
  1. If the specifier corresponds to the package's own `"name"` field, perform package [own name resolution](https://nodejs.org/dist/latest-v18.x/docs/api/packages.html#self-referencing-a-package-using-its-name).
  1. Finally, perform a package version resolution using the `"dependencies"`, `"peerDependencies"` and `"optionalDependencies"` package configuration constraints, before applying the `"exports"` resolution on that resolved package against the resolved package URL boundary configuration.
1. For packages with no `"exports"` configuration, legacy extension searching and automatic main file rules can apply. Including `"index.js"`, `"mod.ts"` checks for the main (`import 'pkg'` without a subpath) and `".js"`, `".mjs"` and `".ts"` extensions for subpaths (`import 'pkg/subpath'`).
