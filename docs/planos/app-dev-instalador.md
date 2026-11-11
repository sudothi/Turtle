# Plano: "Download DEV" (instalador para quem hospeda o próprio Turtle)

Status: decidido em 2026-11-11 pelo thiago (CLI, Fase 1 primeiro). Passo 1 em andamento (Android).

## Decisões de 2026-11-11

- Assistente será um **CLI** (não Electron).
- "Assinado com o domínio" = instalador **já configurado** para o servidor da pessoa, não certificado de código (continua sem assinatura). Proposta: o servidor entrega o .exe genérico com a configuração anexada; plano B é build no Actions do fork.
- O link de convite configura tudo: `https://app.dominio/convite/<código>` com botão "Abrir no Turtle" (`turtle://convite?server=<url>&code=<código>`); o app guarda o servidor e abre o cadastro preenchido.
- Ordem: (1) servidor em runtime + `turtle://` nos apps (Android, depois desktop), (2) `/download` servindo o instalador configurado, (3) CLI.

## Opinião honesta

Vale a pena **em parte**. O que dói para quem hospeda não é "ter um executável", e sim três coisas: subir a VPS sem errar DNS/firewall, apontar os apps para o servidor próprio e gerar o iOS. Hoje já existem `infra/selfhost/install.sh`, `docs/hospedar-em-vps.md` e o prompt de `docs/instalar-com-ia.md`, que cobrem bem o primeiro ponto para quem sabe abrir um terminal.

Dois achados no código mudam o desenho:

1. **iOS já tem "Configurar servidor" na tela de login** (origem HTTPS escolhida em runtime, `apps/ios/README.md`). Não precisa gerar IPA por servidor.
2. **Android fixa o servidor em build** (`-PserverUrl`, `BuildConfig.SERVER_URL`). Se ganhar o mesmo campo em runtime, **um único APK genérico** serve para todo mundo e some a necessidade de compilar app por pessoa. Esta é a mudança de maior retorno e é pequena. O desktop pode seguir o mesmo caminho (hoje abre `turtlechat.tech` fixo).

Conclusão: o maior ganho é **tornar os apps configuráveis em runtime**; o "Download DEV" fica só como assistente de VPS. Gerar APK/IPA "sob medida" só é necessário se a pessoa quiser nome/ícone/bundle próprios.

## Alternativas

| Opção | Esforço | Para quem serve | Observação |
| --- | --- | --- | --- |
| A. Só melhorar o que existe (script + prompt de IA + docs) | baixo | quem tem coragem de usar SSH | já funciona |
| B. Apps com campo de servidor em runtime (Android/desktop) | baixo | todos | elimina build por pessoa; recomendado de qualquer forma |
| C. CLI/binário "turtle-setup" (Go ou Node SEA) rodando no PC da pessoa e falando SSH com a VPS | médio | quem não quer terminal | checagem de DNS, firewall, instala, mostra link de convite |
| D. App Electron "DEV" com interface gráfica | alto | idem C, mais bonito | Electron pesa ~90 MB para fazer o que um CLI faz; mesmos riscos de segurança |
| E. Instalador que roda **na VPS** (`curl ... | bash`) com assistente interativo | baixo | quem cola um comando no terminal do painel | não toca em chave SSH; o mais seguro |

## Escopo sugerido (por fases)

**Fase 1 (recomendada primeiro):**
- Campo "Servidor" em runtime no Android (e desktop), com validação (`GET /health`) e guardado no armazenamento do app. Release do GitHub com APK genérico assinado.
- Melhorar `install.sh`: checar DNS (`dig`) e portas antes de subir, gerar relatório final com link de convite, comando de atualização e backup.

**Fase 2 (o "Download DEV" propriamente):**
- Assistente "turtle-setup" (opção C, binário único para Windows/macOS/Linux, publicado nas Releases do GitHub e linkado no site público como "Download DEV"; o download "user" continua no domínio do app).
- Passos: pede IP, usuário e domínio; mostra os registros DNS a criar e espera propagar; conecta por SSH com **chave** (gera um par novo e instala a pública, ou usa o ssh-agent do usuário); envia/roda `install.sh`; confirma `/health`; entrega o convite admin e o QR do app.
- Gerar APK sob medida é opcional (exige JDK + Android SDK, ~1 GB): oferecer só como modo avançado, com `-PserverUrl`, ou delegar ao workflow do GitHub do fork da pessoa.

**iOS:** o assistente **não** gera IPA. Exige Mac com Xcode ou AltStore + conta Apple, e o app é mantido por outra pessoa (kaiqd). Sugestão: publicar o mesmo IPA genérico (servidor escolhido no login) e só documentar a instalação. Nada de código novo no iOS por parte deste plano.

## Riscos de segurança

- **Chaves SSH:** nunca aceitar senha nem copiar chave privada; usar ssh-agent/chave existente ou gerar par dedicado e mostrar onde fica. Não gravar nada em disco além do known_hosts; confirmar a impressão digital do host na primeira conexão.
- **Segredos:** `.env` (LiveKit, Postgres, BOOTSTRAP_INVITE) é gerado **na VPS** com `chmod 600`; o assistente só lê o BOOTSTRAP_INVITE no final. Sem telemetria e sem enviar nada para servidor do projeto.
- **Binário não assinado:** o assistente roda no PC da pessoa e executa comandos remotos; sem assinatura (decisão de não assinar) o Windows mostra SmartScreen. Mitigar com código aberto, checksums SHA-256 nas Releases e build reproduzível pelo GitHub Actions.
- **Firewall/SSH:** nunca mexer na porta do SSH nem desativar senha sem confirmação; liberar a porta do SSH antes de ativar o UFW.
- **Suporte:** o assistente vira superfície de suporte (versões de Ubuntu, provedores, Cloudflare proxy). Limitar a Ubuntu 24.04 na v1.
- **Domínio e privacidade:** os endereços da instância do mantenedor não entram no repositório nem no binário (placeholders e entrada do usuário).

## Publicação

- GitHub: Releases do repositório com `turtle-setup` (3 sistemas), APK genérico e checksums.
- Site público (ogturtle.xyz, repo turtlesite): botão "Download DEV" apontando para a Release mais recente; "Download" normal continua no app interno. Mudança no site e no repositório exige o ok do thiago; nada é mesclado nem implantado sem ele.

## Etapas e estimativa

1. Runtime de servidor no Android + release do APK genérico (PR pequena).
2. `install.sh` com pré-checagens e relatório final.
3. Protótipo do `turtle-setup` em modo dry-run (sem mexer em VPS) + testes em uma VPS descartável.
4. Releases automáticas pelo Actions (blocado hoje por billing do GitHub) e botão no site.
5. Documentação (`docs/instalar-com-ia.md` aponta para o assistente como alternativa).

## Perguntas

1. Prioridade: seguir primeiro a Fase 1 (apps configuráveis) antes do assistente?
2. Tecnologia do assistente: CLI (Go ou Node) ou interface gráfica (Electron)?
3. O Android genérico com campo de servidor serve, ou quer mesmo APK sob medida (nome/ícone próprios)?
4. O assistente deve rodar no PC da pessoa (SSH) ou prefere só um comando para colar na VPS (opção E)?
5. Plataformas da v1: só Windows ou também macOS/Linux?

## Recomendação

Fazer **B + E agora** (apps com servidor em runtime e instalador que roda na VPS, sem lidar com chaves), e só então decidir se o assistente gráfico/CLI no PC (C) compensa. Publicar como "Download DEV" o CLI se a Fase 1 mostrar que o comando na VPS ainda assusta a pessoa. Electron só se quiser interface visual; para esse trabalho, um binário CLI é mais leve, mais fácil de auditar e menos arriscado.
