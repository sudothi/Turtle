# Infra da VPS: compose único (#101), backup (#29), chaves do LiveKit (#14) e guia do zero

Mudanças em produção só depois do "ok" escrito do dono.

## Arquivos da pasta `~/turtle` na VPS (espelhados em `infra/`)

| Arquivo no repositório | Caminho na VPS | Função |
|---|---|---|
| `infra/docker-compose.prod.yml` | `~/turtle/docker-compose.yml` | Serviços `caddy`, `livekit`, `postgres` e `api` (com rotação de logs e healthchecks) |
| `infra/Caddyfile` | `~/turtle/Caddyfile` | Proxy HTTPS (`{$DOMAIN_APP}` → `api:3000`, `{$DOMAIN_LK}` → `host.docker.internal:7880`), `/desktop/*` e cabeçalhos de segurança |
| `infra/livekit.prod.yaml` | `~/turtle/livekit.yaml` | Configuração do LiveKit (`network_mode: host`, portas 7880/7881/7882, TURN UDP 3478 e TURN TLS 5349 usando certificado do Caddy) |
| `infra/.env.prod.example` | `~/turtle/.env` (`chmod 600`) | Domínios e segredos de produção (nunca versionado) |
| `infra/backup.sh` | `~/turtle/backup.sh` (`chmod +x`) | Dump diário do Postgres (`kyo`/`turtle`) + tarball do volume `uploads`, retenção de 14 dias |
| `infra/deploy.sh` | `~/turtle/deploy.sh` (`chmod +x`) | Recebe tarball via SSH, roda backup, faz build de `turtle-app:<sha>`, atualiza `api` e faz rollback automático se `/health` falhar |

---

## Refazer a VPS do zero (#101)

Guia curto para subir tudo do zero numa máquina Ubuntu 24.04 limpa com usuário `kyo` (sudo + SSH por chave).

### 1. Pacotes e Docker
```bash
sudo apt update && sudo apt install -y ca-certificates curl ufw
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker kyo
# reconecte no SSH para ativar o grupo docker
```

### 2. Firewall (UFW)
```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp comment 'SSH'
sudo ufw allow 80/tcp comment 'HTTP (Caddy ACME)'
sudo ufw allow 443/tcp comment 'HTTPS (Caddy)'
sudo ufw allow 7881/tcp comment 'LiveKit RTC TCP'
sudo ufw allow 7882/udp comment 'LiveKit RTC UDP'
sudo ufw allow 3478/udp comment 'LiveKit TURN UDP'
sudo ufw allow 5349/tcp comment 'LiveKit TURN TLS'
# Porta 7880 do LiveKit (network_mode: host) liberada apenas para a rede bridge do Docker (Caddy -> host.docker.internal:7880)
sudo ufw allow from 172.16.0.0/12 to any port 7880 proto tcp comment 'LiveKit HTTP so p/ Caddy (Docker)'
sudo ufw enable
```

### 3. Estrutura `~/turtle` e `.env`
Copie os arquivos de `infra/` do repositório para `~/turtle`:
```bash
mkdir -p ~/turtle/backups ~/turtle/desktop ~/turtle/src
cp infra/docker-compose.prod.yml ~/turtle/docker-compose.yml
cp infra/Caddyfile               ~/turtle/Caddyfile
cp infra/livekit.prod.yaml       ~/turtle/livekit.yaml
cp infra/backup.sh               ~/turtle/backup.sh
cp infra/deploy.sh               ~/turtle/deploy.sh
cp infra/.env.prod.example       ~/turtle/.env
chmod 600 ~/turtle/.env
chmod +x ~/turtle/backup.sh ~/turtle/deploy.sh
```
Preencha `~/turtle/.env` com valores reais (`DOMAIN_APP`, `DOMAIN_LK`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `POSTGRES_PASSWORD`, `BOOTSTRAP_INVITE`).

### 4. Primeiro build e subida dos containers
No primeiro boot (ou via workflow `Deploy (VPS)` depois de configurar a chave SSH do passo 6):
```bash
# Se estiver subindo manualmente pela primeira vez a partir do código em ~/turtle/src:
docker build -t turtle-app:latest ~/turtle/src
cd ~/turtle && docker compose up -d
docker compose ps
curl -fsSI https://app.ogturtle.xyz/health
```

### 5. Cron de backup diário (07:00 UTC / 04:00 BRT)
No `crontab -e` do usuário `kyo`:
```cron
0 7 * * * /home/kyo/turtle/backup.sh >> /home/kyo/turtle/backups/backup.log 2>&1
```
Para restaurar um backup num banco/volume limpos:
```bash
gunzip -c ~/turtle/backups/pg-AAAA-MM-DD_HHMMSS.sql.gz | docker compose -f ~/turtle/docker-compose.yml exec -T postgres psql -U kyo -d turtle
docker compose -f ~/turtle/docker-compose.yml exec -T api tar -xzf - -C /data/uploads < ~/turtle/backups/uploads-AAAA-MM-DD_HHMMSS.tar.gz
```

### 6. Deploy pelo GitHub Actions (só manual)
Fluxo: **Actions > Deploy (VPS) > Run workflow**. O job confere que o CI do commit está verde e envia o código por SSH para `~/turtle/deploy.sh`. Na VPS o script faz backup, build de `turtle-app:<sha>`, troca a tag do serviço `api`, sobe só o `api`, espera o healthcheck e volta para a tag anterior se ele falhar. Rollback: o mesmo botão, informando o sha antigo.

1. Gerar uma chave dedicada (`ssh-keygen -t ed25519 -N '' -f turtle-deploy`) e acrescentar a pública ao `~/.ssh/authorized_keys` do `kyo` com comando forçado:
   ```text
   command="/home/kyo/turtle/deploy.sh",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAA... turtle-deploy
   ```
2. No GitHub (`Settings > Environments > production`), configurar os secrets `DEPLOY_SSH_KEY` (chave privada), `DEPLOY_HOST` (IP da VPS) e `DEPLOY_KNOWN_HOSTS` (saída de `ssh-keyscan -t ed25519 <ip>`).

---

## #14 — chaves do LiveKit e TURN TLS (concluído)

- **Chaves do LiveKit**: rotacionadas na VPS e backups antigos `.env.bak*` removidos.
- **TURN TLS na porta 5349**: ativo (`tls_port: 5349` em `livekit.yaml`), reutilizando em modo somente leitura (`caddy_data:/caddy_data:ro`) o certificado Let's Encrypt de `lk.ogturtle.xyz` emitido pelo Caddy.
- **Backup fora da VPS**: deixado fora do escopo por decisão do dono (mantido o backup diário automático local em `~/turtle/backups/` com retenção de 14 dias).
