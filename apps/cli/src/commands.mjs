// Os comandos do Turtle Setup. Cada um recebe as opções já lidas da linha de comando.
import { resolve4 } from "node:dns/promises";
import { buildConfig, loadSaved, save } from "./config.mjs";
import { findLatestRelease, localInstallerAssets, stageInstaller, tarStream } from "./desktop.mjs";
import { run, sshHelp } from "./ssh.mjs";
import { backupScript, installSteps, inviteScript, logsScript, publishDesktopScript, statusScript, updateScript } from "./steps.mjs";
import { bold, box, dim, fail, green, info, ok, prompter, spinner, step, warn, yellow } from "./ui.mjs";

/** @typedef {import("./config.mjs").Config} Config */

/** Junta opções da linha de comando com a configuração salva e pergunta o que faltar. */
async function resolveConfig(/** @type {Record<string, any>} */ o, /** @type {ReturnType<typeof prompter>} */ p, { askDomain = true } = {}) {
  const saved = loadSaved();
  /** @type {Record<string, any>} */
  const merged = { ...saved, ...Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) };
  if (!merged.ip) merged.ip = await p.ask("IP da VPS:");
  if (!merged.user) merged.user = await p.ask("Usuário SSH (com sudo sem senha):", "ubuntu");
  if (askDomain && !merged.app && !merged.domain) merged.domain = await p.ask("Seu domínio (ex.: seudominio.com):");
  const { cfg, error } = buildConfig(merged);
  if (error) {
    fail(error);
    return null;
  }
  return cfg;
}

async function connect(/** @type {Config} */ c) {
  const s = spinner(`Conectando em ${c.user}@${c.ip}…`);
  const probe = await run(c, "echo ok", { quiet: true });
  if (probe.code !== 0) {
    s.stop(`Sem conexão SSH`, false);
    console.log(`  ${dim(probe.out.trim().split("\n").slice(-2).join("\n  "))}`);
    console.log(`  ${sshHelp(c)}`);
    return false;
  }
  s.stop(`Conectado em ${c.user}@${c.ip}`);
  return true;
}

async function dnsStatus(/** @type {Config} */ c) {
  const rows = await Promise.all([c.app, c.lk].map(async (h) => ({ h, ips: await resolve4(h).catch(() => /** @type {string[]} */ ([])) })));
  return { rows, ok: rows.every((r) => r.ips.includes(c.ip)) };
}

export async function instalar(/** @type {Record<string, any>} */ o) {
  const p = prompter(!o.yes || !!process.stdin.isTTY);
  try {
    const c = await resolveConfig(o, p);
    if (!c) return 2;
    const steps = installSteps(c);
    const total = steps.length + 3;
    console.log(`\n  App   ${bold("https://" + c.app)}\n  Voz   ${bold("https://" + c.lk)}\n  VPS   ${c.user}@${c.ip}:${c.port}${c.key ? dim(`  (chave ${c.key})`) : ""}`);
    if (o["dry-run"]) {
      for (const s of steps) console.log(`\n${bold("# " + s.title)}\n${s.script}`);
      console.log(dim("\n(dry-run: nada foi executado)"));
      return 0;
    }
    if (!o.yes) {
      const fw = c.firewall ? " e ligar o firewall (o SSH é liberado antes)" : "";
      if (!(await p.confirm(`Instalar Docker e o Turtle nessa VPS${fw}?`))) return 1;
    }

    step(1, total, "DNS");
    for (;;) {
      const d = await dnsStatus(c);
      for (const r of d.rows) (r.ips.includes(c.ip) ? ok : warn)(`${r.h} → ${r.ips.length ? r.ips.join(", ") : "sem registro"}`);
      if (d.ok) break;
      console.log(`  ${yellow("Crie registros A apontando os dois nomes para " + c.ip + ".")} ${dim("Na Cloudflare, sem proxy (nuvem cinza).")}`);
      if (o.yes) break;
      const a = (await p.ask("Enter para conferir de novo, ou 'seguir' para continuar (o HTTPS só funciona depois que propagar):")).toLowerCase();
      if (a === "seguir") break;
    }

    step(2, total, "Conexão SSH");
    if (!(await connect(c))) return 3;
    save(c);

    let n = 3;
    for (const s of steps) {
      step(n++, total, s.title);
      const r = await run(c, s.script);
      if (r.code !== 0) {
        fail(`Falhou em "${s.title}" (código ${r.code}). Corrija o que a mensagem acima indica e rode de novo: o assistente pode ser repetido sem perder nada.`);
        return 4;
      }
    }

    step(n, total, "Esperando o HTTPS responder");
    const sp = spinner(`https://${c.app}/health (certificado sendo emitido)…`);
    const healthy = await waitHealth(c.app, 3 * 60 * 1000);
    sp.stop(healthy ? `https://${c.app} está no ar` : `Ainda sem resposta em https://${c.app}. Em geral é o DNS propagando ou a porta 80/443 fechada no painel do provedor.`, healthy);

    const inv = await run(c, inviteScript(c), { quiet: true });
    const code = inv.out.trim().split("\n").pop() ?? "";
    const lines = [
      `Entre em ${bold(`https://${c.app}`)}`,
      ...(/^[a-f0-9]{8,}$/i.test(code) ? [`Conta admin: ${bold(`https://${c.app}/convite/${code}`)}`, dim("(vale só para o primeiro cadastro; não compartilhe)")] : []),
      "",
      "Depois: Configurações > Administração gera os convites para os amigos.",
      "Quem abrir o convite no celular ou no PC já cai no seu servidor.",
      "",
      `Próximos comandos:  ${dim("turtle-setup status · atualizar · desktop publicar · apps")}`,
    ];
    box(lines, "Pronto");
    if (c.firewall) info("Se a VPS tem firewall no painel do provedor, libere lá também: 22/80/443 tcp, 7881 tcp, 7882 udp, 3478 udp.");
    return 0;
  } finally {
    p.close();
  }
}

async function waitHealth(/** @type {string} */ host, /** @type {number} */ ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(`https://${host}/health`, { signal: AbortSignal.timeout(8000) });
      if (r.ok) return true;
    } catch {
      /* certificado ainda saindo ou serviço subindo */
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  return false;
}

/** Comandos simples: um script na VPS, com a saída na tela. */
async function remote(/** @type {Record<string, any>} */ o, /** @type {(c: Config) => string} */ script, title = "") {
  const p = prompter(true);
  try {
    const c = await resolveConfig(o, p);
    if (!c) return 2;
    if (!(await connect(c))) return 3;
    if (title) console.log(`\n  ${bold(title)}`);
    const r = await run(c, script(c));
    if (r.code === 0) save(c);
    return r.code === 0 ? 0 : 4;
  } finally {
    p.close();
  }
}

export const atualizar = (/** @type {Record<string, any>} */ o) => remote(o, updateScript, "Atualizando (com backup antes)");
export const status = (/** @type {Record<string, any>} */ o) => remote(o, statusScript, "Estado do servidor");
export const backup = (/** @type {Record<string, any>} */ o) => remote(o, backupScript, "Backup");
export const logs = (/** @type {Record<string, any>} */ o, /** @type {string} */ service = "app") => {
  if (!/^[a-z]+$/.test(service)) {
    fail("Serviço inválido. Use app, caddy, livekit ou postgres.");
    return Promise.resolve(2);
  }
  const n = Math.min(Math.max(Number(o.linhas ?? 100) || 100, 1), 2000);
  return remote(o, (c) => logsScript(c, service, n), `Últimas ${n} linhas de ${service}`);
};

/** Publica o instalador do Windows no servidor da pessoa (a página de download passa a oferecê-lo). */
export async function desktopPublicar(/** @type {Record<string, any>} */ o) {
  const p = prompter(true);
  try {
    const c = await resolveConfig(o, p);
    if (!c) return 2;
    let assets;
    let origem;
    if (o.de) {
      assets = localInstallerAssets(String(o.de));
      origem = `pasta ${o.de}`;
      if (!assets) {
        fail(`Em ${o.de} precisa haver Turtle-Setup-<versão>.exe, o .blockmap e o latest.yml.`);
        return 2;
      }
    } else {
      const s = spinner("Procurando a última versão nas releases do GitHub…");
      const rel = await findLatestRelease().catch((e) => {
        s.stop(String(e.message ?? e), false);
        return null;
      });
      if (!rel) {
        if (s) s.stop("Nenhuma release com o instalador do Windows ainda.", false);
        info(`Baixe o artefato "turtle-windows" de uma execução de "Desktop (Windows)" no GitHub Actions e use --de <pasta>.`);
        return 4;
      }
      s.stop(`Release ${rel.tag}: ${rel.exe.name}`);
      assets = rel;
      origem = `release ${rel.tag}`;
    }
    const sp = spinner("Baixando…");
    const dir = await stageInstaller(assets, (name) => sp.update(`Baixando ${name}…`));
    sp.stop(`Instalador pronto (${origem})`);
    if (!(await connect(c))) return 3;
    const up = spinner("Enviando para a VPS (uns 90 MB)…");
    const r = await run(c, publishDesktopScript(c), { input: tarStream(dir), quiet: true });
    up.stop(r.code === 0 ? "Publicado" : "Falha ao publicar", r.code === 0);
    if (r.code !== 0) {
      console.log(`  ${dim(r.out.trim())}`);
      return 4;
    }
    save(c);
    box([
      `Download para a turma: ${bold(`https://${c.app}`)} > Configurações > App desktop`,
      `O arquivo sai como ${bold(`Turtle-Setup@${c.app}.exe`)} e já abre no seu servidor.`,
      "Quem já tem o app instalado recebe a versão nova sozinho.",
    ], "Desktop publicado");
    return 0;
  } finally {
    p.close();
  }
}

/** Links e instruções dos apps (celular e desktop) para o servidor da pessoa. */
export async function apps(/** @type {Record<string, any>} */ o) {
  const p = prompter(true);
  try {
    const c = await resolveConfig(o, p);
    if (!c) return 2;
    save(c);
    box(
      [
        `${bold("Web")}      https://${c.app}`,
        `${bold("Windows")}  https://${c.app} > Configurações > App desktop  ${dim("(publique com: turtle-setup desktop publicar)")}`,
        `${bold("Android")}  APK genérico: https://github.com/sudothi/turtle/releases  ${dim("(abra um convite do seu servidor e ele se configura)")}`,
        `${bold("iPhone")}   build com AltStore (apps/ios/README.md); na tela de login, "Configurar servidor" → https://${c.app}`,
        "",
        `Link de convite: ${bold(`https://${c.app}/convite/<código>`)}`,
        "No celular e no PC o botão \"Abrir no Turtle\" aponta o app para o seu servidor e preenche o código.",
      ],
      "Apps do seu Turtle",
    );
    return 0;
  } finally {
    p.close();
  }
}

export { green };
