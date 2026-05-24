#!/usr/bin/env node
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function fail(message) {
  console.error(`generate-sbom: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = { outputDir: "dist/release-sbom" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length || argv[index].startsWith("--")) fail(`${arg} requires a value`);
      return argv[index];
    };

    if (arg === "--output-dir") options.outputDir = next();
    else if (arg === "--build-commit") options.buildCommit = next();
    else fail(`Unknown argument: ${arg}`);
  }
  return options;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function getBuildCommit(explicitCommit) {
  if (explicitCommit) return explicitCommit;
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
}

function stripVersionRange(version) {
  return String(version).replace(/^[~^<>=\s]+/, "");
}

function packageComponent(name, version, scope) {
  return {
    type: "library",
    name,
    version: stripVersionRange(version),
    scope,
    purl: `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(stripVersionRange(version))}`,
  };
}

function parseCargoDependencies(cargoToml) {
  const dependencies = [];
  const dependencyBlock = cargoToml.match(/\[dependencies\]\n([\s\S]*?)(?:\n\[|$)/)?.[1] ?? "";
  for (const rawLine of dependencyBlock.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const simpleMatch = line.match(/^([A-Za-z0-9_-]+)\s*=\s*"([^"]+)"/);
    const tableMatch = line.match(/^([A-Za-z0-9_-]+)\s*=\s*\{[^}]*version\s*=\s*"([^"]+)"/);
    const match = tableMatch ?? simpleMatch;
    if (!match) continue;
    dependencies.push({ name: match[1], version: stripVersionRange(match[2]) });
  }
  return dependencies;
}

function parsePythonDependencyName(specifier) {
  return specifier.split(/[<>=~!\[;\s]/)[0].trim();
}

function parsePythonDependencyVersion(specifier) {
  return specifier.match(/[<>=~!]+\s*([0-9][A-Za-z0-9_.+-]*)/)?.[1] ?? "unspecified";
}

function parsePyprojectDependencyArrays(pyproject) {
  const entries = [];
  const projectDeps = pyproject.match(/^dependencies\s*=\s*\[([\s\S]*?)\]\n/m)?.[1] ?? "";
  entries.push(...extractQuotedList(projectDeps).map((dependency) => ({ dependency, scope: "required" })));

  const optionalSection = pyproject.match(/\[project\.optional-dependencies\]\n([\s\S]*?)(?:\n\[|$)/)?.[1] ?? "";
  for (const [, block] of optionalSection.matchAll(/^\w+\s*=\s*\[([\s\S]*?)\]/gm)) {
    for (const dependency of extractQuotedList(block)) {
      entries.push({ dependency, scope: "optional" });
    }
  }
  return entries;
}

function extractQuotedList(block) {
  return [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function cyclonedxBom({ serialSuffix, metadataComponent, components, sourceManifests }) {
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber: `urn:uuid:characterforge-ai-${serialSuffix}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [{ vendor: "CharacterForge AI", name: "scripts/generate-sbom.mjs" }],
      component: metadataComponent,
      properties: sourceManifests.map((path) => ({ name: "source-manifest", value: path })),
    },
    components,
  };
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const options = parseArgs(process.argv.slice(2));
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = resolve(options.outputDir);
const generatedAtUtc = new Date().toISOString();
const buildCommit = getBuildCommit(options.buildCommit);

const dashboardPackagePath = resolve(repoRoot, "apps/dashboard/package.json");
const sdkPackagePath = resolve(repoRoot, "sdk/typescript/package.json");
const cargoManifestPath = resolve(repoRoot, "apps/dashboard/src-tauri/Cargo.toml");
const pyprojectPath = resolve(repoRoot, "pyproject.toml");
for (const requiredPath of [dashboardPackagePath, sdkPackagePath, cargoManifestPath, pyprojectPath]) {
  if (!existsSync(requiredPath)) fail(`required manifest not found: ${requiredPath}`);
}

const dashboardPackage = readJson(dashboardPackagePath);
const sdkPackage = readJson(sdkPackagePath);
const npmComponents = [];
for (const manifest of [dashboardPackage, sdkPackage]) {
  for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
    npmComponents.push(packageComponent(name, version, "required"));
  }
  for (const [name, version] of Object.entries(manifest.devDependencies ?? {})) {
    npmComponents.push(packageComponent(name, version, "optional"));
  }
}
const dedupedNpmComponents = [...new Map(npmComponents.map((component) => [`${component.name}@${component.version}`, component])).values()].sort((left, right) => left.name.localeCompare(right.name));

const cargoToml = readFileSync(cargoManifestPath, "utf8");
const cargoPackageName = cargoToml.match(/^name\s*=\s*"([^"]+)"/m)?.[1] ?? "characterforgeai";
const cargoPackageVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? "0.0.0";
const rustComponents = parseCargoDependencies(cargoToml).map(({ name, version }) => ({
  type: "library",
  name,
  version,
  scope: "required",
  purl: `pkg:cargo/${encodeURIComponent(name)}@${encodeURIComponent(version)}`,
}));

const pyproject = readFileSync(pyprojectPath, "utf8");
const pythonPackageName = pyproject.match(/^name\s*=\s*"([^"]+)"/m)?.[1] ?? "characterforge-ai";
const pythonPackageVersion = pyproject.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? "0.0.0";
const pythonComponents = parsePyprojectDependencyArrays(pyproject).map(({ dependency, scope }) => {
  const name = parsePythonDependencyName(dependency);
  const version = parsePythonDependencyVersion(dependency);
  return {
    type: "library",
    name,
    version,
    scope,
    purl: `pkg:pypi/${encodeURIComponent(name)}@${encodeURIComponent(version)}`,
  };
}).sort((left, right) => left.name.localeCompare(right.name));

const sourceManifests = [
  relative(repoRoot, dashboardPackagePath),
  relative(repoRoot, sdkPackagePath),
  relative(repoRoot, cargoManifestPath),
  relative(repoRoot, pyprojectPath),
].map((path) => path.replaceAll("\\", "/"));

const sboms = [
  {
    fileName: "characterforgeai-npm.cdx.json",
    bom: cyclonedxBom({
      serialSuffix: "npm",
      metadataComponent: { type: "application", name: "characterforge-ai npm workspace", version: dashboardPackage.version ?? "0.0.0" },
      components: dedupedNpmComponents,
      sourceManifests: sourceManifests.slice(0, 2),
    }),
  },
  {
    fileName: "characterforgeai-rust.cdx.json",
    bom: cyclonedxBom({
      serialSuffix: "rust",
      metadataComponent: { type: "application", name: cargoPackageName, version: cargoPackageVersion },
      components: rustComponents,
      sourceManifests: [relative(repoRoot, cargoManifestPath).replaceAll("\\", "/")],
    }),
  },
  {
    fileName: "characterforgeai-python.cdx.json",
    bom: cyclonedxBom({
      serialSuffix: "python",
      metadataComponent: { type: "application", name: pythonPackageName, version: pythonPackageVersion },
      components: pythonComponents,
      sourceManifests: [relative(repoRoot, pyprojectPath).replaceAll("\\", "/")],
    }),
  },
];

for (const { fileName, bom } of sboms) {
  writeJson(resolve(outputDir, fileName), bom);
}

writeJson(resolve(outputDir, "release-provenance.json"), {
  schemaVersion: 1,
  generatedAtUtc,
  buildCommit,
  generator: "scripts/generate-sbom.mjs",
  sboms: sboms.map(({ fileName }) => fileName),
  sourceManifests,
});

console.log(`Wrote ${sboms.length} SBOM(s) and release provenance to ${outputDir}`);
