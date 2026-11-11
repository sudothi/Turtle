import { createDb } from "@turtle/db";
import { waitlistMailer } from "./waitlist-mail.js";

// Carrega o .env da raiz do repositório em dev (não sobrescreve variáveis já definidas).
try {
  process.loadEnvFile(new URL("../../../.env", import.meta.url));
} catch {
  // sem .env: usa só o ambiente
}
const { buildApp, serverLogger } = await import("./app.js");

const port = Number(process.env.PORT ?? 3000);
const { db, close } = await createDb(process.env.DATABASE_URL);
const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
const livekit =
  LIVEKIT_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET
    ? { url: LIVEKIT_URL, apiKey: LIVEKIT_API_KEY, apiSecret: LIVEKIT_API_SECRET }
    : undefined;
if (!livekit) console.warn("LIVEKIT_URL/API_KEY/API_SECRET ausentes: chamadas de voz desativadas");
// Em produção, CLIENT_DIST aponta para o site compilado (apps/client/dist).
// Logs em JSON (uma linha por evento) ligados em produção; LOG_LEVEL=silent desliga, debug mostra mais.
const level = process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "warn");
const waitlistNotify = waitlistMailer(process.env);
if (!waitlistNotify) console.warn("SMTP não configurado: cadastros da waiting list serão salvos; notificações por e-mail ficam pendentes.");
// Discoteca: com YTDLP_PATH, toca links do YouTube/SoundCloud/Bandcamp e a música completa da busca; sem ele, só prévias de 30 s.
// YTDLP_ARGS troca os argumentos extras (padrão: usar o Node do servidor para os desafios de JavaScript do YouTube).
const ytdlpPath = process.env.YTDLP_PATH || undefined;
if (!ytdlpPath) console.warn("YTDLP_PATH ausente: a discoteca toca só prévias de 30 s do Deezer");
const jukebox = {
  ytdlp: ytdlpPath,
  ytdlpArgs: (process.env.YTDLP_ARGS || "--js-runtimes node").split(/\s+/).filter(Boolean),
  // YTDLP_COOKIES: cookies.txt de uma conta Google descartável (o YouTube barra IP de datacenter sem login). Fica só na VPS.
  ytdlpCookies: process.env.YTDLP_COOKIES || undefined,
  cacheDir: process.env.MUSIC_CACHE_DIR || undefined,
  cacheMb: Number(process.env.MUSIC_CACHE_MB) || undefined,
};
const app = await buildApp({
  db, bootstrapInvite: process.env.BOOTSTRAP_INVITE, livekit, clientDir: process.env.CLIENT_DIST, uploadDir: process.env.UPLOAD_DIR,
  logger: level === "silent" ? false : serverLogger(level),
  waitlistNotify, jukebox,
  siteOrigins: (process.env.SITE_ORIGINS ?? "https://ogturtle.xyz,https://www.ogturtle.xyz").split(",").map((o) => o.trim()).filter(Boolean),
});
// Promessa rejeitada sem tratamento vira log, não queda do servidor (que derrubaria o chat de todo mundo).
process.on("unhandledRejection", (err) => app.log.error({ err }, "promessa rejeitada sem tratamento"));
// Deploy ou docker stop: fecha as conexões direito (os clientes reconectam sozinhos) e o banco, em até 10 s.
let stopping = false;
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    if (stopping) return;
    stopping = true;
    app.log.info({ sig }, "desligando");
    setTimeout(() => process.exit(1), 10_000).unref();
    void app.close().then(() => close()).then(() => process.exit(0), () => process.exit(1));
  });
}
await app.listen({ port, host: "0.0.0.0" });
console.log(`turtle server on :${port}${process.env.DATABASE_URL ? "" : " (banco em memória)"}`);
