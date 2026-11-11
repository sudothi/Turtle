# Site público separado do app (ogturtle.xyz × turtlechat.tech)

Decisão do thiago (2026-11-11): `ogturtle.xyz` é só o site público (início/fila de espera e download), num repositório à parte (`sudothi/turtlesite`) hospedado na Vercel. `turtlechat.tech` é o domínio interno do app dos amigos, com LiveKit em `lk.turtlechat.tech`.

## Peças
- **Site** (`sudothi/turtlesite`): Vite + React estático. `/` = fila de espera, `/download` = instalador. Envia o e-mail para `https://turtlechat.tech/waitlist` e lê `https://turtlechat.tech/desktop/latest.yml`.
- **API**: `POST /waitlist` aceita CORS só das origens de `SITE_ORIGINS` (padrão `https://ogturtle.xyz,https://www.ogturtle.xyz`). O Caddy libera o mesmo origin em `/desktop/*`.
- **App** (`apps/client`): sem página inicial/download; qualquer rota sem login mostra o login.
- **Caddy**: `DOMAIN_APP=turtlechat.tech`, `DOMAIN_LK=lk.turtlechat.tech`, e `DOMAIN_APP_LEGACY=app.ogturtle.xyz` continua servindo o app e `/desktop/`, porque o desktop 0.1–0.3 e o APK instalados apontam para lá (carregam a interface de lá e procuram atualização lá). Remover quando todos atualizarem.

## Migração (precisa de ok escrito; ordem importa)
1. DNS: `turtlechat.tech` e `lk.turtlechat.tech` → IP da VPS (feito 2026-11-11).
2. VPS: novo Caddyfile + compose, mantendo os domínios antigos; o Caddy emite os certificados novos. Conferir `https://turtlechat.tech/health`.
3. Só depois: `livekit.yaml` com o domínio e o certificado novos, `LIVEKIT_URL` e reinício do LiveKit (derruba as chamadas por alguns segundos).
4. Deploy do app (esta PR). Publicar novo instalador desktop (aponta para turtlechat.tech).
5. Vercel: adicionar `ogturtle.xyz` e `www` no projeto e criar no DNS da Hostinger os registros que ela mostrar. `app.ogturtle.xyz` e `lk.ogturtle.xyz` ficam no DNS enquanto o domínio antigo for necessário.
