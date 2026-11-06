# Turtle (repo KYODSC) — contexto para agentes

Leia isto antes de mexer em qualquer coisa. É o resumo geral do projeto; os detalhes estão em `docs/` e nas issues/PRs do GitHub (o estado vivo fica lá, não aqui).

## O que é
Chat privado estilo Discord para o grupo de amigos do thiago, otimizado para **chamadas de voz, compartilhamento de tela e câmera**. Visual: layout do Discord em preto e branco, estilo linocut (xilogravura: texturas entalhadas, bordas irregulares, estrelas, gatos, peixes). Escala: ~30 contas, no máximo 6 por chamada.

## Regras do thiago (valem sempre)
- Fale em **português**. Planeje antes de implementar.
- **Nada de merge e nenhuma mudança em produção (VPS) sem ok escrito do thiago.** Abrir PR é livre; merge e deploy não.
- No fim de cada sessão, abra **issues no GitHub** (em português, autoexplicativas) para o que sobrou. Confira as existentes antes, para não duplicar.
- Nunca coloque segredos (chaves, senhas, tokens) em código, docs ou commits. Eles ficam no `.env` e no servidor.
- Atenção a PRs empilhadas: mesclar de cima para baixo deixa código preso em branches intermediários. Mescle de baixo para cima ou troque a base.

## Stack e estrutura
TypeScript, pnpm + Turborepo. Node/Fastify + WebSocket próprio, PostgreSQL (Drizzle), LiveKit auto-hospedado (SFU), Docker Compose + Caddy, sharp (imagens).
- `apps/server` API + gateway WebSocket · `apps/client` React (web) · `apps/desktop` Electron · `apps/android` nativo Kotlin/Compose · `apps/ios` prova inicial React Native
- `packages/protocol` tipos compartilhados · `packages/db` banco/migrações · `packages/ui` design system linocut
- `infra/` compose, Caddyfile, LiveKit, backup e deploy · `docs/planos/` planos de cada frente

## Rodar local
```
pnpm install && cp .env.example .env
pnpm infra:up      # Postgres + LiveKit (opcional)
pnpm dev           # server :3000, client :5173
pnpm desktop       # Electron, em outro terminal, com o dev rodando
```
Sem `DATABASE_URL` o servidor usa banco em memória (some ao reiniciar). Primeiro cadastro: `BOOTSTRAP_INVITE` do `.env`. Depois de trocar de branch, recompile `protocol` e `db`. Checagens: `pnpm typecheck` e `pnpm test`.

## Produção
- VPS Hostinger KVM 2 (Ubuntu 24.04), app em https://app.ogturtle.xyz, LiveKit em lk.ogturtle.xyz. Acesso SSH só com o usuário `kyo` por chave; agentes na nuvem não alcançam a VPS.
- Deploy: workflow "Deploy (VPS)" no GitHub Actions, **só manual** (`workflow_dispatch`; sha vazio = main, sha antigo = rollback), usa `infra/deploy.sh` com backup e rollback automático. Só rode com ok do thiago.
- Compose e arquivos da VPS (`~/turtle/`) espelham `infra/` do repositório (serviço `api`, veja `docs/planos/infra-vps.md`).
- Backup do Postgres + uploads na VPS todo dia 07:00 UTC (`~/turtle/backups/`, 14 dias). Uploads ficam no volume Docker `uploads`.

## Decisões e pegadinhas que não aparecem no código
- Convite de **conta** só pelo admin do app (Configurações > Administração, link `/convite/<código>`); convite de **servidor** só entra num servidor; conta nova começa sem servidor. Limite de 2 servidores próprios por pessoa.
- Voz: token em `POST /voice/:canal/token` (sala `voice-<canalId>`); quem está na chamada é rastreado pelo gateway WebSocket, não por webhook do LiveKit.
- H.264: o LiveKit negocia perfil 42e01f e o Chromium cai no encoder por software; `apps/client/src/voice/codec.ts` coloca Main/High primeiro para usar NVENC/hardware. Não remova.
- Captura real de tela não dá para testar no container da nuvem.
- Migração antiga apaga canais com `server_id` nulo (DMs usam `kind=dm` e `server_id` nulo; cuidado ao mexer).
- Mobile: decisão do thiago foi app **nativo Android em Kotlin/Compose** (nada de WebView); iPhone depois. A PWA/Capacitor foi só uma etapa intermediária.
- Seletores de teste e2e da voz: manter títulos Mudo, Ensurdecer, Configurações de voz, Sair da chamada.

## Estado (resumo; confirme nas issues/PRs)
Prontos e no main: auth por convite, servidores, chat, DMs e amigos, voz, tela/câmera, desktop com instalador e auto-update, perfil (avatar/banner), redesign linocut, mobile responsivo, Android nativo em andamento, endurecimento da auditoria de 06/11 (login limitado, heartbeat WS, logs/health, envio sem perda, rejoin de chamada, headers de segurança).
Pendente principal: push notifications, cota de upload na UI, assinatura com certificado do instalador Windows, paridade de chat (reações/busca) e acessibilidade. A lista completa e priorizada vem da auditoria (issues #88–#104, mais #112): veja a aba Issues.

## Como trabalhar aqui
Branch por tarefa → PR para `main` com descrição clara → thiago revisa e mescla. Rode `pnpm typecheck` e `pnpm test` antes de abrir PR. Mantenha o estilo existente e comente só o que não é óbvio.
