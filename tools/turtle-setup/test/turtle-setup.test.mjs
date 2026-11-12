import test from "node:test";
import assert from "node:assert/strict";
import { buildConfig, buildSteps, sshArgs, validIp, validHost, validUser } from "../turtle-setup.mjs";

const ok = { ip: "203.0.113.10", domain: "SeuDominio.com", user: "ubuntu" };

test("valida entradas", () => {
  assert.ok(validIp("203.0.113.10"));
  assert.ok(!validIp("999.1.1.1"));
  assert.ok(!validIp("a.b.c.d"));
  assert.ok(validHost("app.exemplo.com"));
  assert.ok(!validHost("exemplo"));
  assert.ok(!validHost("1.2.3.4"));
  assert.ok(!validHost("a;rm -rf /.com"));
  assert.ok(validUser("ubuntu") && !validUser("a b") && !validUser("x;y"));
});

test("monta a configuração com os domínios padrão", () => {
  const { cfg } = buildConfig(ok);
  assert.equal(cfg.app, "app.seudominio.com");
  assert.equal(cfg.lk, "lk.seudominio.com");
  assert.equal(cfg.port, "22");
});

test("recusa entradas perigosas", () => {
  for (const bad of [{ ip: "1.2.3.4; id" }, { domain: "x.com; id" }, { user: "root;id" }, { port: "22;id" }, { app: "a.com", lk: "a.com" }]) {
    assert.ok(buildConfig({ ...ok, ...bad }).error, JSON.stringify(bad));
  }
});

test("libera o SSH antes de ligar o firewall e respeita --no-firewall", () => {
  const { cfg } = buildConfig({ ...ok, port: "2222" });
  const fw = buildSteps(cfg).find((s) => s.id === "firewall").script;
  assert.ok(fw.indexOf("allow 2222/tcp") < fw.indexOf("enable"));
  const { cfg: no } = buildConfig({ ...ok, firewall: false });
  assert.ok(!buildSteps(no).some((s) => s.id === "firewall"));
});

test("os scripts usam os domínios validados e não imprimem o convite", () => {
  const { cfg } = buildConfig(ok);
  const run = buildSteps(cfg).find((s) => s.id === "subir").script;
  assert.match(run, /install\.sh app\.seudominio\.com lk\.seudominio\.com --up/);
  assert.match(run, /grep -v "BOOTSTRAP_INVITE/);
  assert.match(run, /exit "\$rc"/); // falha do install.sh não pode ser engolida pelo filtro
});

test("ssh só com chave (BatchMode), sem senha", () => {
  const { cfg } = buildConfig({ ...ok, key: "/k/id" });
  const a = sshArgs(cfg, "bash -s");
  assert.ok(a.includes("BatchMode=yes"));
  assert.ok(a.includes("-i") && a.at(-2) === "ubuntu@203.0.113.10");
});
