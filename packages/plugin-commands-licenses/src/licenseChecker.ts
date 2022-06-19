/* eslint-disable @typescript-eslint/no-explicit-any */
import { Lockfile } from "@pnpm/lockfile-file";
import { nameVerFromPkgSnapshot } from "@pnpm/lockfile-utils";
import {
  lockfileWalkerGroupImporterSteps,
  LockfileWalkerStep,
  LockedDependency
} from "@pnpm/lockfile-walker";
import { safeReadProjectManifestOnly } from "@pnpm/read-project-manifest";
import * as dp from "dependency-path";
import { DependenciesField } from "@pnpm/types";
import * as path from "node:path";
import {
  LicenseComplianceNode,
  LicenseComplianceTree,
  LicenseComplianceReport,
  PackageDetails
} from "./types";
import { parseLicense } from "./utils";

interface LicenseCheckOptions {
  include?: { [dependenciesField in DependenciesField]: boolean };
  dir: string;
  virtualStoreDir: string;
}

/**
 * @private
 * Returns the details of the package dependency
 * @param dep the dependency
 * @param options the configuration options
 * @returns { name: string, version: string, path: string, manifest: PackageManifest }
 */
async function getPackageDetails(
  dep: LockedDependency,
  options: LicenseCheckOptions
): Promise<PackageDetails> {
  const { depPath, pkgSnapshot } = dep;
  const { name, version } = nameVerFromPkgSnapshot(depPath, pkgSnapshot);

  // construct the path the dependency so we have a location where we can
  // read the package.json file to later extract the license-field from
  const virtualStoreDir = path.join(options.dir, options.virtualStoreDir);
  const modules = path.join(
    virtualStoreDir,
    dp.depPathToFilename(depPath),
    "node_modules"
  );
  const dir = path.join(modules, name);

  // Read the package manifest file
  const manifest = (await safeReadProjectManifestOnly(dir)) ?? {};
  return {
    name,
    version,
    path: dir,
    manifest
  };
}

/**
 * Reads a PNPM lock file and checks each dependency defined
 * in this file for the license
 *
 * @param lockfile the lock file to read
 * @param opts the options for the checker
 * @returns Promise<LicenseComplianceReport>
 */
export default async function licenseCheck(
  lockfile: Lockfile,
  opts: LicenseCheckOptions
): Promise<LicenseComplianceReport> {
  const auditTree = await lockfileToData(lockfile, opts);

  Object.keys(auditTree.dependencies ?? {}).forEach(dependency => {
    const dependencyInfo = auditTree.dependencies![dependency];
    if (dependencyInfo.dependencies) {
      Object.keys(dependencyInfo.dependencies).forEach(item => {
        const dependencyData = dependencyInfo.dependencies![item];
        console.log(`Item dependency for ${item}:`, dependencyData);
      });
    }
  });

  const licenseComplianceReport: LicenseComplianceReport = {
    licenses: {},
    metadata: {
      totalDependencies: 0,
      dependencies: 0,
      devDependencies: 0,
      optionalDependencies: 0
    }
  };

  return licenseComplianceReport;
}

/**
 * @private
 * Converts a lockfile entry into a license compliance node
 */
async function lockfileToLicenseComplianceNode(
  step: LockfileWalkerStep,
  options: LicenseCheckOptions
) {
  const dependencies = {};
  for (const dependency of step.dependencies) {
    const { depPath, pkgSnapshot, next } = dependency;
    const { name, version } = nameVerFromPkgSnapshot(depPath, pkgSnapshot);
    const subdeps = await lockfileToLicenseComplianceNode(next(), options);
    const packageDetails = await getPackageDetails(dependency, options);

    const licenseInfo = await parseLicense({
      manifest: packageDetails.manifest,
      path: packageDetails.path
    });

    const dep: LicenseComplianceNode = {
      dev: pkgSnapshot.dev === true,
      integrity: pkgSnapshot.resolution["integrity"],
      licenseInfo,
      version
    };

    if (Object.keys(subdeps).length > 0) {
      dep.dependencies = subdeps;
      dep.requires = toRequires(subdeps);
    }
    dependencies[name] = dep;
  }
  return dependencies;
}

function toRequires(nodesByDepName: Record<string, LicenseComplianceNode>) {
  const requires = {};
  for (const subdepName of Object.keys(nodesByDepName)) {
    requires[subdepName] = nodesByDepName[subdepName].version;
  }
  return requires;
}

/**
 * @private
 */
export async function lockfileToData(
  lockfile: Lockfile,
  opts: LicenseCheckOptions
): Promise<LicenseComplianceTree> {
  const importerWalkers = lockfileWalkerGroupImporterSteps(
    lockfile,
    Object.keys(lockfile.importers),
    { include: opts?.include }
  );
  const dependencies = {};

  for (const importerWalker of importerWalkers) {
    const importerDeps = await lockfileToAuditNode(importerWalker.step, opts);
    const depName = importerWalker.importerId;
    dependencies[depName] = {
      dependencies: importerDeps,
      requires: toRequires(importerDeps),
      version: "0.0.0"
    };
  }

  const licenseComplianceTree: LicenseComplianceTree = {
    name: undefined,
    version: undefined,
    dependencies,
    dev: false,
    install: [],
    integrity: undefined,
    metadata: {},
    remove: [],
    requires: toRequires(dependencies)
  };

  return licenseComplianceTree;
}
