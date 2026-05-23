#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { execSync } from "node:child_process";

function fail(message) {
  console.error(`generate-release-manifest: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = { artifacts: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length || argv[index].startsWith("--")) {
        fail(`${arg} requires a value`);
      }
      return argv[index];
    };

    if (arg === "--artifact") options.artifacts.push(next());
    else if (arg === "--version") options.version = next();
    else if (arg === "--signature-json") options.signatureJson = next();
    else if (arg === "--expected-sha256") options.expectedSha256 = next().toLowerCase();
    else if (arg === "--output") options.output = next();
    else if (arg === "--markdown-output") options.markdownOutput = next();
    else if (arg === "--build-commit") options.buildCommit = next();
    else fail(`Unknown argument: ${arg}`);
  }
  return options;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function getBuildCommit(explicitCommit) {
  if (explicitCommit) return explicitCommit;
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
}

function readSignatureSummary(path) {
  if (!path) {
    return {
      signatureStatus: "unverified",
      signer: null,
      timestamp: null,
    };
  }

  const raw = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  const data = JSON.parse(raw);
  const signature = data.signature ?? {};
  return {
    signatureStatus: signature.status ?? "unverified",
    signer: signature.signerCertificateSubject ?? null,
    timestamp: signature.timestampCertificateSubject ?? null,
  };
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function formatCell(value) {
  if (value === null || value === undefined || value === "") return "Not recorded";
  return String(value).replaceAll("|", "\\|");
}

function writeMarkdown(path, manifest) {
  const rows = manifest.artifacts
    .map((artifact) => `| ${formatCell(artifact.name)} | ${artifact.sizeBytes} | \`${artifact.sha256}\` | ${formatCell(artifact.signatureStatus)} | ${formatCell(artifact.signer)} | ${formatCell(artifact.timestamp)} |`)
    .join("\n");
  const content = `# CharacterForge AI Release Manifest\n\nGenerated from final signed artifacts. Do not hand-edit checksums in public docs; regenerate this file after signing.\n\n- Version: ${manifest.version}\n- Build commit: ${manifest.buildCommit}\n- Generated at: ${manifest.generatedAtUtc}\n\n| Artifact | Size bytes | SHA-256 | Signature status | Signer | Timestamp |\n| --- | ---: | --- | --- | --- | --- |\n${rows}\n`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

const options = parseArgs(process.argv.slice(2));
if (options.artifacts.length === 0) fail("at least one --artifact is required");
if (!options.version) fail("--version is required");
if (!options.output) fail("--output is required");

const signatureSummary = readSignatureSummary(options.signatureJson);
const artifacts = options.artifacts.map((artifactPath) => {
  const resolved = resolve(artifactPath);
  if (!existsSync(resolved)) fail(`artifact not found: ${resolved}`);
  const actualSha256 = sha256(resolved);
  if (options.expectedSha256 && actualSha256 !== options.expectedSha256) {
    fail(`SHA-256 mismatch for ${resolved}. Expected ${options.expectedSha256}; got ${actualSha256}.`);
  }
  const stats = statSync(resolved);
  return {
    name: basename(resolved),
    sizeBytes: stats.size,
    sha256: actualSha256,
    signatureStatus: signatureSummary.signatureStatus,
    signer: signatureSummary.signer,
    timestamp: signatureSummary.timestamp,
  };
});

const manifest = {
  schemaVersion: 1,
  generatedAtUtc: new Date().toISOString(),
  version: options.version,
  buildCommit: getBuildCommit(options.buildCommit),
  artifacts,
};

writeJson(resolve(options.output), manifest);
if (options.markdownOutput) {
  writeMarkdown(resolve(options.markdownOutput), manifest);
}
console.log(`Wrote release manifest for ${artifacts.length} artifact(s) to ${resolve(options.output)}`);
