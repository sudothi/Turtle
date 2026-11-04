#!/usr/bin/env bash
# Backup diário do Turtle no VPS: dump do Postgres + volume de uploads (fotos e banners).
# Fica em ~/turtle/backup.sh (copie de infra/backup.sh), roda pelo cron do usuário kyo:
#   0 7 * * * /home/kyo/turtle/backup.sh >> /home/kyo/turtle/backups/backup.log 2>&1   (07:00 UTC = 04:00 BRT)
# Retenção local de 14 dias.
# TODO: enviar ao Cloudflare R2 com rclone quando houver credenciais (issue #14).
set -euo pipefail
cd "$(dirname "$0")"
umask 077
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p backups

db="backups/turtle-$stamp.sql.gz"
docker compose exec -T postgres pg_dump -U kyo turtle | gzip > "$db.tmp"
mv "$db.tmp" "$db"

# O volume `uploads` é montado em /data/uploads no serviço api.
up="backups/uploads-$stamp.tar.gz"
docker compose exec -T api tar -C /data/uploads -czf - . > "$up.tmp"
mv "$up.tmp" "$up"

find backups \( -name 'turtle-*.sql.gz' -o -name 'uploads-*.tar.gz' \) -mtime +14 -delete
