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
ENV NODE_ENV=production PORT=3000 CLIENT_DIST=/app/client
WORKDIR /app
COPY --from=build /out ./
# Pasta dos uploads (fotos/banners): o volume nomeado herda esse dono na primeira montagem.
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/index.js"]
