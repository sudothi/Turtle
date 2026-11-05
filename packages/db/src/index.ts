import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "./schema.js";

export * from "./schema.js";
export { schema };
export { and, asc, count, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export const MIGRATION = `
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

-- Perfil (nome de exibição, bio, foto e banner).
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_key text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS banner_key text;
-- Cargo que pode gerar convites de conta além do admin.
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_invite boolean NOT NULL DEFAULT false;

-- Servidores (marco 3.5). Tudo idempotente: roda a cada inicialização.
CREATE TABLE IF NOT EXISTS servers (
  id text PRIMARY KEY, name text NOT NULL, owner_id text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS server_members (
  server_id text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member', joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (server_id, user_id));
CREATE INDEX IF NOT EXISTS server_members_user_idx ON server_members (user_id);
CREATE TABLE IF NOT EXISTS server_invites (
  code text PRIMARY KEY, server_id text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  created_by text NOT NULL, expires_at timestamptz, max_uses integer, uses integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE channels ADD COLUMN IF NOT EXISTS server_id text REFERENCES servers(id) ON DELETE CASCADE;
ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_name_key;

-- Bancos de antes dos servidores: tudo vira o servidor "Turtle" (dono = primeiro admin).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM channels WHERE server_id IS NULL) AND EXISTS (SELECT 1 FROM users) THEN
    INSERT INTO servers (id, name, owner_id)
      SELECT 'turtle', 'Turtle', id FROM users ORDER BY is_admin DESC, created_at LIMIT 1
      ON CONFLICT DO NOTHING;
    INSERT INTO server_members (server_id, user_id, role)
      SELECT 'turtle', u.id, CASE WHEN u.id = (SELECT owner_id FROM servers WHERE id = 'turtle') THEN 'owner' ELSE 'member' END
      FROM users u ON CONFLICT DO NOTHING;
    UPDATE channels SET server_id = 'turtle' WHERE server_id IS NULL;
  END IF;
END $$;
DELETE FROM channels WHERE server_id IS NULL AND kind <> 'dm';
-- server_id fica nulo nas conversas diretas (kind = 'dm').
ALTER TABLE channels ALTER COLUMN server_id DROP NOT NULL;

-- Amigos: um par por linha, com user_a < user_b para não duplicar.
CREATE TABLE IF NOT EXISTS friendships (
  user_a text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending', requested_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_a, user_b));
CREATE INDEX IF NOT EXISTS friendships_b_idx ON friendships (user_b);
-- Mensagens diretas 1:1: o canal (kind = 'dm') tem exatamente dois membros.
CREATE TABLE IF NOT EXISTS dm_members (
  channel_id text NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (channel_id, user_id));
CREATE INDEX IF NOT EXISTS dm_members_user_idx ON dm_members (user_id);
-- Conversa em grupo (3+ pessoas) e bloqueios entre contas.
ALTER TABLE channels ADD COLUMN IF NOT EXISTS is_group boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS blocks (
  blocker text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker, blocked));
CREATE INDEX IF NOT EXISTS blocks_blocked_idx ON blocks (blocked);
CREATE UNIQUE INDEX IF NOT EXISTS channels_server_name_idx ON channels (server_id, name);

-- Status (Não perturbe), ícone do servidor e mensagens editadas.
ALTER TABLE users ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'online';
ALTER TABLE servers ADD COLUMN IF NOT EXISTS icon_key text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at timestamptz;
-- Anexos do chat (os arquivos ficam na pasta de uploads).
CREATE TABLE IF NOT EXISTS attachments (
  id text PRIMARY KEY,
  channel_id text NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  message_id text REFERENCES messages(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_key text NOT NULL, name text NOT NULL, size integer NOT NULL, mime text NOT NULL,
  width integer, height integer, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS attachments_message_idx ON attachments (message_id);
CREATE UNIQUE INDEX IF NOT EXISTS attachments_key_idx ON attachments (file_key);
-- Não lidas. Na primeira vez, tudo o que já existe conta como lido (ninguém abre o app com 500 não lidas).
DO $$
BEGIN
  IF to_regclass('read_states') IS NULL THEN
    CREATE TABLE read_states (
      user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      channel_id text NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      last_read_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, channel_id));
    INSERT INTO read_states (user_id, channel_id)
      SELECT m.user_id, c.id FROM server_members m JOIN channels c ON c.server_id = m.server_id WHERE c.kind = 'text'
      UNION SELECT user_id, channel_id FROM dm_members
      ON CONFLICT DO NOTHING;
  END IF;
END $$;
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
