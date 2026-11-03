import { createDb } from "@turtle/db";

// Carrega o .env da raiz do repositório em dev (não sobrescreve variáveis já definidas).
try {
  process.loadEnvFile(new URL("../../../.env", import.meta.url));
} catch {
  // sem .env: usa só o ambiente
}
const { buildApp } = await import("./app.js");

const port = Number(process.env.PORT ?? 3000);
const { db } = await createDb(process.env.DATABASE_URL);
const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
const livekit =
  LIVEKIT_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET
    ? { url: LIVEKIT_URL, apiKey: LIVEKIT_API_KEY, apiSecret: LIVEKIT_API_SECRET }
    : undefined;
if (!livekit) console.warn("LIVEKIT_URL/API_KEY/API_SECRET ausentes: chamadas de voz desativadas");
const app = await buildApp({ db, bootstrapInvite: process.env.BOOTSTRAP_INVITE, livekit });
await app.listen({ port, host: "0.0.0.0" });
console.log(`turtle server on :${port}${process.env.DATABASE_URL ? "" : " (banco em memória)"}`);
