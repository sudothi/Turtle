#!/usr/bin/env node
// Turtle Setup: instala o Turtle numa VPS Ubuntu 24.04 a partir do seu computador, usando o `ssh` que já existe
// no Windows 10+, macOS e Linux. Sem dependências. Não pede nem guarda senha: só chave SSH (ou ssh-agent).
// Uso:  node tools/turtle-setup/turtle-setup.mjs   (pergunta o que faltar)
//       node turtle-setup.mjs --ip 203.0.113.10 --domain seudominio.com --user ubuntu --yes
import { spawn } from "node:child_process";
import { resolve4 } from "node:dns/promises";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";

export const REPO = "https://github.com/sudothi/turtle.git";

// ---------- validação (tudo que entra num comando remoto passa por aqui) ----------
const HOST = /^(?=.{4,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const USER = /^[a-z_][a-z0-9_-]{0,31}$/;

export function validIp(s) {
  const m = IPV4.exec(s);
  return !!m && m.slice(1).every((n) => Number(n) <= 255);
}
export const validHost = (s) => HOST.test(s) && !validIp(s);
export const validUser = (s) => USER.test(s);
export const validPort = (s) => /^\d{1,5}$/.test(String(s)) && Number(s) >= 1 && Number(s) <= 65535;

/** Normaliza as opções e devolve { cfg } ou { error }. */
export function buildConfig(o) {
  const domain = String(o.domain ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const ip = String(o.ip ?? "").trim();
  const user = String(o.user ?? "").trim();
  const port = String(o.port ?? 22);
  const app = String(o.app ?? `app.${domain}`).toLowerCase();
  const lk = String(o.lk ?? `lk.${domain}`).toLowerCase();
  if (!validIp(ip)) return { error: "IP da VPS inválido (ex.: 203.0.113.10)." };
  if (!validHost(app) || !validHost(lk)) return { error: "Domínio inválido (ex.: seudominio.com)." };
  if (app === lk) return { error: "Os domínios do app e da voz precisam ser diferentes." };
  if (!validUser(user)) return { error: "Usuário SSH inválido." };
  if (!validPort(port)) return { error: "Porta SSH inválida." };
  if (o.key && /[\0\n]/.test(o.key)) return { error: "Caminho da chave inválido." };
  return { cfg: { ip, user, port, app, lk, key: o.key || "", firewall: o.firewall !== false, dir: "turtle" } };
}

// ---------- passos remotos ----------
/** Cada passo é um script bash executado na VPS (via `ssh ... bash -s`). */
export function buildSteps(c) {
  const sshPort = c.port;
  return [
    {
      id: "sistema",
      title: "Conferindo o sistema e o sudo",
      script: `set -e
. /etc/os-release
[ "$ID" = "ubuntu" ] || { echo "Este assistente é para Ubuntu (encontrei $ID)."; exit 3; }
echo "$PRETTY_NAME"
sudo -n true 2>/dev/null || { echo "O usuário precisa de sudo sem senha (ou use root)."; exit 4; }`,
    },
    {
      id: "pacotes",
      title: "Atualizando e instalando pacotes",
      script: `set -e
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -y
sudo apt-get upgrade -y
sudo apt-get install -y ca-certificates curl git ufw fail2ban dnsutils`,
    },
    {
      id: "docker",
      title: "Instalando o Docker",
      script: `set -e
if ! command -v docker >/dev/null; then curl -fsSL https://get.docker.com | sudo sh; fi
sudo usermod -aG docker "$USER"
docker --version 2>/dev/null || sudo docker --version
sudo docker compose version`,
    },
    ...(c.firewall
      ? [
          {
            id: "firewall",
            title: "Configurando o firewall (SSH liberado antes de ligar)",
            script: `set -e
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ${sshPort}/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 7881/tcp
sudo ufw allow 7882/udp
sudo ufw allow 3478/udp
sudo ufw --force enable
sudo ufw status | head -20`,
          },
        ]
      : []),
    {
      id: "codigo",
      title: "Baixando o Turtle",
      script: `set -e
if [ -d "$HOME/${c.dir}/.git" ]; then git -C "$HOME/${c.dir}" pull --ff-only; else git clone --depth 1 ${REPO} "$HOME/${c.dir}"; fi`,
    },
    {
      id: "subir",
      title: "Configurando e subindo o Turtle (o primeiro build leva alguns minutos)",
      script: `set -e
cd "$HOME/${c.dir}/infra/selfhost"
if [ -e .env ]; then
  echo "Já existe um .env: mantendo os segredos atuais e só atualizando os contêineres."
  sg docker -c "docker compose up -d --build"
else
  log="$(mktemp)"
  # O código do primeiro convite fica fora do log mostrado aqui; ele é lido no fim, só para o link final.
  if sg docker -c "./install.sh ${c.app} ${c.lk} --up" > "$log" 2>&1; then rc=0; else rc=$?; fi
  grep -v "BOOTSTRAP_INVITE\\|convite/" "$log" || true
  rm -f "$log"
  [ "$rc" = "0" ] || exit "$rc"
fi
sg docker -c "docker compose ps"`,
    },
    {
      id: "backup",
      title: "Agendando o backup diário",
      script: `set -e
job="0 7 * * * $HOME/${c.dir}/infra/selfhost/backup.sh"
( crontab -l 2>/dev/null | grep -vF "infra/selfhost/backup.sh"; echo "$job" ) | crontab -
echo "Backup diário às 07:00 UTC (guarde uma cópia fora da VPS de vez em quando)."`,
    },
  ];
}

export const inviteScript = (c) => `grep '^BOOTSTRAP_INVITE=' "$HOME/${c.dir}/infra/selfhost/.env" | cut -d= -f2`;

export function sshArgs(c, remote) {
  return [
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "ConnectTimeout=15",
    "-o", "ServerAliveInterval=30",
    "-p", c.port,
    ...(c.key ? ["-i", c.key, "-o", "IdentitiesOnly=yes"] : []),
    `${c.user}@${c.ip}`,
    remote,
  ];
}

// ---------- interface ----------
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (n) => (s) => (tty ? `\x1b[${n}m${s}\x1b[0m` : s);
const bold = paint(1), dim = paint(2), green = paint(32), red = paint(31), yellow = paint(33), cyan = paint(36);

const BANNER = `
   ${cyan("      _.-\"\"\"\"-._")}
   ${cyan("    .'  *  *   '.")}      ${bold("Turtle Setup")}
   ${cyan("   /  *  ____  *  \\")}     ${dim("instala o seu Turtle numa VPS")}
   ${cyan("  |  * /_/_/_\\ *   |")}
   ${cyan("   \\  *  ----  *  /")}
   ${cyan("    '._  *  *  _.'")}
   ${cyan("       '-....-'")}
`;

function runSsh(c, script, { quiet = false } = {}) {
  return new Promise((done) => {
    const child = spawn("ssh", sshArgs(c, "bash -s"), { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    const feed = (b) => {
      const s = b.toString();
      out += s;
      if (!quiet) for (const l of s.split("\n")) if (l.trim()) process.stdout.write(`   ${dim("│")} ${l}\n`);
    };
    child.stdout.on("data", feed);
    child.stderr.on("data", feed);
    child.on("error", (e) => done({ code: 127, out: e.code === "ENOENT" ? "ssh não encontrado: instale o cliente OpenSSH." : String(e) }));
    child.on("close", (code) => done({ code: code ?? 1, out }));
    child.stdin.end(script);
  });
}

async function checkDns(c, ask, yes) {
  for (;;) {
    const result = await Promise.all(
      [c.app, c.lk].map(async (h) => ({ h, ips: await resolve4(h).catch(() => []) })),
    );
    const bad = result.filter((r) => !r.ips.includes(c.ip));
    if (!bad.length) return true;
    console.log(yellow("\nO DNS ainda não aponta para a VPS. Crie estes registros A (Cloudflare: sem proxy, nuvem cinza):"));
    for (const r of result) console.log(`   ${r.ips.includes(c.ip) ? green("ok ") : red("falta")} ${r.h}  →  ${c.ip}   ${dim(r.ips.length ? `(hoje: ${r.ips.join(", ")})` : "(sem registro)")}`);
    if (yes) return false;
    const a = (await ask("Enter para conferir de novo, ou 'seguir' para continuar assim mesmo (o HTTPS falha até o DNS propagar): ")).trim().toLowerCase();
    if (a === "seguir") return false;
  }
}

async function waitHealth(c) {
  const url = `https://${c.app}/health`;
  for (let i = 0; i < 36; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (r.ok) return true;
    } catch {
      /* certificado ainda sendo emitido ou serviço subindo */
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  return false;
}

function parseArgs(argv) {
  const o = { firewall: true };
  const flags = new Set(["yes", "dry-run", "no-firewall", "help"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2);
    if (flags.has(k)) o[k] = true;
    else o[k] = argv[++i];
  }
  if (o["no-firewall"]) o.firewall = false;
  return o;
}

export async function main(argv) {
  const o = parseArgs(argv);
  console.log(BANNER);
  if (o.help) {
    console.log(`Opções: --ip IP --domain seudominio.com --user USUARIO [--port 22] [--key ~/.ssh/chave]
        [--app app.outro.com --lk lk.outro.com] [--no-firewall] [--dry-run] [--yes]
Os registros DNS esperados são app.<domínio> e lk.<domínio> apontando para o IP (tipo A).`);
    return 0;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (q) => (process.stdin.isTTY || !o.yes ? rl.question(q) : "");
  try {
    o.ip ??= (await ask("IP da VPS: ")).trim();
    o.domain ??= o.app ? "x.invalid" : (await ask("Domínio (ex.: seudominio.com): ")).trim();
    o.user ??= (await ask("Usuário SSH (com sudo sem senha, ex.: ubuntu): ")).trim();
    const { cfg, error } = buildConfig(o);
    if (error) {
      console.error(red(error));
      return 2;
    }
    const steps = buildSteps(cfg);
    console.log(`App:  ${bold("https://" + cfg.app)}\nVoz:  ${bold("https://" + cfg.lk)}\nVPS:  ${cfg.user}@${cfg.ip}:${cfg.port}\n`);
    if (o["dry-run"]) {
      for (const s of steps) console.log(`${bold("# " + s.title)}\n${s.script}\n`);
      console.log(dim("(dry-run: nada foi executado)"));
      return 0;
    }
    if (!o.yes) {
      const extra = cfg.firewall ? " e vou ligar o firewall (libero o SSH antes)" : "";
      const a = (await ask(`Vou instalar Docker e o Turtle nessa VPS${extra}. Continuar? [s/N] `)).trim().toLowerCase();
      if (a !== "s" && a !== "sim") return 1;
    }

    console.log(bold("\n1/ DNS"));
    const dnsOk = await checkDns(cfg, ask, !!o.yes);
    if (dnsOk) console.log(green("   DNS ok"));

    console.log(bold("\n2/ Conexão SSH"));
    const probe = await runSsh(cfg, "echo conectado", { quiet: true });
    if (probe.code !== 0) {
      console.error(red("   Não consegui entrar por SSH com chave."), `\n${dim(probe.out.trim())}`);
      console.error("   Confira o IP/usuário, e se a sua chave pública está em ~/.ssh/authorized_keys da VPS (use --key para escolher a chave).");
      return 3;
    }
    console.log(green("   conectado"));

    let n = 3;
    for (const s of steps) {
      console.log(bold(`\n${n++}/ ${s.title}`));
      const r = await runSsh(cfg, s.script);
      if (r.code !== 0) {
        console.error(red(`\nFalhou em "${s.title}" (código ${r.code}).`), "Corrija o que a mensagem acima indica e rode de novo: o assistente pode ser repetido sem perder nada.");
        return 4;
      }
    }

    console.log(bold(`\n${n}/ Esperando o HTTPS responder`));
    const healthy = await waitHealth(cfg);
    const inv = await runSsh(cfg, inviteScript(cfg), { quiet: true });
    const code = inv.out.trim().split("\n").pop();
    if (healthy) console.log(green(`   https://${cfg.app}/health respondeu`));
    else console.log(yellow(`   Ainda sem resposta em https://${cfg.app}/health. Em geral é o DNS propagando ou a porta 80/443 fechada no painel do provedor.`));

    console.log(`\n${bold("Pronto.")}`);
    if (/^[a-f0-9]{8,}$/i.test(code)) console.log(`Crie a conta admin em: ${bold(`https://${cfg.app}/convite/${code}`)}\n${dim("(esse link só vale para o primeiro cadastro; não o compartilhe)")}`);
    console.log("Depois: Configurações > Administração gera os convites para os amigos.");
    console.log(dim(`Libere também 22/80/443 tcp, 7881 tcp, 7882 udp e 3478 udp no firewall do painel da VPS, se houver.`));
    return 0;
  } finally {
    rl.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => {
    console.error(red(String(e?.stack ?? e)));
    process.exit(1);
  });
}
