# Hospedar o Turtle numa VPS

Guia manual, do zero. Se preferir que uma IA faça isso por você, use [instalar-com-ia.md](instalar-com-ia.md).

## O que você vai precisar

- **VPS** com Ubuntu 24.04, IP público fixo, 2 vCPU e 4 GB de RAM ou mais. A voz usa pouca CPU (o LiveKit só repassa a mídia), mas a **banda** importa: cada pessoa assistindo uma tela em 1080p60 consome vários Mb/s do servidor. Prefira planos com tráfego alto ou ilimitado.
- **Domínio** seu e acesso ao DNS dele.
- Um computador com terminal e SSH.

## 1. Domínios e DNS

Crie dois registros **A** apontando para o IP da VPS (`203.0.113.10` abaixo é só um exemplo):

| Nome | Tipo | Valor | Para quê |
|---|---|---|---|
| `app.seudominio.com` | A | `203.0.113.10` | o app (site + API) |
| `lk.seudominio.com` | A | `203.0.113.10` | voz e vídeo (LiveKit) |

Se o DNS for da Cloudflare, deixe os dois **sem proxy** (nuvem cinza): o WebRTC não passa por ele. Espere propagar: `dig +short app.seudominio.com` deve devolver o IP.

## 2. Preparar a VPS

Conecte por SSH e rode:

```bash
sudo apt update && sudo apt -y upgrade
sudo apt install -y ca-certificates curl git ufw fail2ban
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"   # saia e entre de novo no SSH
```

Boas práticas: use um usuário comum (não root), login por chave SSH e desligue a senha (`PasswordAuthentication no` em `/etc/ssh/sshd_config`). **Antes** de ligar o firewall confirme que a porta do SSH está liberada, ou você se tranca para fora.

### Firewall

```bash
sudo ufw default deny incoming && sudo ufw default allow outgoing
sudo ufw allow 22/tcp     # SSH (ajuste se mudou a porta)
sudo ufw allow 80/tcp     # HTTP (certificado)
sudo ufw allow 443/tcp    # HTTPS
sudo ufw allow 7881/tcp   # LiveKit (mídia por TCP)
sudo ufw allow 7882/udp   # LiveKit (mídia por UDP)
sudo ufw allow 3478/udp   # TURN (ajuda quem está atrás de rede restrita)
sudo ufw enable
```

Se a VPS tiver firewall no painel do provedor, libere as mesmas portas lá.

## 3. Baixar e subir

```bash
git clone https://github.com/sudothi/turtle.git
cd turtle/infra/selfhost
./install.sh app.seudominio.com lk.seudominio.com --up
```

O `install.sh` gera as senhas (Postgres, chaves do LiveKit, código do primeiro convite), escreve `.env` e `livekit.yaml` e roda `docker compose up -d --build`. O primeiro build leva alguns minutos. O `.env` guarda segredos: `chmod 600`, fora do git, não cole em chats.

Confira:

```bash
docker compose ps                       # todos "running"/"healthy"
curl -fsS https://app.seudominio.com/health
```

## 4. Primeira conta (admin)

Abra `https://app.seudominio.com/convite/<BOOTSTRAP_INVITE>` (o código está no `.env` e foi mostrado ao fim do `install.sh`). A primeira conta vira **admin** e dona do servidor "Turtle". Depois dela o código não vale mais.

Para convidar amigos: **Configurações > Administração** gera links de convite de conta (`/convite/<código>`). Cada pessoa abre o link e cria o próprio usuário.

## 5. Testar a voz

Entre em um canal de voz com dois dispositivos (ou peça a um amigo). Se não conectar:

- `docker compose logs livekit` e confira se as portas 7881/tcp, 7882/udp e 3478/udp estão abertas no UFW **e** no painel do provedor;
- `dig +short lk.seudominio.com` precisa devolver o IP da VPS;
- a mensagem "voz não configurada no servidor" significa que o app não recebeu `LIVEKIT_*`: veja o `.env`.

## 5b. Lista de espera e e-mail (opcional)

Para receber um aviso por e-mail quando alguém entrar na lista de espera, preencha no `.env` `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` e `WAITLIST_NOTIFY_TO` (veja o [`.env.example`](../.env.example)) e rode `docker compose up -d`. Sem isso, os cadastros ficam só no banco.

## 6. Backup

```bash
crontab -e
# todo dia às 07:00 UTC
0 7 * * * /home/SEU_USUARIO/turtle/infra/selfhost/backup.sh
```

Guarda um dump do Postgres (14 dias) e os uploads em `~/turtle-backups`. **Copie essa pasta para fora da VPS** de vez em quando (outro computador, bucket S3/R2): backup só no mesmo disco não protege contra perder a VPS. Para restaurar:

```bash
gunzip -c turtle-AAAAMMDDTHHMMSSZ.sql.gz | docker compose exec -T postgres psql -U turtle turtle
docker compose exec -T app tar -C /data/uploads -xzf - < uploads-latest.tar.gz
```

## 7. Atualizar

```bash
cd turtle && ./infra/selfhost/backup.sh && git pull
cd infra/selfhost && docker compose up -d --build app
```

Postgres, LiveKit e Caddy não reiniciam; só o `app`. Se algo der errado: `git checkout <commit anterior>` e o mesmo `up -d --build app`.

## 8. App desktop e celular

O site funciona direto no navegador, inclusive no celular. Os instaladores oficiais (Windows, Android e iPhone) apontam para o servidor do mantenedor. Para usar app nativo no **seu** servidor:

- **Desktop:** a partir do código, `TURTLE_CLIENT_URL=https://app.seudominio.com pnpm desktop`.
- **Android:** compile com `./gradlew assembleRelease -PserverUrl=https://app.seudominio.com` (em `apps/android`) e instale o APK; ou baixe o APK de teste em Actions > Android nativo (APK). Veja [apps/android/README.md](../apps/android/README.md).
- **iPhone:** o app é mantido por outra pessoa e está em fase inicial. Instale pelo Xcode (`pnpm ios:device`, precisa de Mac) ou pela AltStore Classic (`pnpm ios:ipa` e importar o IPA), com conta Apple gratuita (renovação a cada 7 dias). Na tela de login, **Configurar servidor** aponta para o seu domínio. Veja [apps/ios/README.md](../apps/ios/README.md).

## Segurança, em uma lista

- Nunca publique o `.env`, as chaves do LiveKit nem o código de convite.
- Não publique a porta do Postgres (o compose já não publica).
- Mantenha o sistema atualizado (`sudo apt upgrade`, e `unattended-upgrades` ajuda).
- `fail2ban` ativo, SSH só por chave.
- Convites de conta só pelo admin; revogue os que não usou.
