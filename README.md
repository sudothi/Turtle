# Turtle

Chat privado estilo Discord, preto e branco (linocut), focado em chamadas, tela e câmera.

## Rodar local
```
pnpm install
cp .env.example .env
pnpm infra:up   # Postgres + LiveKit
pnpm dev        # server :3000, client :5173
```
Com `DATABASE_URL` definido o servidor usa Postgres; sem ele usa um banco em memória (some ao reiniciar).
O primeiro cadastro usa o `BOOTSTRAP_INVITE` e vira admin; admins geram convites e criam canais.
Plano de desenvolvimento: marcos 0 a 5 (fundação, chat, voz, tela/câmera, design, extras).
