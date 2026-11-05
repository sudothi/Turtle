#!/usr/bin/env bash
# Deploy do Turtle na VPS, chamado pelo GitHub Actions (.github/workflows/deploy.yml).
#
# Roda como "comando forçado" da chave de deploy no ~/.ssh/authorized_keys do usuário kyo:
#   command="/home/kyo/turtle/deploy.sh",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAA... turtle-deploy
# Assim a chave só consegue rodar este script, nunca um terminal ou outro comando.
#
# Entrada: SSH_ORIGINAL_COMMAND="deploy <sha de 40 caracteres>" e o código daquele commit
# como .tar.gz (git archive) na entrada padrão.
#
# Passos: backup, extrair o código, build de turtle-app:<sha> (pula se a imagem já existe,
# o que torna o rollback para um sha antigo rápido), trocar a tag do serviço api no compose,
# subir só o api, esperar o healthcheck e voltar para a tag anterior se ele falhar.
# Postgres, LiveKit e Caddy não reiniciam.
set -euo pipefail

BASE="${TURTLE_DIR:-$HOME/turtle}"
COMPOSE_FILE="${TURTLE_COMPOSE:-$BASE/docker-compose.yml}"
SERVICE="${TURTLE_SERVICE:-api}"
IMAGE="turtle-app"
KEEP_IMAGES=3
HEALTH_TIMEOUT=120

log() { echo "[deploy $(date -u +%H:%M:%S)] $*"; }
die() { log "ERRO: $*"; exit 1; }

# Só aceita exatamente "deploy <sha>"; qualquer outra coisa é recusada.
read -r cmd sha extra <<<"${SSH_ORIGINAL_COMMAND:-}" || true
[[ "${cmd:-}" == "deploy" && -z "${extra:-}" && "${sha:-}" =~ ^[0-9a-f]{40}$ ]] \
  || die "comando inválido; esperado: deploy <sha de 40 caracteres>"
short="${sha:0:7}"

# Um deploy por vez.
exec 9>"$BASE/.deploy.lock"
flock -w 600 9 || die "outro deploy está rodando há mais de 10 minutos"

cd "$BASE"
compose=(docker compose -f "$COMPOSE_FILE")

# A tag atual do api, para o rollback.
mapfile -t tags < <(grep -nE "^[[:space:]]*image:[[:space:]]*${IMAGE}:[0-9a-f]+[[:space:]]*$" "$COMPOSE_FILE")
[[ ${#tags[@]} -eq 1 ]] || die "esperava uma única linha 'image: ${IMAGE}:<sha>' em $COMPOSE_FILE, achei ${#tags[@]}"
prev="$(sed -E "s/.*${IMAGE}:([0-9a-f]+).*/\1/" <<<"${tags[0]}")"
log "versão atual: $prev, nova: $short"

# Recebe o código mesmo se a imagem já existir, para não deixar o ssh do outro lado travado.
tmp="$(mktemp -d "$BASE/.incoming-XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
tar -xzf - -C "$tmp"

if [[ "$prev" == "$short" ]]; then
  log "essa versão já está no ar, nada a fazer"
  exit 0
fi

log "backup"
if [[ -x "$BASE/backup.sh" ]]; then (cd "$BASE" && ./backup.sh) || die "backup falhou, deploy cancelado"; else die "não achei $BASE/backup.sh"; fi

if docker image inspect "$IMAGE:$short" >/dev/null 2>&1; then
  log "imagem $IMAGE:$short já existe, pulando o build"
else
  log "build de $IMAGE:$short"
  docker build -t "$IMAGE:$short" "$tmp" || die "build falhou, nada foi trocado"
  # Guarda o código usado, como no deploy manual.
  rm -rf "$BASE/src.bak-$prev" && { [[ -d "$BASE/src" ]] && mv "$BASE/src" "$BASE/src.bak-$prev" || true; }
  mv "$tmp" "$BASE/src" && tmp="$(mktemp -d)"
fi

set_tag() { sed -i -E "s/^([[:space:]]*image:[[:space:]]*${IMAGE}:)[0-9a-f]+([[:space:]]*)$/\1$1\2/" "$COMPOSE_FILE"; }

wait_healthy() {
  local id status waited=0
  while (( waited < HEALTH_TIMEOUT )); do
    sleep 5; waited=$((waited + 5))
    id="$("${compose[@]}" ps -q "$SERVICE")"
    [[ -n "$id" ]] || continue
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id")"
    [[ "$status" == "healthy" ]] && return 0
    [[ "$status" == "unhealthy" || "$status" == "exited" ]] && return 1
  done
  return 1
}

cp "$COMPOSE_FILE" "$COMPOSE_FILE.bak-$prev"
set_tag "$short"
log "subindo $SERVICE com $IMAGE:$short"
"${compose[@]}" up -d "$SERVICE"

if wait_healthy; then
  log "ok: $SERVICE saudável em $IMAGE:$short"
else
  log "healthcheck falhou; últimos logs:"
  "${compose[@]}" logs --tail 40 "$SERVICE" || true
  log "voltando para $IMAGE:$prev"
  set_tag "$prev"
  "${compose[@]}" up -d "$SERVICE"
  wait_healthy && log "rollback ok, $IMAGE:$prev no ar" || log "rollback também não ficou saudável, olhar à mão"
  exit 1
fi

# Mantém as últimas imagens (a atual e a anterior entram sempre) e apaga as outras.
docker image ls "$IMAGE" --format '{{.Tag}} {{.CreatedAt}}' | sort -k2 -r | awk '{print $1}' \
  | grep -vxE "$short|$prev" | tail -n +"$((KEEP_IMAGES - 1))" \
  | while read -r t; do docker image rm "$IMAGE:$t" >/dev/null 2>&1 && log "imagem antiga apagada: $t" || true; done
ls -d "$BASE"/src.bak-* 2>/dev/null | grep -v "src.bak-$prev$" | xargs -r rm -rf
ls -t "$COMPOSE_FILE".bak-* 2>/dev/null | tail -n +6 | xargs -r rm -f
log "deploy concluído"
