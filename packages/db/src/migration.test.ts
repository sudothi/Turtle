import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { MIGRATION } from "./index.js";

/** O esquema de antes dos servidores, como estava em produção/local. */
const LEGACY = `
CREATE TABLE users (id text PRIMARY KEY, username text NOT NULL UNIQUE, password_hash text NOT NULL,
  is_admin boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE sessions (token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE invites (code text PRIMARY KEY, created_by text, used_by text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE channels (id text PRIMARY KEY, name text NOT NULL UNIQUE, kind text NOT NULL DEFAULT 'text', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE messages (id text PRIMARY KEY, channel_id text NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id), content text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
`;

describe("migração para servidores", () => {
  it("coloca canais e pessoas de um banco antigo no servidor Turtle, com o primeiro admin como dono", async () => {
    const db = new PGlite();
    await db.exec(LEGACY);
    await db.exec(`
      INSERT INTO users (id, username, password_hash, is_admin, created_at) VALUES
        ('u2', 'amigo', 'x', false, now() - interval '1 day'),
        ('u1', 'thiago', 'x', true, now());
      INSERT INTO channels (id, name, kind) VALUES ('c1', 'geral', 'text'), ('c2', 'Sala', 'voice');
      INSERT INTO messages (id, channel_id, user_id, content) VALUES ('m1', 'c1', 'u2', 'oi');`);
    await db.exec(MIGRATION);
    await db.exec(MIGRATION); // idempotente
    const servers = await db.query<{ id: string; name: string; owner_id: string }>("SELECT id, name, owner_id FROM servers");
    expect(servers.rows).toEqual([{ id: "turtle", name: "Turtle", owner_id: "u1" }]);
    const members = await db.query<{ user_id: string; role: string }>("SELECT user_id, role FROM server_members ORDER BY user_id");
    expect(members.rows).toEqual([{ user_id: "u1", role: "owner" }, { user_id: "u2", role: "member" }]);
    const channels = await db.query<{ id: string; server_id: string }>("SELECT id, server_id FROM channels ORDER BY id");
    expect(channels.rows).toEqual([{ id: "c1", server_id: "turtle" }, { id: "c2", server_id: "turtle" }]);
    expect((await db.query("SELECT id FROM messages")).rows).toHaveLength(1);
    // nome de canal agora é único por servidor, não global
    await db.exec(`INSERT INTO servers (id, name, owner_id) VALUES ('s2', 'Outro', 'u1')`);
    await db.exec(`INSERT INTO channels (id, server_id, name) VALUES ('c3', 's2', 'geral')`);
    await expect(db.exec(`INSERT INTO channels (id, server_id, name) VALUES ('c4', 's2', 'geral')`)).rejects.toThrow();
  });

  it("banco antigo sem usuários: descarta os canais soltos e o primeiro cadastro cria o servidor", async () => {
    const db = new PGlite();
    await db.exec(LEGACY);
    await db.exec(`INSERT INTO channels (id, name) VALUES ('c1', 'geral')`);
    await db.exec(MIGRATION);
    expect((await db.query("SELECT id FROM channels")).rows).toHaveLength(0);
    expect((await db.query("SELECT id FROM servers")).rows).toHaveLength(0);
  });

  it("não lidas: na primeira vez, o que já existe conta como lido; depois não mexe mais", async () => {
    const db = new PGlite();
    await db.exec(LEGACY);
    await db.exec(`
      INSERT INTO users (id, username, password_hash, is_admin) VALUES ('u1', 'thiago', 'x', true), ('u2', 'amigo', 'x', false);
      INSERT INTO channels (id, name, kind) VALUES ('c1', 'geral', 'text'), ('c2', 'Sala', 'voice');`);
    await db.exec(MIGRATION);
    const seeded = await db.query<{ user_id: string; channel_id: string }>("SELECT user_id, channel_id FROM read_states ORDER BY user_id");
    expect(seeded.rows).toEqual([{ user_id: "u1", channel_id: "c1" }, { user_id: "u2", channel_id: "c1" }]);
    await db.exec("DELETE FROM read_states WHERE user_id = 'u2'");
    await db.exec(MIGRATION);
    expect((await db.query("SELECT 1 FROM read_states")).rows).toHaveLength(1);
  });
  it("reiniciar com DMs existentes não cria o servidor Turtle nem mexe em membros", async () => {
    const db = new PGlite();
    await db.exec(MIGRATION);
    await db.exec(`
      INSERT INTO users (id, username, password_hash, is_admin) VALUES
        ('u1', 'thiago', 'x', true), ('u2', 'amigo', 'x', false), ('u3', 'novo', 'x', false);
      INSERT INTO servers (id, name, owner_id) VALUES ('s1', 'Servidor 1', 'u1');
      INSERT INTO server_members (server_id, user_id, role) VALUES ('s1', 'u1', 'owner'), ('s1', 'u2', 'member');
      INSERT INTO channels (id, server_id, name, kind) VALUES ('c1', 's1', 'geral', 'text');
      INSERT INTO channels (id, server_id, name, kind) VALUES ('d1', NULL, '', 'dm'), ('d2', NULL, '', 'dm');
      INSERT INTO dm_members (channel_id, user_id) VALUES ('d1', 'u1'), ('d1', 'u3'), ('d2', 'u2'), ('d2', 'u3');`);
    await db.exec(MIGRATION); // como um reinício/deploy
    expect((await db.query("SELECT id FROM servers")).rows).toEqual([{ id: "s1" }]);
    const members = await db.query("SELECT server_id, user_id FROM server_members ORDER BY user_id");
    expect(members.rows).toEqual([{ server_id: "s1", user_id: "u1" }, { server_id: "s1", user_id: "u2" }]);
    const dms = await db.query("SELECT id, server_id FROM channels WHERE kind = 'dm' ORDER BY id");
    expect(dms.rows).toEqual([{ id: "d1", server_id: null }, { id: "d2", server_id: null }]);
  });

  it("devolve para fora do servidor as DMs que o bug antigo tinha levado para dentro", async () => {
    const db = new PGlite();
    await db.exec(MIGRATION);
    await db.exec(`
      INSERT INTO users (id, username, password_hash, is_admin) VALUES ('u1', 'thiago', 'x', true), ('u2', 'amigo', 'x', false);
      INSERT INTO servers (id, name, owner_id) VALUES ('turtle', 'Turtle', 'u1');
      INSERT INTO channels (id, server_id, name, kind) VALUES ('d1', 'turtle', '', 'dm');`);
    await db.exec(MIGRATION);
    expect((await db.query("SELECT server_id FROM channels WHERE id = 'd1'")).rows).toEqual([{ server_id: null }]);
  });
});
