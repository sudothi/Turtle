#!/usr/bin/env bash
# Backup do Turtle: dump do Postgres + tarball dos uploads (fotos, banners, anexos). Guarda 14 dias.
# Cron diário (crontab -e):  0 7 * * *  /caminho/para/turtle/infra/selfhost/backup.sh
# Copie a pasta de backups para outro lugar (outro servidor, bucket) de vez em quando: backup só na mesma VPS não protege de perder a VPS.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
DEST="${BACKUP_DIR:-$HOME/turtle-backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
umask 077
mkdir -p "$DEST"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
docker compose exec -T postgres pg_dump -U turtle turtle | gzip > "$DEST/turtle-$stamp.sql.gz.tmp"
mv "$DEST/turtle-$stamp.sql.gz.tmp" "$DEST/turtle-$stamp.sql.gz"
docker compose exec -T app tar -C /data/uploads -czf - . > "$DEST/uploads-latest.tar.gz.tmp"
mv "$DEST/uploads-latest.tar.gz.tmp" "$DEST/uploads-latest.tar.gz"
find "$DEST" -maxdepth 1 -name 'turtle-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
echo "backup em $DEST"
