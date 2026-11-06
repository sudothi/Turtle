#!/usr/bin/env bash
# Backup diário do Turtle na VPS: dump do Postgres + volume de uploads (fotos, banners e anexos).
# Fica em ~/turtle/backup.sh e roda pelo cron do usuário kyo (07:00 UTC = 04:00 BRT), além de rodar antes de cada deploy.
# Retenção local de 14 dias. O envio ao Cloudflare R2 (issue #14) fica para quando houver credenciais.
set -euo pipefail

BASE="${TURTLE_DIR:-$HOME/turtle}"
COMPOSE_FILE="${TURTLE_COMPOSE:-$BASE/docker-compose.yml}"
SERVICE="${TURTLE_SERVICE:-api}"
DEST="${BACKUP_DIR:-$BASE/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"

cd "$BASE"
umask 077
mkdir -p "$DEST"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
compose=(docker compose -f "$COMPOSE_FILE")

db="$DEST/turtle-$stamp.sql.gz"
"${compose[@]}" exec -T postgres pg_dump -U kyo turtle | gzip > "$db.tmp"
mv "$db.tmp" "$db"

# O volume `uploads` é montado em /data/uploads no serviço api.
# Mantém apenas a cópia mais recente (`uploads-latest.tar.gz`) para não multiplicar o uso de disco na VPS de 100 GB.
up="$DEST/uploads-latest.tar.gz"
"${compose[@]}" exec -T "$SERVICE" tar -C /data/uploads -czf - . > "$up.tmp"
mv "$up.tmp" "$up"
find "$DEST" -maxdepth 1 -name 'uploads-20*.tar.gz' -delete

find "$DEST" -maxdepth 1 -name 'turtle-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
