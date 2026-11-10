import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, cpSync, existsSync, readFileSync, writeFileSync, rmSync, createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "release");
const { version, iosBuildNumber } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (process.platform !== "darwin") throw new Error("Gere o IPA em macOS com Xcode e CocoaPods.");
if (!/^\d+\.\d+\.\d+$/.test(version) || !/^\d+$/.test(iosBuildNumber)) throw new Error("Versão ou build iOS inválido.");
const ipa = join(output, `Turtle-${version}-build${iosBuildNumber}.ipa`);
if ([ipa, `${ipa}.sha256`, `${ipa}.json`].some(existsSync)) throw new Error("Já existe um artefato deste build. Incremente iosBuildNumber para preservar a entrega anterior.");
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
const plist = key => execFileSync("plutil", ["-extract", key, "raw", "-o", "-", join(app, "Info.plist")], { encoding: "utf8" }).trim();
if (plist("CFBundleShortVersionString") !== version || plist("CFBundleVersion") !== iosBuildNumber) throw new Error("Versão do archive não corresponde ao pacote.");
if (!plist("NSMicrophoneUsageDescription") || !plist("NSCameraUsageDescription")) throw new Error("Archive sem descrições de permissão.");
const staging = mkdtempSync(join(output, "package-"));
const payload = join(staging, "Payload");
mkdirSync(payload);
cpSync(app, join(payload, "Turtle.app"), { recursive: true });
try { run("ditto", ["-c", "-k", "--keepParent", "Payload", ipa], staging); }
finally { rmSync(staging, { recursive: true, force: true }); }
const hash = createHash("sha256");
for await (const chunk of createReadStream(ipa)) hash.update(chunk);
const sha256 = hash.digest("hex");
writeFileSync(`${ipa}.sha256`, `${sha256}  ${ipa.split("/").at(-1)}\n`);
writeFileSync(`${ipa}.json`, JSON.stringify({ version, build: iosBuildNumber, bundleIdentifier: plist("CFBundleIdentifier"), minimumIOS: plist("MinimumOSVersion"), sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), sourceDirty: !!execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], { cwd: root, encoding: "utf8" }).trim(), sha256, signed: false, distribution: "Importar e reassinar pela AltStore Classic; aceite em aparelho pendente." }, null, 2) + "\n");
console.log(`\nIPA para importação/reassinatura na AltStore Classic: ${ipa}`);
console.log("Validar instalação, renovação e entitlements no iPhone. O archive não possui assinatura de distribuição.");
