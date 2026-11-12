// Scripts que rodam na VPS. Os valores interpolados já passaram por buildConfig (config.mjs).
import { REPO } from "./config.mjs";

/** @param {import("./config.mjs").Config} c */
export const selfhostDir = (c) => `$HOME/${c.dir}/infra/selfhost`;

/** Passos do comando `instalar`, na ordem. Podem ser repetidos sem estragar nada. */
export function installSteps(/** @type {import("./config.mjs").Config} */ c) {
  return [
    {
      id: "sistema",
      title: "Conferindo o sistema e o sudo",
      script: `set -e
. /etc/os-release
[ "$ID" = "ubuntu" ] || { echo "Este assistente é para Ubuntu (encontrei $ID)."; exit 3; }
echo "$PRETTY_NAME"
if [ "$(id -u)" != "0" ]; then sudo -n true 2>/dev/null || { echo "O usuário precisa de sudo sem senha (ou use root)."; exit 4; }; fi`,
    },
    {
      id: "pacotes",
      title: "Atualizando o sistema e instalando pacotes",
      script: `set -e
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -y -q
sudo apt-get upgrade -y -q
sudo apt-get install -y -q ca-certificates curl git ufw fail2ban dnsutils`,
    },
    {
      id: "docker",
      title: "Instalando o Docker",
      script: `set -e
if ! command -v docker >/dev/null; then curl -fsSL https://get.docker.com | sudo sh; fi
sudo usermod -aG docker "$USER"
sudo docker --version
sudo docker compose version`,
    },
    ...(c.firewall
      ? [
          {
            id: "firewall",
            title: "Ligando o firewall (SSH liberado antes)",
            script: `set -e
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ${c.port}/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 7881/tcp
sudo ufw allow 7882/udp
sudo ufw allow 3478/udp
sudo ufw --force enable
sudo ufw status | sed -n '1,20p'`,
          },
        ]
      : []),
    {
      id: "codigo",
      title: "Baixando o Turtle",
      script: `set -e
if [ -d "$HOME/${c.dir}/.git" ]; then git -C "$HOME/${c.dir}" pull --ff-only; else git clone --depth 1 ${REPO} "$HOME/${c.dir}"; fi
git -C "$HOME/${c.dir}" log -1 --format='versão %h de %cs'`,
    },
    {
      id: "subir",
      title: "Configurando e subindo o Turtle (o primeiro build leva alguns minutos)",
      script: `set -e
cd "${selfhostDir(c)}"
if [ -e .env ]; then
  echo "Já existe um .env: mantendo os segredos e só atualizando os contêineres."
  sg docker -c "docker compose up -d --build"
else
  log="$(mktemp)"
  # O código do primeiro convite não vai para este log; ele é lido no fim, só para montar o link.
  if sg docker -c "./install.sh ${c.app} ${c.lk} --up" > "$log" 2>&1; then rc=0; else rc=$?; fi
  grep -v "BOOTSTRAP_INVITE\\|convite/" "$log" || true
  rm -f "$log"
  [ "$rc" = "0" ] || exit "$rc"
fi
sg docker -c "docker compose ps --format 'table {{.Service}}\\t{{.Status}}'"`,
    },
    {
      id: "backup",
      title: "Agendando o backup diário (07:00 UTC)",
      script: `set -e
job="0 7 * * * $HOME/${c.dir}/infra/selfhost/backup.sh >/dev/null 2>&1"
( crontab -l 2>/dev/null | grep -vF "infra/selfhost/backup.sh"; echo "$job" ) | crontab -
echo "Os arquivos ficam em ~/turtle-backups (copie para fora da VPS de vez em quando)."`,
    },
  ];
}

/** Código do primeiro convite (só se nenhuma conta foi criada ainda, o servidor ignora depois). */
export const inviteScript = (/** @type {import("./config.mjs").Config} */ c) =>
  `grep '^BOOTSTRAP_INVITE=' "${selfhostDir(c)}/.env" 2>/dev/null | cut -d= -f2`;

export const updateScript = (/** @type {import("./config.mjs").Config} */ c) => `set -e
cd "${selfhostDir(c)}"
echo "Backup antes de atualizar…"
sg docker -c "./backup.sh"
antes="$(git -C "$HOME/${c.dir}" rev-parse --short HEAD)"
git -C "$HOME/${c.dir}" pull --ff-only
depois="$(git -C "$HOME/${c.dir}" rev-parse --short HEAD)"
if [ "$antes" = "$depois" ]; then echo "Já estava na versão mais nova ($antes)."; else echo "Atualizando $antes → $depois"; fi
sg docker -c "docker compose up -d --build"
sg docker -c "docker compose ps --format 'table {{.Service}}\\t{{.Status}}'"`;

export const statusScript = (/** @type {import("./config.mjs").Config} */ c) => `set -e
cd "${selfhostDir(c)}"
echo "versão: $(git -C "$HOME/${c.dir}" log -1 --format='%h de %cs')"
sg docker -c "docker compose ps --format 'table {{.Service}}\\t{{.Status}}'"
echo "disco: $(df -h / | awk 'NR==2{print $3" usados de "$2" ("$5")"}')"
echo "memória: $(free -h | awk '/^Mem/{print $3" usados de "$2}')"
b="$(ls -t "$HOME/turtle-backups"/turtle-*.sql.gz 2>/dev/null | head -1)"
[ -n "$b" ] && echo "último backup: $(basename "$b")" || echo "último backup: nenhum ainda"
d="${selfhostDir(c)}/desktop/latest.yml"
[ -f "$d" ] && echo "desktop publicado: $(sed -n 's/^version: *//p' "$d")" || echo "desktop publicado: não"`;

export const logsScript = (/** @type {import("./config.mjs").Config} */ c, /** @type {string} */ service, /** @type {number} */ n) =>
  `cd "${selfhostDir(c)}" && sg docker -c "docker compose logs --no-color --tail=${n} ${service}"`;

export const backupScript = (/** @type {import("./config.mjs").Config} */ c) =>
  `cd "${selfhostDir(c)}" && sg docker -c "./backup.sh" && ls -lh "$HOME/turtle-backups" | tail -n +2`;

/** Recebe um tar.gz (stdin) com o instalador e põe em infra/selfhost/desktop/, latest.yml por último. */
export const publishDesktopScript = (/** @type {import("./config.mjs").Config} */ c) => `set -e
dest="${selfhostDir(c)}/desktop"
mkdir -p "$dest"
tmp="$(mktemp -d)"
tar -xzf - -C "$tmp"
ls "$tmp"/Turtle-Setup-*.exe >/dev/null
for f in "$tmp"/*.exe "$tmp"/*.blockmap; do [ -e "$f" ] && mv -f "$f" "$dest/"; done
mv -f "$tmp/latest.yml" "$dest/latest.yml"
rmdir "$tmp"
ls -lh "$dest" | tail -n +2`;
