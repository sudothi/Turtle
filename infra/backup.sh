#!/usr/bin/env bash
# Backup diário do Turtle: dump do Postgres + volume de uploads (fotos e banners).
# Rode a partir de infra/ (onde está o docker-compose.prod.yml), por exemplo via cron às 04:00 BRT.
# Mantém 14 dias. O envio ao R2 (issue #14) fica para depois: precisa de credenciais.
set -euo pipefail

DEST="${BACKUP_DIR:-$HOME/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
COMPOSE=(docker compose -f docker-compose.prod.yml)

mkdir -p "$DEST"

"${COMPOSE[@]}" exec -T postgres pg_dump -U turtle turtle | gzip > "$DEST/db-$STAMP.sql.gz"

# O volume `uploads` é montado em /data/uploads no serviço app.
"${COMPOSE[@]}" exec -T app tar -C /data/uploads -czf - . > "$DEST/uploads-$STAMP.tar.gz"

find "$DEST" -maxdepth 1 \( -name 'db-*.sql.gz' -o -name 'uploads-*.tar.gz' \) -mtime +"$KEEP_DAYS" -delete
echo "backup ok: $DEST (db-$STAMP, uploads-$STAMP)"
