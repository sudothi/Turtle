#!/usr/bin/env node
// Turtle Setup: instala e cuida do seu Turtle numa VPS Ubuntu, a partir do seu computador.
import { apps, atualizar, backup, desktopPublicar, instalar, logs, status } from "../src/commands.mjs";
import { banner, bold, dim, prompter, red } from "../src/ui.mjs";

const HELP = `${bold("Uso:")} turtle-setup <comando> [opções]

${bold("Comandos")}
  instalar            prepara a VPS do zero e sobe o Turtle (pode repetir; não perde nada)
  atualizar           faz backup, baixa a versão nova e reinicia
  status              versão, contêineres, disco, memória, último backup
  logs [serviço]      últimas linhas de app (padrão), caddy, livekit ou postgres   --linhas 200
  backup              roda o backup agora
  desktop publicar    coloca o instalador do Windows no seu servidor  --de <pasta> (senão, última release)
  apps                links do web, Windows, Android e iPhone para o seu servidor

${bold("Opções")} (ficam guardadas depois da primeira vez; nenhum segredo é salvo)
  --ip 203.0.113.10   --domain seudominio.com   --user ubuntu   --port 22   --key ~/.ssh/chave
  --app app.x.com --lk lk.x.com   (se não quiser os padrões app.<domínio> e lk.<domínio>)
  --no-firewall   --dry-run   --yes

${bold("Antes de começar")}
  1. VPS Ubuntu 24.04 (2 vCPU / 4 GB), usuário com sudo sem senha e a sua chave SSH autorizada.
  2. No DNS do domínio: registros A de app.<domínio> e lk.<domínio> para o IP da VPS.
  ${dim("Nunca é pedida senha: só chave SSH. Os segredos do servidor nascem na VPS e ficam lá.")}
`;

function parseArgs(/** @type {string[]} */ argv) {
  /** @type {Record<string, any>} */
  const o = {};
  /** @type {string[]} */
  const words = [];
  const flags = new Set(["yes", "dry-run", "no-firewall", "help", "h", "version", "v"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("-")) {
      words.push(a);
      continue;
    }
    const k = a.replace(/^-+/, "");
    const eq = k.indexOf("=");
    if (eq > 0) o[k.slice(0, eq)] = k.slice(eq + 1);
    else if (flags.has(k)) o[k] = true;
    else o[k] = argv[++i];
  }
  if (o["no-firewall"]) o.firewall = false;
  return { o, words };
}

const MENU = [
  ["Instalar o Turtle numa VPS", ["instalar"]],
  ["Atualizar (com backup antes)", ["atualizar"]],
  ["Ver o estado do servidor", ["status"]],
  ["Fazer backup agora", ["backup"]],
  ["Publicar o app desktop no meu servidor", ["desktop", "publicar"]],
  ["Links dos apps (web, Windows, Android, iPhone)", ["apps"]],
  ["Ajuda", ["--help"]],
];

/** Limpa a tela e volta o cursor ao topo (só em terminal). */
const clear = () => process.stdout.isTTY && process.stdout.write("\x1b[2J\x1b[3J\x1b[H");

/** Sem comando e num terminal (duplo clique no .exe): menu em loop, até a pessoa escolher Sair. */
async function interactive() {
  let code = 0;
  for (;;) {
    clear();
    banner();
    console.log(`  ${bold("O que você quer fazer?")}\n`);
    MENU.forEach(([label], i) => console.log(`   ${i + 1}) ${label}`));
    console.log(`   0) Sair\n`);
    const p = prompter(true);
    const a = await p.ask("Número:");
    p.close(); // cada comando abre o próprio prompt: não pode haver dois leitores no mesmo terminal
    if (a === "0") return code;
    const item = MENU[Number(a) - 1];
    if (!item) continue;
    clear();
    banner();
    try {
      code = await dispatch(/** @type {string[]} */ (item[1]), { quiet: true });
    } catch (e) {
      console.error(red(String(/** @type {any} */ (e)?.message ?? e)));
      code = 1;
    }
    await pause("Pressione Enter para voltar ao menu.");
  }
}

async function pause(msg = "Pressione Enter para fechar.") {
  const p = prompter(true);
  await p.ask(`\n  ${dim(msg)}`);
  p.close();
}

export async function main(/** @type {string[]} */ argv) {
  if (!argv.length && process.stdin.isTTY && process.stdout.isTTY) return interactive();
  return dispatch(argv);
}

async function dispatch(/** @type {string[]} */ argv, { quiet = false } = {}) {
  const { o, words } = parseArgs(argv);
  if (o.version || o.v) {
    console.log("turtle-setup 0.1.0");
    return 0;
  }
  const [cmd, sub] = words;
  if (o.help || o.h || !cmd) {
    if (!quiet) banner();
    console.log(HELP);
    return cmd ? 0 : 1;
  }
  if (!quiet) banner();
  switch (cmd) {
    case "instalar":
    case "install":
      return instalar(o);
    case "atualizar":
    case "update":
      return atualizar(o);
    case "status":
      return status(o);
    case "logs":
      return logs(o, sub);
    case "backup":
      return backup(o);
    case "desktop":
      if (sub === "publicar" || sub === "publish") return desktopPublicar(o);
      console.log(red(`Use: turtle-setup desktop publicar`));
      return 2;
    case "apps":
      return apps(o);
    default:
      console.log(red(`Comando desconhecido: ${cmd}`));
      console.log(HELP);
      return 2;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  async (e) => {
    console.error(red(String(e?.stack ?? e)));
    if (process.stdin.isTTY && !process.argv[2]) await pause();
    process.exit(1);
  },
);
