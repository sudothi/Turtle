import Fastify, { type FastifyRequest } from "fastify";
import websocket from "@fastify/websocket";
import { and, channels, desc, eq, invites, lt, messages, sessions, users, type Db } from "@turtle/db";
import {
  clientEvent,
  createChannelBody,
  loginBody,
  registerBody,
  type Message,
  type ServerEvent,
  type User,
} from "@turtle/protocol";
import { hashPassword, hashToken, newId, newInviteCode, newToken, verifyPassword } from "./auth.js";

export interface AppOptions {
  db: Db;
  /** Convite inicial criado se ainda não existe nenhum usuário (primeiro usuário vira admin). */
  bootstrapInvite?: string;
}

interface Socket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: "message" | "close", cb: (...args: any[]) => void): void;
}

export async function buildApp({ db, bootstrapInvite }: AppOptions) {
  const app = Fastify({ logger: false });
  await app.register(websocket);

  const online = new Map<Socket, User>();
  const broadcast = (evt: ServerEvent) => {
    const data = JSON.stringify(evt);
    for (const s of online.keys()) s.send(data);
  };
  const presence = () => broadcast({ t: "presence", online: [...new Set([...online.values()].map((u) => u.username))] });

  if (bootstrapInvite) {
    const any = await db.select({ id: users.id }).from(users).limit(1);
    if (any.length === 0) await db.insert(invites).values({ code: bootstrapInvite }).onConflictDoNothing();
  }
  const general = await db.select().from(channels).where(eq(channels.name, "geral")).limit(1);
  if (general.length === 0) await db.insert(channels).values({ id: newId(), name: "geral" });

  async function userFromToken(token: string | undefined): Promise<User | null> {
    if (!token) return null;
    const rows = await db
      .select({ id: users.id, username: users.username, isAdmin: users.isAdmin })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.tokenHash, hashToken(token)))
      .limit(1);
    return rows[0] ?? null;
  }
  const bearer = (req: FastifyRequest) => req.headers.authorization?.replace(/^Bearer /, "");

  async function startSession(userId: string) {
    const token = newToken();
    await db.insert(sessions).values({ tokenHash: hashToken(token), userId });
    return token;
  }

  app.get("/health", async () => ({ ok: true }));

  app.post("/auth/register", async (req, reply) => {
    const body = registerBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "dados inválidos" });
    const { inviteCode, username, password } = body.data;
    const invite = (await db.select().from(invites).where(eq(invites.code, inviteCode)).limit(1))[0];
    if (!invite || invite.usedBy) return reply.code(403).send({ error: "convite inválido" });
    if ((await db.select().from(users).where(eq(users.username, username)).limit(1)).length)
      return reply.code(409).send({ error: "nome já em uso" });
    const isFirst = (await db.select({ id: users.id }).from(users).limit(1)).length === 0;
    const id = newId();
    await db.insert(users).values({ id, username, passwordHash: await hashPassword(password), isAdmin: isFirst });
    await db.update(invites).set({ usedBy: id }).where(eq(invites.code, inviteCode));
    return { token: await startSession(id), user: { id, username, isAdmin: isFirst } satisfies User };
  });

  app.post("/auth/login", async (req, reply) => {
    const body = loginBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "dados inválidos" });
    const row = (await db.select().from(users).where(eq(users.username, body.data.username)).limit(1))[0];
    if (!row || !(await verifyPassword(body.data.password, row.passwordHash)))
      return reply.code(401).send({ error: "usuário ou senha incorretos" });
    return { token: await startSession(row.id), user: { id: row.id, username: row.username, isAdmin: row.isAdmin } satisfies User };
  });

  // Rotas autenticadas
  app.register(async (authed) => {
    authed.decorateRequest("user", null);
    authed.addHook("preHandler", async (req, reply) => {
      const user = await userFromToken(bearer(req));
      if (!user) return reply.code(401).send({ error: "não autenticado" });
      (req as any).user = user;
    });
    const me = (req: FastifyRequest) => (req as any).user as User;

    authed.get("/me", async (req) => me(req));

    authed.get("/channels", async () => db.select({ id: channels.id, name: channels.name }).from(channels).orderBy(channels.createdAt));

    authed.post("/channels", async (req, reply) => {
      if (!me(req).isAdmin) return reply.code(403).send({ error: "só admin" });
      const body = createChannelBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: "dados inválidos" });
      const channel = { id: newId(), name: body.data.name };
      try {
        await db.insert(channels).values(channel);
      } catch {
        return reply.code(409).send({ error: "canal já existe" });
      }
      broadcast({ t: "channel", channel });
      return channel;
    });

    authed.post("/invites", async (req, reply) => {
      if (!me(req).isAdmin) return reply.code(403).send({ error: "só admin" });
      const code = newInviteCode();
      await db.insert(invites).values({ code, createdBy: me(req).id });
      return { code };
    });

    authed.get<{ Params: { id: string }; Querystring: { before?: string; limit?: string } }>(
      "/channels/:id/messages",
      async (req) => {
        const limit = Math.min(Number(req.query.limit ?? 50) || 50, 100);
        const before = req.query.before ? new Date(req.query.before) : undefined;
        const rows = await db
          .select({ id: messages.id, channelId: messages.channelId, userId: messages.userId, username: users.username, content: messages.content, createdAt: messages.createdAt })
          .from(messages)
          .innerJoin(users, eq(users.id, messages.userId))
          .where(and(eq(messages.channelId, req.params.id), before ? lt(messages.createdAt, before) : undefined))
          .orderBy(desc(messages.createdAt))
          .limit(limit);
        return rows.reverse().map((r): Message => ({ ...r, createdAt: r.createdAt.toISOString() }));
      },
    );
  });

  app.register(async (instance) => {
    instance.get<{ Querystring: { token?: string } }>("/ws", { websocket: true }, async (socket: Socket, req) => {
      const user = await userFromToken(req.query.token);
      if (!user) return socket.close(4401, "unauthorized");
      online.set(socket, user);
      presence();
      socket.on("close", () => {
        online.delete(socket);
        presence();
      });
      socket.on("message", async (raw: Buffer) => {
        let evt;
        try {
          evt = clientEvent.parse(JSON.parse(raw.toString()));
        } catch {
          return socket.send(JSON.stringify({ t: "error", error: "evento inválido" } satisfies ServerEvent));
        }
        if (evt.t === "ping") return socket.send(JSON.stringify({ t: "pong" } satisfies ServerEvent));
        const channel = (await db.select({ id: channels.id }).from(channels).where(eq(channels.id, evt.channelId)).limit(1))[0];
        if (!channel) return socket.send(JSON.stringify({ t: "error", error: "canal não existe" } satisfies ServerEvent));
        const message: Message = {
          id: newId(), channelId: evt.channelId, userId: user.id, username: user.username,
          content: evt.content, createdAt: new Date().toISOString(),
        };
        await db.insert(messages).values({ id: message.id, channelId: message.channelId, userId: user.id, content: message.content, createdAt: new Date(message.createdAt) });
        broadcast({ t: "message", message });
      });
    });
  });

  return app;
}
