# Turtle Setup (CLI)

Assistente de terminal para quem hospeda o próprio Turtle. Roda no **seu computador** e cuida da VPS por SSH: instala do zero, atualiza, mostra o estado, faz backup e publica o app desktop já configurado para o seu domínio. É o "Download DEV" do site; o download normal (app para os amigos) fica dentro de cada servidor.

```
        _.-''''-._
      .'  *   *   '.          Turtle Setup
     /  *  _____  *  \        o seu Turtle, na sua VPS
    |  *  /_/_/_\  *  |
     \  *  -----  *  /
      '._  *   *  _.'  _
         '-....-'  (_)>
```

## Antes de começar

1. **VPS** Ubuntu 24.04 (2 vCPU / 4 GB ou mais), com um usuário com `sudo` sem senha e a **sua chave SSH** em `~/.ssh/authorized_keys`. O assistente nunca pede senha.
2. **Domínio**: no DNS, registros **A** de `app.seudominio.com` e `lk.seudominio.com` para o IP da VPS (Cloudflare: sem proxy). O assistente confere e espera propagar.
3. No seu computador: o cliente `ssh` (já vem no Windows 10+, macOS e Linux).

## Instalar

Baixe o executável do seu sistema nas [Releases](https://github.com/sudothi/turtle/releases) (`turtle-setup-windows-x64.exe`, `turtle-setup-macos-arm64` ou `turtle-setup-linux-x64`) e confira o `.sha256`. No Windows, o SmartScreen pode aparecer (o executável não é assinado): "Mais informações > Executar assim mesmo". No macOS/Linux: `chmod +x turtle-setup-*`.

Ou, com Node 22+ e o repositório clonado: `pnpm install && pnpm --filter @turtle/cli start -- <comando>`.

## Comandos

```
turtle-setup instalar            prepara a VPS e sobe o Turtle (pode repetir; não perde nada)
turtle-setup atualizar           backup, versão nova, reinicia
turtle-setup status              versão, contêineres, disco, memória, último backup, desktop publicado
turtle-setup logs [serviço]      app (padrão), caddy, livekit, postgres     --linhas 200
turtle-setup backup              roda o backup agora (Postgres + uploads, em ~/turtle-backups na VPS)
turtle-setup desktop publicar    põe o instalador do Windows no seu servidor   --de <pasta>
turtle-setup apps                links do web, Windows, Android e iPhone para o seu servidor
```

Opções: `--ip`, `--domain`, `--user`, `--port`, `--key`, `--app`/`--lk` (domínios fora do padrão), `--no-firewall`, `--dry-run` (só mostra os comandos), `--yes`. Na primeira vez ele pergunta o que faltar e guarda IP, usuário e domínios em `~/.config/turtle-setup/config.json` (`%APPDATA%\turtle-setup` no Windows); nenhum segredo é salvo.

### O que `instalar` faz, em ordem

DNS → conexão SSH → confere Ubuntu e sudo → `apt upgrade` e pacotes → Docker → firewall UFW (libera a porta do SSH **antes** de ligar; 80, 443, 7881/tcp, 7882/udp, 3478/udp) → clona o repositório em `~/turtle` → `infra/selfhost/install.sh app lk --up` (gera `.env` e `livekit.yaml` na VPS) → cron do backup às 07:00 UTC → espera `https://app.seudominio.com/health` → mostra o link do convite da conta admin.

### Apps apontando para o seu servidor

- **Windows:** `turtle-setup desktop publicar` baixa a última release do instalador (ou usa `--de <pasta>` com um artefato do Actions) e envia para `infra/selfhost/desktop/` na VPS. A página Configurações > App desktop do seu Turtle passa a oferecer `Turtle-Setup@app.seudominio.com.exe`: o instalador lê o domínio do nome e o app já abre no seu servidor. As atualizações automáticas vêm do mesmo lugar.
- **Android e iPhone:** apps genéricos. Quem abre um link de convite do seu servidor (`https://app.seudominio.com/convite/<código>` > "Abrir no Turtle") tem o app configurado e o cadastro preenchido. No iPhone também dá para digitar o servidor na tela de login.

## Segurança

- Só chave SSH (`BatchMode`): sem senha, sem copiar chave privada. Na primeira conexão aceita a impressão digital do servidor (`accept-new`).
- Os segredos (`.env`, chaves do LiveKit, senha do Postgres, código do primeiro convite) são gerados **na VPS** e não saem dela; o assistente só lê o código do convite no fim, para montar o link.
- Tudo que entra num comando remoto (IP, domínio, usuário, porta) passa por validação estrita.
- Não mexe na porta do SSH nem desliga o login por senha. Isso continua sendo sua decisão (veja `docs/hospedar-em-vps.md`).

## Desenvolver

```
pnpm --filter @turtle/cli test        # testes (validação, scripts bash, releases)
pnpm --filter @turtle/cli typecheck
pnpm --filter @turtle/cli sea         # executável único em apps/cli/release/ (para o sistema atual)
```

Sem dependências de runtime: `src/` é JavaScript puro; `esbuild` junta tudo em `dist/turtle-setup.cjs` e `scripts/sea.mjs` embute no Node (Single Executable Application). O workflow `cli.yml` gera os três binários e, numa tag `cli-v*`, publica a Release.
