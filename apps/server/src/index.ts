import { createDb } from "@turtle/db";
import { buildApp } from "./app.js";

const port = Number(process.env.PORT ?? 3000);
const { db } = await createDb(process.env.DATABASE_URL);
const app = await buildApp({ db, bootstrapInvite: process.env.BOOTSTRAP_INVITE });
await app.listen({ port, host: "0.0.0.0" });
console.log(`turtle server on :${port}${process.env.DATABASE_URL ? "" : " (banco em memória)"}`);
