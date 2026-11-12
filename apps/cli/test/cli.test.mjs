import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { buildConfig, validHost, validIp, validUser } from "../src/config.mjs";
import { installSteps, publishDesktopScript, statusScript, updateScript } from "../src/steps.mjs";
import { sshArgs, shellQuote } from "../src/ssh.mjs";
import { findLatestRelease, pickInstallerAssets } from "../src/desktop.mjs";

const ok = { ip: "203.0.113.10", domain: "SeuDominio.com", user: "ubuntu" };
/** @returns {import("../src/config.mjs").Config} */
const cfgOf = (/** @type {Record<string, any>} */ o) => {
  const r = buildConfig(o);
  if (!r.cfg) throw new Error(r.error);
  return r.cfg;
};
const bash = (/** @type {string} */ script) => execFileSync("bash", ["-n"], { input: script });

test("valida entradas", () => {
  assert.ok(validIp("203.0.113.10") && !validIp("999.1.1.1") && !validIp("a.b.c.d"));
  assert.ok(validHost("app.exemplo.com") && !validHost("exemplo") && !validHost("1.2.3.4") && !validHost("a;rm -rf /.com"));
  assert.ok(validUser("ubuntu") && !validUser("a b") && !validUser("x;y"));
});

test("monta a configuração com os domínios padrão", () => {
  const { cfg } = buildConfig(ok);
  assert.equal(cfg?.app, "app.seudominio.com");
  assert.equal(cfg?.lk, "lk.seudominio.com");
  assert.equal(cfg?.port, "22");
  assert.equal(cfg?.firewall, true);
});

test("recusa entradas perigosas", () => {
  for (const bad of [{ ip: "1.2.3.4; id" }, { domain: "x.com; id" }, { user: "root;id" }, { port: "22;id" }, { app: "a.com", lk: "a.com" }, { key: "k\nx" }]) {
    assert.ok(buildConfig({ ...ok, ...bad }).error, JSON.stringify(bad));
  }
});

test("firewall libera a porta do SSH antes de ligar; --no-firewall pula o passo", () => {
  const cfg = cfgOf({ ...ok, port: "2222" });
  const fw = installSteps(cfg).find((s) => s.id === "firewall")?.script ?? "";
  assert.ok(fw.indexOf("allow 2222/tcp") < fw.indexOf("enable"));
  const no = cfgOf({ ...ok, firewall: false });
  assert.ok(!installSteps(no).some((s) => s.id === "firewall"));
});

test("scripts remotos têm sintaxe bash válida e usam os domínios validados", () => {
  const cfg = cfgOf(ok);
  for (const s of installSteps(cfg)) bash(s.script);
  for (const s of [updateScript(cfg), statusScript(cfg), publishDesktopScript(cfg)]) bash(s);
  const run = installSteps(cfg).find((s) => s.id === "subir")?.script ?? "";
  assert.match(run, /install\.sh app\.seudominio\.com lk\.seudominio\.com --up/);
  assert.match(run, /grep -v "BOOTSTRAP_INVITE/);
  assert.match(run, /exit "\$rc"/); // falha do install.sh não pode ser engolida pelo filtro
});

test("ssh só com chave (BatchMode) e shellQuote preserva aspas", () => {
  const cfg = cfgOf({ ...ok, key: "/k/id" });
  const a = sshArgs(cfg, "bash -s");
  assert.ok(a.includes("BatchMode=yes") && a.includes("-i") && a.at(-2) === "ubuntu@203.0.113.10");
  assert.equal(shellQuote("it's"), `'it'\\''s'`);
});

test("acha o trio do instalador nas releases", async () => {
  const assets = [
    { name: "latest.yml", url: "u1" },
    { name: "Turtle-Setup-0.4.0.exe", url: "u2" },
    { name: "Turtle-Setup-0.4.0.exe.blockmap", url: "u3" },
  ];
  assert.ok(pickInstallerAssets(assets));
  assert.equal(pickInstallerAssets(assets.slice(0, 2)), null);
  const fake = async () => new Response(JSON.stringify([
    { tag_name: "cli-v0.1.0", assets: [] },
    { tag_name: "desktop-v0.4.0", assets: assets.map((a) => ({ name: a.name, browser_download_url: a.url })) },
  ]));
  const rel = await findLatestRelease(/** @type {any} */ (fake));
  assert.equal(rel?.tag, "desktop-v0.4.0");
});
