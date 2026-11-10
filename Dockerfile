# Imagem de produção do Turtle: servidor (API + WebSocket) e o site compilado na mesma origem.
# Build:  docker build -t turtle-app .
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app
COPY . .
# Só o servidor e o site (sem o Electron, que baixaria centenas de MB à toa).
RUN pnpm install --frozen-lockfile --filter "@turtle/server..." --filter "@turtle/client..."
RUN pnpm --filter "@turtle/server..." --filter "@turtle/client..." build
RUN pnpm --filter @turtle/server deploy --legacy --prod /out && cp -r apps/client/dist /out/client

FROM node:22-slim
# yt-dlp da discoteca (binário único, sem Python), com versão e hash fixos. Atualizar quando o YouTube quebrar:
# troque a versão e o hash (SHA2-256SUMS da release, linha "yt-dlp_linux").
ARG YTDLP_VERSION=2026.10.26
ARG YTDLP_SHA256=767ba9dce7052aa196f8b12652f433d76de128ba168966fa84b6394d5e6c6795
RUN node -e "const [v,h]=process.argv.slice(1);fetch('https://github.com/yt-dlp/yt-dlp/releases/download/'+v+'/yt-dlp_linux').then(r=>{if(!r.ok)throw new Error('http '+r.status);return r.arrayBuffer()}).then(b=>{b=Buffer.from(b);const got=require('crypto').createHash('sha256').update(b).digest('hex');if(got!==h)throw new Error('hash '+got);require('fs').writeFileSync('/usr/local/bin/yt-dlp',b,{mode:0o755})}).catch(e=>{console.error(e);process.exit(1)})" "$YTDLP_VERSION" "$YTDLP_SHA256"
ENV NODE_ENV=production PORT=3000 CLIENT_DIST=/app/client YTDLP_PATH=/usr/local/bin/yt-dlp MUSIC_CACHE_DIR=/data/music-cache
WORKDIR /app
COPY --from=build /out ./
# Pasta dos uploads (fotos/banners): o volume nomeado herda esse dono na primeira montagem.
# O cache da discoteca fica fora do volume (não entra no backup; some no deploy, o que não faz falta).
RUN mkdir -p /data/uploads /data/music-cache && chown -R node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/index.js"]
