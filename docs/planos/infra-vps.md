# Infra do VPS: backup de uploads (#29) e troca das chaves do LiveKit (#14)

Plano, nada disso foi executado. Mudanças em produção só depois do "ok" escrito do dono.

## O que o repositório já tem

- `infra/docker-compose.prod.yml` já define `UPLOAD_DIR=/data/uploads` e o volume `uploads` no serviço `app`.
- O script de backup diário (04:00 BRT, 14 dias, só dump do Postgres) existe apenas no VPS. Este PR adiciona `infra/backup.sh` com dump + uploads; falta comparar com o do VPS.

## #29 — backup dos uploads e alinhar o compose

Passo 0, somente leitura no VPS (precisa de aprovação para acessar):

1. `docker ps`, `docker compose config` e `crontab -l` do usuário `kyo`, para ver o compose e o script de backup reais.
2. `diff` entre o compose do VPS e `infra/docker-compose.prod.yml`.

Mudanças propostas (cada uma com cópia do arquivo antes):

1. Se o compose do VPS não tiver `UPLOAD_DIR` e o volume `uploads`, copiar o do repositório e fazer `docker compose up -d --build app` (reinício curto do app; o Postgres e o LiveKit não reiniciam).
2. Trocar o script de backup do cron por `infra/backup.sh` (ou acrescentar a linha do `tar` ao atual). Rodar uma vez à mão e conferir o tamanho dos dois arquivos.
3. Teste de restauração: extrair o `uploads-*.tar.gz` numa pasta temporária e listar.

Reversão: restaurar a cópia do compose e do script de backup e subir de novo.

## #14 — trocar as chaves do LiveKit (plano)

O segredo vazou, então a chave nova precisa ter outro nome e outro segredo (32+ caracteres).

1. Gerar localmente `LIVEKIT_API_KEY` novo e `LIVEKIT_API_SECRET` novo (`openssl rand -hex 24` para o segredo). Não colar em chat nem em issue.
2. No VPS, copiar `infra/.env` para `.env.bak`; editar `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` e `LIVEKIT_KEYS` (formato `chave: segredo`) com os mesmos valores.
3. `docker compose -f docker-compose.prod.yml up -d app livekit`. As chamadas em andamento caem e o app reconecta; fazer num horário calmo.
4. Atualizar o `.env` local do PC (desenvolvimento) com chaves de desenvolvimento próprias, diferentes das de produção.
5. Conferir: `GET https://app.ogturtle.xyz/health`, entrar numa chamada de voz e numa transmissão de tela; olhar `docker compose logs livekit` sem erros de autenticação.
6. Reversão: restaurar `.env.bak` e subir de novo (as chaves antigas continuam comprometidas, então só usar para diagnosticar).
7. Depois: apagar `.env.bak` e fechar o ssh-agent temporário do PC (item da #14).

## #14 — TURN TLS e R2 (depois)

- TURN TLS na 5349 precisa de certificado para `lk.ogturtle.xyz` (o Caddy já emite; falta o LiveKit usá-lo ou um domínio `turn.` próprio) e de abrir a porta no firewall.
- Envio ao R2 precisa de credenciais criadas pelo dono (token só com permissão no bucket de backup).

## Deploy automático com aprovação

Código: `.github/workflows/deploy.yml` (GitHub Actions) e `infra/deploy.sh` (roda na VPS). Plano completo: [Deploy automático do Turtle na VPS](https://claude.ai/artifact/KRJL3FJxYcJiC6k5qNVHpy).

Fluxo: merge na main, CI verde, o deploy fica esperando aprovação no GitHub (Environment `production`), e depois de aprovado o job envia o código por SSH. Na VPS o script faz backup, build de `turtle-app:<sha>`, troca a tag do serviço `api`, sobe só o `api`, espera o healthcheck e volta para a tag anterior se ele falhar. Merges que só mexem em `docs/`, `apps/desktop/` ou `.md` são ignorados. Rollback manual: Actions > Deploy (VPS) > Run workflow com o sha antigo.

Para ativar (nada disso foi feito ainda):

1. Na VPS, copiar `infra/deploy.sh` para `~/turtle/deploy.sh` (`chmod +x`).
2. Gerar uma chave só para isso (`ssh-keygen -t ed25519 -N '' -f turtle-deploy`) e acrescentar a pública ao `~/.ssh/authorized_keys` do `kyo` com o comando forçado:
   `command="/home/kyo/turtle/deploy.sh",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAA... turtle-deploy`
3. No GitHub, Settings > Environments > New environment `production`: marcar Required reviewers (o dono) e criar os secrets `DEPLOY_SSH_KEY` (chave privada), `DEPLOY_HOST` (IP) e `DEPLOY_KNOWN_HOSTS` (saída de `ssh-keyscan -t ed25519 <ip>`).
4. Testar com Run workflow na main atual, aprovando quando o GitHub pedir, e olhar o resultado e o `/health`.

Revogar: apagar a linha da chave no `authorized_keys`.
