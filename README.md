# Turtle

Chat privado estilo Discord, preto e branco (linocut), focado em chamadas, tela e câmera.

Prova inicial para iPhone (React Native, iOS 26+): [instalação, build e roteiro de teste](apps/ios/README.md).

## Rodar local
```
pnpm install
cp .env.example .env
pnpm infra:up   # Postgres + LiveKit
pnpm dev        # server :3000, client :5173
pnpm desktop    # app Electron (com o pnpm dev rodando): seletor de tela, áudio do sistema; Ctrl+Shift+D abre o diagnóstico WebRTC
```
O servidor lê o `.env` da raiz sozinho. Com `DATABASE_URL` definido o servidor usa Postgres; sem ele usa um banco em memória (some ao reiniciar).
## Voz (marco 2)
- Canais de voz aparecem na barra lateral com quem está dentro; clicar entra na chamada. Mudo, ensurdecer, volume por pessoa e indicador de quem fala.
- ⚙ abre as configurações: microfone, saída de áudio, supressão de ruído (GTCRN, RNNoise, Speex, do navegador ou desligada), porta de ruído (noise gate), ganho e teste de microfone com retorno e medidor comparativo.
- Áudio Opus 48 kHz mono a 64 kb/s com DTX e RED; cancelamento de eco e ganho automático sempre ligados.
- O servidor emite o token LiveKit em `POST /voice/:canal/token` usando `LIVEKIT_URL`, `LIVEKIT_API_KEY` e `LIVEKIT_API_SECRET`. Sem essas variáveis, a voz fica desativada.
- Sem Docker, dá para usar o LiveKit de produção no dev local (`LIVEKIT_URL=wss://lk.turtlechat.tech` e as chaves de produção) e o banco em memória (sem `DATABASE_URL`). Chamada com amigos de outra rede só depois do deploy do backend.

O primeiro cadastro usa o `BOOTSTRAP_INVITE` e vira admin; admins geram convites e criam canais.
Plano de desenvolvimento: marcos 0 a 5 (fundação, chat, voz, tela/câmera, design, extras).

## Publicar (produção)

Uma imagem só (`Dockerfile`) roda a API, o WebSocket e entrega o site compilado na mesma origem (`CLIENT_DIST`). `infra/docker-compose.prod.yml` sobe Postgres, LiveKit, o app e o Caddy (HTTPS automático) para `app.ogturtle.xyz` e `lk.ogturtle.xyz`:

```bash
cp infra/.env.prod.example infra/.env   # preencha as senhas e as chaves do LiveKit
docker compose -f infra/docker-compose.prod.yml up -d --build
```

O primeiro cadastro usa `BOOTSTRAP_INVITE`; esse primeiro usuário vira admin e dono do servidor "Turtle". Portas a liberar no firewall: 80, 443, 7881/tcp, 7882/udp e 3478/udp. O app desktop aponta para o site publicado com `TURTLE_CLIENT_URL=https://app.ogturtle.xyz pnpm desktop`.

Instalador do Windows (já aponta para o site publicado e se atualiza sozinho): `pnpm desktop:dist` em Windows, ou o workflow "Desktop (Windows)" no GitHub Actions. Detalhes e como publicar uma versão em [docs/planos/instalador-desktop.md](docs/planos/instalador-desktop.md).
