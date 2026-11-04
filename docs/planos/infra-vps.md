# Infra do VPS: backup de uploads (#29) e troca das chaves do LiveKit (#14)

O #29 foi feito (veja abaixo). A troca de chaves (#14) é só plano e só roda com o "ok" do dono.

## Estado real do VPS (lido em 04/11)

- Compose em `~/turtle/docker-compose.yml`: serviços `caddy`, `livekit` (network_mode host), `postgres` (usuário `kyo`) e `api` (imagem `turtle-app:<commit>`, construída à mão a partir de `~/turtle/src`). O volume `uploads` já existia e está montado em `/data/uploads`.
- O `infra/` do repositório divergia (serviço `app`, usuário `turtle`). Este PR o alinha com o VPS.
- Cron do usuário `kyo`: `0 7 * * * ~/turtle/backup.sh` (só dump do Postgres, 14 dias).

## #29 — feito

- `backup.sh` do VPS agora também guarda `uploads-*.tar.gz` (cópia do antigo em `backup.sh.bak-20261104`). Rodei uma vez à mão: dump e tar gerados; o volume está vazio por enquanto.
- Nada foi reiniciado.
- Falta: enviar os backups ao R2 (precisa de credenciais).

## #14 — trocar as chaves do LiveKit (plano)

O segredo vazou, então a chave nova precisa ter outro nome e outro segredo (32+ caracteres).

1. Gerar localmente `LIVEKIT_API_KEY` novo e `LIVEKIT_API_SECRET` novo (`openssl rand -hex 24` para o segredo). Não colar em chat nem em issue.
2. No VPS, copiar `~/turtle/.env` para `.env.bak-AAAAMMDD` e editar `LIVEKIT_API_KEY` e `LIVEKIT_API_SECRET` (o compose monta o `LIVEKIT_KEYS` a partir dos dois).
3. `cd ~/turtle && docker compose up -d api livekit`. As chamadas em andamento caem e o app reconecta; fazer num horário calmo.
4. Atualizar o `.env` local do PC (desenvolvimento) com chaves de desenvolvimento próprias, diferentes das de produção.
5. Conferir: `GET https://app.ogturtle.xyz/health`, entrar numa chamada de voz e numa transmissão de tela; olhar `docker compose logs livekit` sem erros de autenticação.
6. Reversão: restaurar `.env.bak-AAAAMMDD` e subir de novo (as chaves antigas continuam comprometidas, então só usar para diagnosticar).
7. Depois: apagar `.env.bak-AAAAMMDD` e fechar o ssh-agent temporário do PC (item da #14).

## #14 — TURN TLS e R2 (depois)

- TURN TLS na 5349 precisa de certificado para `lk.ogturtle.xyz` (o Caddy já emite; falta o LiveKit usá-lo ou um domínio `turn.` próprio). A porta 5349/tcp já está liberada no UFW.
- Envio ao R2 precisa de credenciais criadas pelo dono (token só com permissão no bucket de backup).
