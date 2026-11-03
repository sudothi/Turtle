# Turtle

Chat privado estilo Discord, preto e branco (linocut), focado em chamadas, tela e câmera.

## Rodar local
```
pnpm install
cp .env.example .env
pnpm infra:up   # Postgres + LiveKit
pnpm dev        # server :3000, client :5173
```
O servidor lê o `.env` da raiz sozinho. Com `DATABASE_URL` definido o servidor usa Postgres; sem ele usa um banco em memória (some ao reiniciar).
## Voz (marco 2)
- Canais de voz aparecem na barra lateral com quem está dentro; clicar entra na chamada. Mudo, ensurdecer, volume por pessoa e indicador de quem fala.
- ⚙ abre as configurações: microfone, saída de áudio, supressão de ruído (RNNoise, do navegador ou desligada) e teste de microfone com retorno.
- Áudio Opus 48 kHz mono a 64 kb/s com DTX e RED; cancelamento de eco e ganho automático sempre ligados.
- O servidor emite o token LiveKit em `POST /voice/:canal/token` usando `LIVEKIT_URL`, `LIVEKIT_API_KEY` e `LIVEKIT_API_SECRET`. Sem essas variáveis, a voz fica desativada.
- Sem Docker, dá para usar o LiveKit de produção no dev local (`LIVEKIT_URL=wss://lk.ogturtle.xyz` e as chaves de produção) e o banco em memória (sem `DATABASE_URL`). Chamada com amigos de outra rede só depois do deploy do backend.

O primeiro cadastro usa o `BOOTSTRAP_INVITE` e vira admin; admins geram convites e criam canais.
Plano de desenvolvimento: marcos 0 a 5 (fundação, chat, voz, tela/câmera, design, extras).
