import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const dashboardDir = resolve(scriptDir, "..");
const repoRoot = resolve(dashboardDir, "..", "..");
const nsisDir = join(dashboardDir, "src-tauri", "target", "release", "bundle", "nsis");
const outputDir = join(repoRoot, "dist");
const outputPath = join(outputDir, "characterforgeai-installer.exe");

function fail(message) {
  console.error(`stage-windows-installer: ${message}`);
  process.exit(1);
}

if (!existsSync(nsisDir)) {
  fail(`NSIS bundle directory not found: ${nsisDir}. Run npm run desktop:build on Windows first.`);
}

const installers = readdirSync(nsisDir)
  .filter((entry) => entry.toLowerCase().endsWith(".exe"))
  .map((entry) => {
    const path = join(nsisDir, entry);
    return { path, name: entry, mtimeMs: statSync(path).mtimeMs };
  })
  .sort((left, right) => right.mtimeMs - left.mtimeMs);

if (installers.length === 0) {
  fail(`No NSIS .exe installers found in ${nsisDir}. Run npm run desktop:build on Windows first.`);
}

mkdirSync(outputDir, { recursive: true });
copyFileSync(installers[0].path, outputPath);

console.log(`Staged ${basename(installers[0].path)} as ${outputPath}`);
