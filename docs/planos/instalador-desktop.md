# Instalador do app desktop (Windows)

Issue #37. O app desktop instalado abre `https://app.ogturtle.xyz`, com a cara do Turtle (preto e branco, linogravura) e atualização automática.

## O que o usuário vê

1. **Instalador** (`Turtle-Setup-<versão>.exe`, NSIS, em português): barra lateral preta com estrelas, a tartaruga, "Turtle" e o mar em goiva; faixa do topo com a marca. Instala só para o usuário (sem pedir administrador), deixa escolher a pasta, cria atalho na área de trabalho e no menu Iniciar e abre o Turtle no fim.
2. **Splash** ao abrir: janelinha sem borda com a tartaruga nadando, estrelas piscando e a borda "fervendo" (mesmo filtro da tela de login). Mostra "Procurando atualização…", a barra de download quando há versão nova e "Abrindo…".
3. **Janela do app**: carrega o site publicado. Sem internet, mostra "Sem conexão com o Turtle" e tenta de novo a cada 2 s.
4. **Bandeja**: fechar a janela só esconde (a chamada continua, como no Discord). Menu: Abrir o Turtle, Procurar atualização / Reiniciar para atualizar, versão, Sair do Turtle.

Ícone do app, do atalho, do instalador e da bandeja: o quadrado preto com a tartaruga (`build/icon.png`, de 16 a 256 px no `.ico`).

## Atualização automática

- `electron-updater` com provedor `generic` em `https://app.ogturtle.xyz/desktop/` (o repositório é privado, então GitHub Releases exigiria token no app).
- Ao abrir: procura por até 6 s. Se houver versão nova, baixa mostrando o progresso na splash e reinstala em silêncio, reabrindo o app. Sem rede ou servidor lento, abre a versão atual.
- Com o app aberto: procura a cada 4 h e baixa em segundo plano; avisa por notificação e instala ao sair (ou em "Reiniciar para atualizar" na bandeja). Nunca derruba uma chamada sozinho.

## Como gerar uma versão

1. Subir `version` em `apps/desktop/package.json` (ex.: 0.1.0 → 0.1.1). O auto-update compara essa versão.
2. Gerar o instalador:
   - **GitHub Actions**: Actions > "Desktop (Windows)" > Run workflow. Baixar o artifact `turtle-windows`.
   - **No PC (Windows)**: `pnpm install` e `pnpm desktop:dist`. Sai em `apps/desktop/release/`.
3. Publicar (precisa de ok, é produção): copiar `Turtle-Setup-<versão>.exe`, `Turtle-Setup-<versão>.exe.blockmap` e `latest.yml` para `~/turtle/desktop/` no VPS. Suba o `.exe` e o `.blockmap` antes e o `latest.yml` por último, para ninguém ver uma versão sem arquivo.
4. Link para os amigos baixarem: `https://app.ogturtle.xyz/desktop/Turtle-Setup-<versão>.exe`.

### Preparar o VPS (uma vez, precisa de ok)

- `mkdir ~/turtle/desktop`
- No `~/turtle/Caddyfile`, o bloco `handle_path /desktop/*` (igual ao `infra/Caddyfile`), e no compose o volume `./desktop:/srv/desktop:ro` no serviço `caddy`.
- `docker compose up -d caddy` e conferir `curl -I https://app.ogturtle.xyz/desktop/latest.yml`.

## Limites conhecidos

- **Sem assinatura de código**: na primeira instalação o Windows mostra o SmartScreen ("O Windows protegeu o computador" > Mais informações > Executar assim mesmo). Um certificado custa a partir de ~US$ 200/ano (ou Azure Trusted Signing, ~US$ 10/mês, que exige empresa ou conta verificada). As atualizações automáticas não passam pelo SmartScreen.
- As telas do NSIS têm fundo branco do Windows; a personalização é a barra lateral, a faixa do topo e os ícones.
- Só Windows x64 por enquanto. macOS e Linux usam o mesmo código, falta só o alvo no `electron-builder.yml`.

## Arquivos

- `apps/desktop/electron-builder.yml`: instalador e endereço das atualizações.
- `apps/desktop/assets/`: splash, fontes, marca e ícone usados em tempo de execução.
- `apps/desktop/build/`: ícone e imagens BMP do instalador (gerados por `pnpm --filter @turtle/desktop arte`).
- `apps/desktop/src/updater.ts`, `splash.ts`, `tray.ts`: atualização, splash e bandeja.
- `.github/workflows/desktop.yml`: build do instalador no Windows.
