import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "./schema.js";

export * from "./schema.js";
export { schema };
export { and, desc, eq, lt, sql } from "drizzle-orm";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const MIGRATION = `
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY, username text NOT NULL UNIQUE, password_hash text NOT NULL,
  is_admin boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS invites (
  code text PRIMARY KEY, created_by text, used_by text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS channels (
  id text PRIMARY KEY, name text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS messages (
  id text PRIMARY KEY, channel_id text NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id), content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS messages_channel_created_idx ON messages (channel_id, created_at);
ALTER TABLE channels ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'text';
`;

export interface DbHandle {
  db: Db;
  close(): Promise<void>;
}

/** Sem `url`, usa Postgres embutido em memória (PGlite), útil para testes. */
export async function createDb(url?: string): Promise<DbHandle> {
  if (url) {
    const client = postgres(url, { max: 10 });
    await client.unsafe(MIGRATION);
    return { db: drizzlePostgres(client, { schema }) as unknown as Db, close: () => client.end() };
  }
  const client = new PGlite();
  await client.exec(MIGRATION);
  return { db: drizzlePglite(client, { schema }) as unknown as Db, close: () => client.close() };
}
