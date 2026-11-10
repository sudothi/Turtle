# Cartão de música (link do Spotify no chat)

Colar um link de faixa do Spotify (`open.spotify.com/track/...`, com ou sem `intl-xx` e `?si=`, ou `spotify.link/...`) no chat ou na DM mostra um cartão com a capa, o nome, o artista e um vinil que sai de trás da capa e gira enquanto toca a prévia de 30 s.

## De onde vem cada coisa
- **Título, artista, álbum, duração e capa:** página pública da faixa no Spotify (`og:*` e `music:*`). Não usa a API do Spotify nem precisa de login.
- **Áudio:** a API do Spotify não entrega mais `preview_url` para apps novos (mudança de 27/11/2024). A prévia vem da API pública do Deezer: o servidor procura a mesma faixa (título igual e mesmo artista ou duração com até 4 s de diferença) e baixa o MP3 de 30 s. O link do Deezer expira, então ele é pedido de novo quando alguém toca.
- Sem a faixa no Deezer, o cartão aparece sem botão de tocar, só com "Abrir no Spotify". Se a página do Spotify não responder, volta a prévia de link comum.

## Servidor (`apps/server/src/music.ts`)
- `GET /music/spotify?url=` (login, 30 por minuto por pessoa) devolve `MusicTrack` (`packages/protocol`).
- `GET /music/:id/cover` devolve a capa em WebP 320x320; `GET /music/:id/preview` devolve o MP3. Os dois só servem faixa já resolvida e exigem login (o cliente baixa como blob).
- Só alcança hosts fixos (`open.spotify.com`, `spotify.link`, `*.scdn.co`, `*.spotifycdn.com`, `api.deezer.com`, `*.dzcdn.net`), inclusive depois de redirecionar. Limites: página 1 MB, capa 4 MB, áudio 3 MB, 6 s. Cache em memória (faixa 1 dia; falha tentada de novo em 10 min).
- Capa e áudio passam pelo servidor: a CSP só libera mídia do próprio domínio e o Spotify/Deezer não veem o IP de quem ouve.

## Cliente
- `apps/client/src/music.ts`: um `<audio>` só para o app todo; tocar em outro cartão para o anterior; o cartão que some da tela para a música.
- `components/MusicCard.tsx` e `chat.css` (`.music-*`): capa em preto e branco (filtro), vinil SVG entalhado com estrela no selo, barra de progresso. Com `prefers-reduced-motion` o vinil não gira nem desliza.

## Próximos passos
- Android nativo: mesmo cartão em Compose com Media3 (o Android ainda não tem prévia de link).
- Escolher o trecho (janela de 15 s dentro dos 30 s) guardado na mensagem.
- Termos: a prévia do Deezer é usada sem acordo oficial (app privado, sem fins comerciais); o cartão mostra "prévia via Deezer".
