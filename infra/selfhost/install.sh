#!/usr/bin/env bash
# Prepara o Turtle numa VPS: gera as senhas, cria o .env e o livekit.yaml e (opcionalmente) sobe tudo.
#   ./install.sh app.seudominio.com lk.seudominio.com [--up]
# Antes: os dois domínios precisam apontar (registro A) para o IP desta VPS.
# Os segredos ficam só no .env (chmod 600), que o .gitignore já ignora. Nunca faça commit dele.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

app="${1:-}"; lk="${2:-}"; up="${3:-}"
[[ "$app" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ && "$lk" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ && "$app" != "$lk" ]] \
  || { echo "uso: ./install.sh app.seudominio.com lk.seudominio.com [--up]" >&2; exit 1; }
[[ ! -e .env ]] || { echo "já existe um .env aqui; apague-o se quiser recomeçar (as senhas do banco atual deixam de valer)." >&2; exit 1; }
command -v docker >/dev/null || { echo "Docker não encontrado: https://docs.docker.com/engine/install/" >&2; exit 1; }
docker compose version >/dev/null || { echo "Docker Compose v2 não encontrado." >&2; exit 1; }

rand() { openssl rand -hex "$1"; }
umask 077
cat > .env <<ENV
DOMAIN_APP=$app
DOMAIN_LK=$lk
LIVEKIT_API_KEY=API$(rand 8)
LIVEKIT_API_SECRET=$(rand 24)
POSTGRES_PASSWORD=$(rand 24)
# Código do primeiro cadastro (vira admin). Depois do primeiro usuário ele deixa de ser usado.
BOOTSTRAP_INVITE=$(rand 12)
# Opcional: aviso por e-mail da lista de espera (SMTP_* e WAITLIST_NOTIFY_TO). Veja o .env.example da raiz.
ENV

cat > livekit.yaml <<LK
# Gerado pelo install.sh. As chaves vêm do .env (LIVEKIT_KEYS no compose).
port: 7880
log_level: info
rtc:
  tcp_port: 7881
  udp_port: 7882
  use_external_ip: true
turn:
  enabled: true
  udp_port: 3478
  domain: $lk
webhook:
  urls:
    - https://$app/livekit/webhook
LK

echo "Pronto: .env e livekit.yaml criados em $(pwd)."
echo "Domínios: https://$app (app) e https://$lk (voz)."
if [[ "$up" == "--up" ]]; then
  docker compose up -d --build
  echo "Subindo. O primeiro build leva alguns minutos. Acompanhe com: docker compose logs -f app"
else
  echo "Suba com: docker compose up -d --build"
fi
echo "Código do primeiro cadastro (BOOTSTRAP_INVITE): $(grep '^BOOTSTRAP_INVITE=' .env | cut -d= -f2)"
echo "Abra https://$app/convite/<esse código> para criar a conta admin."
