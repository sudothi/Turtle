// Gera o executável único (Node Single Executable Application) a partir de dist/turtle-setup.cjs.
// Saída: release/turtle-setup-<plataforma>-<arquitetura>[.exe]. Roda no mesmo sistema do alvo.
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("..", import.meta.url));
const out = join(root, "release");
mkdirSync(out, { recursive: true });

/** @type {Record<string, string>} */
const names = { win32: "windows", darwin: "macos", linux: "linux" };
const plat = names[process.platform] ?? process.platform;
const name = `turtle-setup-${plat}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`;
const bin = join(out, name);
const blob = join(out, "sea.blob");

writeFileSync(join(out, "sea-config.json"), JSON.stringify({ main: join(root, "dist", "turtle-setup.cjs"), output: blob, disableExperimentalSEAWarning: true }));
execFileSync(process.execPath, ["--experimental-sea-config", join(out, "sea-config.json")], { stdio: "inherit" });
copyFileSync(process.execPath, bin);
if (process.platform === "darwin") execFileSync("codesign", ["--remove-signature", bin]);

const postject = require.resolve("postject/dist/cli.js");
execFileSync(
  process.execPath,
  [postject, bin, "NODE_SEA_BLOB", blob, "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2", ...(process.platform === "darwin" ? ["--macho-segment-name", "NODE_SEA"] : [])],
  { stdio: "inherit" },
);
if (process.platform === "darwin") execFileSync("codesign", ["--sign", "-", bin]);
console.log(`ok: ${bin}`);
