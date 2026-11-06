import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, cpSync, existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "release");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const run = (command, args, cwd = root) => {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", env: { ...process.env, CI: "1" } });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};

// Build local sources into a release app. AltStore supplies each user's signing identity.
run("pnpm", ["--filter", "@turtle/protocol", "build"]);
run("pnpm", ["exec", "expo", "prebuild", "--platform", "ios", "--no-install"]);
run("pod", ["install"], join(root, "ios"));
mkdirSync(output, { recursive: true });
const archive = join(output, "Turtle.xcarchive");
run("xcodebuild", [
  "-workspace", "ios/Turtle.xcworkspace", "-scheme", "Turtle", "-configuration", "Release",
  "-destination", "generic/platform=iOS", "-archivePath", archive,
  "CODE_SIGNING_ALLOWED=NO", "archive",
]);
const app = join(archive, "Products/Applications/Turtle.app");
if (!existsSync(app)) throw new Error("O archive não gerou Turtle.app.");
const staging = mkdtempSync(join(output, "package-"));
const payload = join(staging, "Payload");
mkdirSync(payload);
cpSync(app, join(payload, "Turtle.app"), { recursive: true });
const ipa = join(output, `Turtle-${version}.ipa`);
run("ditto", ["-c", "-k", "--keepParent", "Payload", ipa], staging);
console.log(`\nIPA para importação/reassinatura na AltStore Classic: ${ipa}`);
console.log("Validar instalação, renovação e entitlements no iPhone. O archive não possui assinatura de distribuição.");
