import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "./schema.js";

export * from "./schema.js";
export { schema };
export { and, asc, count, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";

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
-- Só roda num banco que ainda não tem nenhum servidor. Conversas diretas (kind = 'dm') também têm
-- server_id nulo e nunca podem disparar isso: antes, cada reinício com uma DM existente punha todo
-- mundo no "Turtle" (recriando-o se tivesse sido apagado) e levava as DMs para dentro dele.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM servers)
     AND EXISTS (SELECT 1 FROM channels WHERE server_id IS NULL AND kind <> 'dm')
     AND EXISTS (SELECT 1 FROM users) THEN
    INSERT INTO servers (id, name, owner_id)
      SELECT 'turtle', 'Turtle', id FROM users ORDER BY is_admin DESC, created_at LIMIT 1
      ON CONFLICT DO NOTHING;
    INSERT INTO server_members (server_id, user_id, role)
      SELECT 'turtle', u.id, CASE WHEN u.id = (SELECT owner_id FROM servers WHERE id = 'turtle') THEN 'owner' ELSE 'member' END
      FROM users u ON CONFLICT DO NOTHING;
    UPDATE channels SET server_id = 'turtle' WHERE server_id IS NULL AND kind <> 'dm';
  END IF;
END $$;
DELETE FROM channels WHERE server_id IS NULL AND kind <> 'dm';
-- server_id fica nulo nas conversas diretas (kind = 'dm').
ALTER TABLE channels ALTER COLUMN server_id DROP NOT NULL;
-- Conserta DMs que o bug acima levou para dentro de um servidor: DM nunca tem servidor.
UPDATE channels SET server_id = NULL WHERE kind = 'dm' AND server_id IS NOT NULL;

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
-- Nome de usuário único sem diferenciar maiúsculas ("Thiago" e "thiago" não podem coexistir).
-- Só cria o índice se o banco ainda não tem nomes repetidos nessa forma (senão o servidor não subiria).
DO $$
BEGIN
  IF to_regclass('users_username_lower_idx') IS NULL
     AND NOT EXISTS (SELECT 1 FROM users GROUP BY lower(username) HAVING count(*) > 1) THEN
    CREATE UNIQUE INDEX users_username_lower_idx ON users (lower(username));
  END IF;
END $$;
-- Responder a uma mensagem (sem chave estrangeira: a resposta continua quando a original é apagada).
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to text;
CREATE INDEX IF NOT EXISTS messages_reply_to_idx ON messages (reply_to);
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
-- Banimentos de servidor: quem foi banido não volta por convite.
CREATE TABLE IF NOT EXISTS server_bans (
  server_id text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  banned_by text NOT NULL, reason text, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (server_id, user_id));
-- Reações com emoji.
CREATE TABLE IF NOT EXISTS reactions (
  message_id text NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji));
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

-- Validade deslizante das sessões (30 dias sem uso), aparelho/último uso e contas desativadas (#89).
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_at timestamptz;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS id text DEFAULT (gen_random_uuid()::text);
UPDATE sessions SET id = gen_random_uuid()::text WHERE id IS NULL;
ALTER TABLE sessions ALTER COLUMN id SET DEFAULT (gen_random_uuid()::text);
ALTER TABLE sessions ALTER COLUMN id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sessions_id_idx ON sessions (id);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_agent text;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_used_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days');
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
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
