import sver from "sver";
const { Semver } = sver;
import { Log } from "../common/log.js";
import { Resolver } from "../trace/resolver.js";
import { ExactPackage, newPackageTarget, PackageTarget } from "./package.js";
import { JspmError, throwInternalError } from "../common/err.js";
import {
  getFlattenedResolution,
  getInstallsFor,
  getResolution,
  InstalledResolution,
  LockResolutions,
  PackageInstall,
  pruneResolutions,
  setConstraint,
  setResolution,
  VersionConstraints,
} from "./lock.js";
import { registryProviders } from "../providers/index.js";

export interface PackageProvider {
  provider: string;
  layer: string;
}

export type ResolutionMode = "new" | "new-prefer-existing" | "existing";

export type InstallTarget = {
  pkgTarget: PackageTarget | URL;
  installSubpath: null | `./${string}`;
};

export interface InstallOptions {
  // import map URL
  mapUrl: URL;
  // default base for relative installs
  baseUrl: URL;
  // root URL for inport map root resolution
  rootUrl?: URL | null;
  // create a lockfile if it does not exist
  lock?: LockResolutions;
  // do not modify the lockfile
  freeze?: boolean;
  // force use latest versions for everything we touch
  latest?: boolean;

  // if a resolution is not in its expected range
  // / expected URL (usually due to manual user edits),
  // force override a new install
  reset?: boolean;

  // whether to prune the dependency installs
  prune?: boolean;

  // save flags
  save?: boolean;
  saveDev?: boolean;
  savePeer?: boolean;
  saveOptional?: boolean;

  // dependency resolutions overrides
  resolutions?: Record<string, string>;

  defaultProvider?: string;
  defaultRegistry?: string;
  providers?: Record<string, string>;
}

export class Installer {
  opts: InstallOptions;
  installs: LockResolutions;
  constraints: VersionConstraints;
  installing = false;
  newInstalls = false;
  // @ts-ignore
  installBaseUrl: `${string}/`;
  added = new Map<string, InstallTarget>();
  hasLock = false;
  defaultProvider = { provider: "jspm", layer: "default" };
  defaultRegistry = "npm";
  providers: Record<string, string>;
  resolutions: Record<string, string>;
  log: Log;
  resolver: Resolver;

  constructor(
    baseUrl: `${string}/`,
    opts: InstallOptions,
    log: Log,
    resolver: Resolver
  ) {
    this.log = log;
    this.resolver = resolver;
    this.resolutions = opts.resolutions || {};
    this.installBaseUrl = baseUrl;
    this.opts = opts;
    this.hasLock = !!opts.lock;
    this.installs = opts.lock || {
      primary: Object.create(null),
      secondary: Object.create(null),
      flattened: Object.create(null),
    };
    this.constraints = {
      primary: Object.create(null),
      secondary: Object.create(null),
    };
    if (opts.defaultRegistry) this.defaultRegistry = opts.defaultRegistry;
    if (opts.defaultProvider)
      this.defaultProvider = {
        provider: opts.defaultProvider.split(".")[0],
        layer: opts.defaultProvider.split(".")[1] || "default",
      };
    this.providers = Object.assign({}, registryProviders);
    if (opts.providers) Object.assign(this.providers, opts.providers);
  }

  visitInstalls(
    visitor: (
      scope: Record<string, InstalledResolution>,
      scopeUrl: string | null
    ) => boolean | void
  ) {
    if (visitor(this.installs.primary, null)) return;
    for (const scopeUrl of Object.keys(this.installs.secondary)) {
      if (visitor(this.installs.secondary[scopeUrl], scopeUrl)) return;
    }
  }

  startInstall() {
    if (this.installing) throw new Error("Internal error: already installing");
    this.installing = true;
    this.newInstalls = false;
    this.added = new Map<string, InstallTarget>();
  }

  finishInstall() {
    this.installing = false;
  }

  getProvider(target: PackageTarget) {
    let provider = this.defaultProvider;
    for (const name of Object.keys(this.providers)) {
      if (
        (name.endsWith(":") && target.registry === name.slice(0, -1)) ||
        (target.name.startsWith(name) &&
          (target.name.length === name.length ||
            target.name[name.length] === "/"))
      ) {
        provider = { provider: this.providers[name], layer: "default" };
        const layerIndex = provider.provider.indexOf(".");
        if (layerIndex !== -1) {
          provider.layer = provider.provider.slice(layerIndex + 1);
          provider.provider = provider.provider.slice(0, layerIndex);
        }
        break;
      }
    }
    return provider;
  }

  /**
   * Installs the given installation target.
   *
   * @param {string} pkgName Name of the package being installed.
   * @param {InstallTarget} target The installation target being installed.
   * @param {`./${string}` | '.'} traceSubpath
   * @param {ResolutionMode} mode Specifies how to interact with existing installs.
   * @param {`${string}/` | null} pkgScope URL of the package scope in which this install is occurring, null if it's a top-level install.
   * @param {string} parentUrl URL of the parent for this install.
   * @returns {Promise<InstalledResolution>}
   */
  async installTarget(
    pkgName: string,
    { pkgTarget, installSubpath }: InstallTarget,
    traceSubpath: `./${string}` | ".",
    mode: ResolutionMode,
    pkgScope: `${string}/` | null,
    parentUrl: string
  ): Promise<InstalledResolution> {
    if (this.opts.freeze && mode === "existing")
      throw new JspmError(
        `"${pkgName}" is not installed in the current map to freeze install, imported from ${parentUrl}.`,
        "ERR_NOT_INSTALLED"
      );

    // Resolutions are always authoritative, and override the existing target:
    if (this.resolutions[pkgName]) {
      const resolutionTarget = newPackageTarget(
        this.resolutions[pkgName],
        this.opts.baseUrl,
        this.defaultRegistry,
        pkgName
      );
      resolutionTarget.installSubpath = installSubpath;
      if (
        JSON.stringify(pkgTarget) !== JSON.stringify(resolutionTarget.pkgTarget)
      )
        return this.installTarget(
          pkgName,
          resolutionTarget,
          traceSubpath,
          mode,
          pkgScope,
          parentUrl
        );
    }

    if (pkgTarget instanceof URL) {
      this.log("installer/installTarget", `${pkgName} ${pkgScope} -> ${pkgTarget.href} (URL)`);
      const installUrl = (pkgTarget.href +
        (pkgTarget.href.endsWith("/") ? "" : "/")) as `${string}/`;
      this.newInstalls = setResolution(
        this.installs,
        pkgName,
        installUrl,
        pkgScope,
        installSubpath
      );
      return { installUrl, installSubpath };
    }

    const provider = this.getProvider(pkgTarget);

    if (
      (this.opts.freeze || mode.includes("existing") || pkgScope !== null) &&
      !this.opts.latest
    ) {
      const pkg = this.getBestExistingMatch(pkgTarget);
      if (pkg) {
        this.log(
          "installer/installTarget",
          `${pkgName} ${pkgScope} -> ${pkg} (existing match)`
        );
        const installUrl = this.resolver.pkgToUrl(pkg, provider);
        this.newInstalls = setResolution(
          this.installs,
          pkgName,
          installUrl,
          pkgScope,
          installSubpath
        );
        setConstraint(this.constraints, pkgName, pkgTarget, pkgScope);
        return { installUrl, installSubpath };
      }
    }

    const latestPkg = await this.resolver.resolveLatestTarget(
      pkgTarget,
      provider,
      parentUrl
    );

    const pkgUrl = this.resolver.pkgToUrl(latestPkg, provider);
    const installed = getInstallsFor(
      this.constraints,
      latestPkg.registry,
      latestPkg.name
    );
    if (
      !this.opts.freeze &&
      latestPkg &&
      !this.tryUpgradeAllTo(latestPkg, pkgUrl, installed)
    ) {
      if (pkgScope && !this.opts.latest) {
        const pkg = this.getBestExistingMatch(pkgTarget);
        // cannot upgrade to latest -> stick with existing resolution (if compatible)
        if (pkg) {
          this.log(
            "installer/installTarget",
            `${pkgName} ${pkgScope} -> ${latestPkg} (existing match not latest)`
          );
          const installUrl = this.resolver.pkgToUrl(pkg, provider);
          this.newInstalls = setResolution(
            this.installs,
            pkgName,
            installUrl,
            pkgScope,
            installSubpath
          );
          setConstraint(this.constraints, pkgName, pkgTarget, pkgScope);
          return { installUrl, installSubpath };
        }
      }
    }

    this.log(
      "installer/installTarget",
      `${pkgName} ${pkgScope} -> ${pkgUrl} ${
        installSubpath ? installSubpath : "<no-subpath>"
      } (latest)`
    );
    this.newInstalls = setResolution(
      this.installs,
      pkgName,
      pkgUrl,
      pkgScope,
      installSubpath
    );
    setConstraint(this.constraints, pkgName, pkgTarget, pkgScope);
    this.upgradeSupportedTo(latestPkg, pkgUrl, installed);
    return { installUrl: pkgUrl, installSubpath };
  }

  /**
   * Installs the given package specifier.
   *
   * @param {string} pkgName The package specifier being installed.
   * @param {ResolutionMode} mode Specifies how to interact with existing installs.
   * @param {`${string}/` | null} pkgScope URL of the package scope in which this install is occurring, null if it's a top-level install.
   * @param {`./${string}` | '.'} traceSubpath
   * @param {string} parentUrl URL of the parent for this install.
   * @returns {Promise<string | InstalledResolution>}
   */
  async install(
    pkgName: string,
    mode: ResolutionMode,
    pkgScope: `${string}/` | null = null,
    traceSubpath: `./${string}` | ".",
    parentUrl: string = this.installBaseUrl
  ): Promise<string | InstalledResolution> {
    this.log("installer/install", `installing ${pkgName} from ${parentUrl} in scope ${pkgScope}`);

    if (!this.installing) throwInternalError("Not installing");

    if (this.resolutions[pkgName])
      return this.installTarget(
        pkgName,
        newPackageTarget(
          this.resolutions[pkgName],
          this.opts.baseUrl,
          this.defaultRegistry,
          pkgName
        ),
        traceSubpath,
        mode,
        pkgScope,
        parentUrl
      );

    if (!this.opts.reset) {
      const existingResolution = getResolution(
        this.installs,
        pkgName,
        pkgScope
      );
      if (existingResolution) {
        this.log("installer/install", `existing lock for ${pkgName} from ${parentUrl} in scope ${pkgScope} is ${existingResolution}`);
        return existingResolution;
      }

      // flattened resolution cascading for secondary
      if (
        (pkgScope && mode.includes("existing") && !this.opts.latest) ||
        (pkgScope && mode.includes("new") && this.opts.freeze)
      ) {
        const flattenedResolution = getFlattenedResolution(
          this.installs,
          pkgName,
          pkgScope,
          traceSubpath
        );

        // resolved flattened resolutions become real resolutions as they get picked up
        if (flattenedResolution) {
          this.newInstalls = setResolution(
            this.installs,
            pkgName,
            flattenedResolution.installUrl,
            pkgScope,
            flattenedResolution.installSubpath
          );
          return flattenedResolution;
        }
      }
    }

    const definitelyPkgScope =
      pkgScope || (await this.resolver.getPackageBase(parentUrl));
    const pcfg =
      (await this.resolver.getPackageConfig(definitelyPkgScope)) || {};

    // package dependencies
    const isRootInstall = (!pkgScope && parentUrl === this.installBaseUrl) || pkgScope === this.installBaseUrl;
    const installTarget =
      pcfg.dependencies?.[pkgName] ||
      pcfg.peerDependencies?.[pkgName] ||
      pcfg.optionalDependencies?.[pkgName] ||
      (isRootInstall && pcfg.devDependencies?.[pkgName]);
    if (installTarget) {
      const target = newPackageTarget(
        installTarget,
        new URL(definitelyPkgScope),
        this.defaultRegistry,
        pkgName
      );
      return this.installTarget(
        pkgName,
        target,
        traceSubpath,
        mode,
        pkgScope,
        parentUrl
      );
    }

    const specifier = pkgName + (traceSubpath ? traceSubpath.slice(1) : "");
    const builtin = this.resolver.resolveBuiltin(specifier);
    if (builtin) {
      if (typeof builtin === "string") return builtin;
      return this.installTarget(
        specifier,
        builtin.target,
        traceSubpath,
        mode,
        pkgScope,
        parentUrl
      );
    }

    // existing primary version fallback
    if (this.installs.primary[pkgName]) {
      const { installUrl } = getResolution(this.installs, pkgName, null);
      return { installUrl, installSubpath: null };
    }

    // global install fallback
    const target = newPackageTarget(
      "*",
      new URL(definitelyPkgScope),
      this.defaultRegistry,
      pkgName
    );
    const { installUrl } = await this.installTarget(
      pkgName,
      target,
      null,
      mode,
      pkgScope,
      parentUrl
    );
    return { installUrl, installSubpath: null };
  }

  // Note: maintain this live instead of recomputing
  private get pkgUrls() {
    const pkgUrls = new Set<string>();
    for (const pkgUrl of Object.values(this.installs.primary)) {
      pkgUrls.add(pkgUrl.installUrl);
    }
    for (const scope of Object.keys(
      this.installs.secondary
    ) as `${string}/`[]) {
      for (const { installUrl } of Object.values(
        this.installs.secondary[scope]
      )) {
        pkgUrls.add(installUrl);
      }
    }
    for (const flatScope of Object.keys(
      this.installs.flattened
    ) as `${string}/`[]) {
      for (const {
        resolution: { installUrl },
      } of Object.values(this.installs.flattened[flatScope]).flat()) {
        pkgUrls.add(installUrl);
      }
    }
    return pkgUrls;
  }

  private getBestExistingMatch(matchPkg: PackageTarget): ExactPackage | null {
    let bestMatch: ExactPackage | null = null;
    for (const pkgUrl of this.pkgUrls) {
      const pkg = this.resolver.parseUrlPkg(pkgUrl);
      if (pkg && this.inRange(pkg.pkg, matchPkg)) {
        if (bestMatch)
          bestMatch =
            Semver.compare(new Semver(bestMatch.version), pkg.pkg.version) ===
            -1
              ? pkg.pkg
              : bestMatch;
        else bestMatch = pkg.pkg;
      }
    }
    return bestMatch;
  }

  private inRange(pkg: ExactPackage, target: PackageTarget) {
    return (
      pkg.registry === target.registry &&
      pkg.name === target.name &&
      target.ranges.some((range) => range.has(pkg.version, true))
    );
  }

  // upgrade all existing packages to this package if possible
  private tryUpgradeAllTo(
    pkg: ExactPackage,
    pkgUrl: `${string}/`,
    installed: PackageInstall[]
  ): boolean {
    const pkgVersion = new Semver(pkg.version);

    let allCompatible = true;
    for (const { ranges } of installed) {
      if (ranges.every((range) => !range.has(pkgVersion)))
        allCompatible = false;
    }

    if (!allCompatible) return false;

    // if every installed version can support this new version, update them all
    for (const { alias, pkgScope } of installed) {
      const resolution = getResolution(this.installs, alias, pkgScope);
      if (!resolution) continue;
      const { installSubpath } = resolution;
      this.newInstalls = setResolution(
        this.installs,
        alias,
        pkgUrl,
        pkgScope,
        installSubpath
      );
    }

    return true;
  }

  // upgrade some exsiting packages to the new install
  private upgradeSupportedTo(
    pkg: ExactPackage,
    pkgUrl: `${string}/`,
    installed: PackageInstall[]
  ) {
    const pkgVersion = new Semver(pkg.version);
    for (const { alias, pkgScope, ranges } of installed) {
      const resolution = getResolution(this.installs, alias, pkgScope);
      if (!resolution) continue;
      if (!ranges.some((range) => range.has(pkgVersion, true))) continue;
      const { installSubpath } = resolution;
      this.newInstalls = setResolution(
        this.installs,
        alias,
        pkgUrl,
        pkgScope,
        installSubpath
      );
    }
  }
}
