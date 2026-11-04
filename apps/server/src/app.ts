import Fastify, { type FastifyRequest } from "fastify";
import { AccessToken, RoomServiceClient, TrackSource } from "livekit-server-sdk";
import fastifyStatic from "@fastify/static";
import multipart from "@fastify/multipart";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import websocket from "@fastify/websocket";
import {
  and, asc, blocks, channels, count, desc, dmMembers, eq, friendships, inArray, invites, lt, messages, or, serverInvites, serverMembers, servers, sessions, sql, users, type Db,
} from "@turtle/db";
import {
  AVATAR_MAX_BYTES,
  type Dm,
  GROUP_MAX_MEMBERS,
  addGroupMemberBody,
  createGroupBody,
  type Friend,
  type Person,
  type ProfileView,
  canInviteAccounts,
  setInviterBody,
  type Account,
  BANNER_MAX_BYTES,
  MAX_OWNED_SERVERS,
  clientEvent,
  createChannelBody,
  createInviteBody,
  createServerBody,
  deleteServerBody,
  loginBody,
  registerBody,
  renameServerBody,
  roleBody,
  transferBody,
  updateProfileBody,
  type InvitePreview,
  type Member,
  type Message,
  type Server,
  type ServerEvent,
  type ServerRole,
  type User,
  type VoiceState,
  type VoiceToken,
} from "@turtle/protocol";
import { fileStore, isFileKey, processImage, type ImageKind } from "./profile.js";
import { hashPassword, hashToken, newId, newInviteCode, newToken, verifyPassword } from "./auth.js";

export interface AppOptions {
  db: Db;
  /** Convite inicial criado se ainda não existe nenhum usuário (primeiro usuário vira admin). */
  bootstrapInvite?: string;
  /** Sem isso, o endpoint de token de voz responde 503. */
  livekit?: LiveKitConfig;
  /** Pasta do site já compilado (apps/client/dist). Em produção o servidor entrega o site e a API na mesma origem. */
  clientDir?: string;
  /** Pasta das fotos e banners enviados (precisa de volume em produção). Padrão: ./data/uploads. */
  uploadDir?: string;
}

export interface LiveKitConfig {
  /** URL que o cliente usa para conectar (ws://localhost:7880 local, wss://lk.ogturtle.xyz em produção). */
  url: string;
  apiKey: string;
  apiSecret: string;
}

/** Nome da sala LiveKit de um canal de voz. */
export const voiceRoomName = (channelId: string) => `voice-${channelId}`;

interface Socket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: "message" | "close", cb: (...args: any[]) => void): void;
}

/** Cargos que podem gerir canais e expulsar membros. */
const canManage = (role: ServerRole | undefined) => role === "owner" || role === "admin";

export async function buildApp({ db, bootstrapInvite, livekit, clientDir, uploadDir = "data/uploads" }: AppOptions) {
  const app = Fastify({ logger: false });
  await app.register(websocket);
  await app.register(multipart, { limits: { files: 1, fields: 0, fileSize: BANNER_MAX_BYTES } });
  const files = fileStore(uploadDir);
  if (clientDir) {
    // Arquivos com hash no nome (assets/) nunca mudam; o index.html sempre é revalidado.
    await app.register(fastifyStatic, {
      root: clientDir,
      wildcard: false,
      cacheControl: false,
      setHeaders: (res, path) => {
        res.setHeader("cache-control", /[\\/]assets[\\/]/.test(path) ? "public, max-age=31536000, immutable" : "no-cache");
      },
    });
    // Rotas do app (SPA) que não são arquivos nem API caem no index.html.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && req.headers.accept?.includes("text/html")) return reply.sendFile("index.html");
      return reply.code(404).send({ error: "não encontrado" });
    });
  }

  const room = livekit
    ? new RoomServiceClient(livekit.url.replace(/^ws/, "http"), livekit.apiKey, livekit.apiSecret)
    : undefined;

  const online = new Map<Socket, User>();
  /** Servidores de que cada conexão faz parte: define o que ela pode receber. */
  const memberships = new Map<Socket, Set<string>>();

  /** Conversas diretas de cada conexão: define quem vê a chamada de uma DM. */
  const dmSets = new Map<Socket, Set<string>>();
  const loadDmSet = async (userId: string) =>
    new Set((await db.select({ id: dmMembers.channelId }).from(dmMembers).where(eq(dmMembers.userId, userId))).map((r) => r.id));
  const refreshDmSets = async (userIds: Iterable<string>) => {
    for (const id of new Set(userIds)) {
      const set = await loadDmSet(id);
      for (const [s, u] of online) if (u.id === id) dmSets.set(s, set);
    }
  };
  const loadMemberships = async (userId: string) =>
    new Set((await db.select({ id: serverMembers.serverId }).from(serverMembers).where(eq(serverMembers.userId, userId))).map((r) => r.id));
  const refreshMemberships = async (userId: string) => {
    const set = await loadMemberships(userId);
    for (const [s, u] of online) if (u.id === userId) memberships.set(s, set);
  };
  const sendWhere = (evt: ServerEvent, allow: (s: Socket) => boolean) => {
    const data = JSON.stringify(evt);
    for (const s of online.keys()) if (allow(s)) s.send(data);
  };
  const broadcast = (evt: ServerEvent) => sendWhere(evt, () => true);
  const toServer = (serverId: string, evt: ServerEvent) => sendWhere(evt, (s) => memberships.get(s)?.has(serverId) ?? false);
  const toUsers = (ids: Iterable<string>, evt: ServerEvent) => {
    const set = new Set(ids);
    sendWhere(evt, (s) => set.has(online.get(s)!.id));
  };
  const presence = () => broadcast({ t: "presence", online: [...new Set([...online.values()].map((u) => u.id))] });

  // Estado de voz por conexão WebSocket: some sozinho quando a conexão cai.
  const voice = new Map<Socket, VoiceState>();
  const voiceStatesFor = (socket: Socket): ServerEvent => {
    const mine = memberships.get(socket);
    const seen = new Set<string>();
    const states = [...voice.values()].filter((v) => (v.serverId ? mine?.has(v.serverId) : dmSets.get(socket)?.has(v.channelId)) && !seen.has(v.userId) && seen.add(v.userId));
    return { t: "voiceStates", states };
  };
  const broadcastVoice = () => {
    for (const s of online.keys()) s.send(JSON.stringify(voiceStatesFor(s)));
  };
  /** Tira da chamada quem deixou de ser membro (some das listas e perde a conexão de áudio). */
  const dropFromCalls = async (serverId: string, userId?: string) => {
    const gone: VoiceState[] = [];
    for (const [s, v] of voice) if (v.serverId === serverId && (!userId || v.userId === userId)) { gone.push(v); voice.delete(s); }
    if (!gone.length) return;
    broadcastVoice();
    if (room) await Promise.all(gone.map((v) => room.removeParticipant(voiceRoomName(v.channelId), v.userId).catch(() => {})));
  };

  if (bootstrapInvite) {
    const any = await db.select({ id: users.id }).from(users).limit(1);
    if (any.length === 0) await db.insert(invites).values({ code: bootstrapInvite }).onConflictDoNothing();
  }

  /** Cria o servidor com os canais iniciais; o limite de servidores próprios é checado numa transação. */
  async function createServer(owner: User, name: string): Promise<Server | "limit"> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${owner.id}))`);
      const n = (await tx.select({ n: count() }).from(servers).where(eq(servers.ownerId, owner.id)))[0]!.n;
      if (n >= MAX_OWNED_SERVERS) return "limit";
      const id = newId();
      await tx.insert(servers).values({ id, name, ownerId: owner.id });
      await tx.insert(serverMembers).values({ serverId: id, userId: owner.id, role: "owner" });
      await tx.insert(channels).values([
        { id: newId(), serverId: id, name: "geral", kind: "text" },
        { id: newId(), serverId: id, name: "Sala", kind: "voice" },
      ]);
      return { id, name, ownerId: owner.id, role: "owner" } satisfies Server;
    });
  }

  const findChannel = async (id: string) =>
    (await db.select({ id: channels.id, serverId: channels.serverId, name: channels.name, kind: channels.kind }).from(channels).where(eq(channels.id, id)).limit(1))[0];
  const roleIn = async (serverId: string, userId: string): Promise<ServerRole | undefined> =>
    (await db.select({ role: serverMembers.role }).from(serverMembers).where(and(eq(serverMembers.serverId, serverId), eq(serverMembers.userId, userId))).limit(1))[0]?.role;
  const findServer = async (id: string) => (await db.select().from(servers).where(eq(servers.id, id)).limit(1))[0];
  const ownedCount = async (userId: string) => (await db.select({ n: count() }).from(servers).where(eq(servers.ownerId, userId)))[0]!.n;
  const memberIds = async (serverId: string) =>
    (await db.select({ id: serverMembers.userId }).from(serverMembers).where(eq(serverMembers.serverId, serverId))).map((r) => r.id);

  const pairOf = (a: string, b: string) => (a < b ? { userA: a, userB: b } : { userA: b, userB: a });
  const friendshipOf = async (a: string, b: string) => {
    const p = pairOf(a, b);
    return (await db.select().from(friendships).where(and(eq(friendships.userA, p.userA), eq(friendships.userB, p.userB))).limit(1))[0];
  };
  const dmPeers = async (channelId: string) =>
    (await db.select({ id: dmMembers.userId }).from(dmMembers).where(eq(dmMembers.channelId, channelId))).map((r) => r.id);
  const isDmMember = async (channelId: string, userId: string) =>
    (await db.select({ id: dmMembers.userId }).from(dmMembers).where(and(eq(dmMembers.channelId, channelId), eq(dmMembers.userId, userId))).limit(1)).length > 0;
  /** Bloqueio em qualquer direção entre duas contas. */
  const isBlocked = async (a: string, b: string) =>
    (await db.select({ x: blocks.blocker }).from(blocks).where(or(and(eq(blocks.blocker, a), eq(blocks.blocked, b)), and(eq(blocks.blocker, b), eq(blocks.blocked, a)))).limit(1)).length > 0;
  /** Em conversa 1:1 com bloqueio entre as duas pessoas, ninguém envia nem liga. */
  const dmBlocked = async (channelId: string) => {
    const ch = (await db.select({ g: channels.isGroup }).from(channels).where(eq(channels.id, channelId)).limit(1))[0];
    if (!ch || ch.g) return false;
    const [a, b] = await dmPeers(channelId);
    return !!a && !!b && (await isBlocked(a, b));
  };
  const sharesServer = async (a: string, b: string) => {
    const mine = db.select({ id: serverMembers.serverId }).from(serverMembers).where(eq(serverMembers.userId, a));
    return (await db.select({ id: serverMembers.serverId }).from(serverMembers).where(and(eq(serverMembers.userId, b), inArray(serverMembers.serverId, mine))).limit(1)).length > 0;
  };

  const userCols = {
    id: users.id, username: users.username, isAdmin: users.isAdmin, canInvite: users.canInvite,
    displayName: users.displayName, bio: users.bio, avatarKey: users.avatarKey, bannerKey: users.bannerKey,
  };
  const toUser = (r: { id: string; username: string; isAdmin: boolean; canInvite: boolean; displayName: string | null; bio: string | null; avatarKey: string | null; bannerKey: string | null }): User => ({
    id: r.id, username: r.username, isAdmin: r.isAdmin, canInvite: r.canInvite, displayName: r.displayName, bio: r.bio, avatar: r.avatarKey, banner: r.bannerKey,
  });
  const loadUser = async (id: string) => {
    const r = (await db.select(userCols).from(users).where(eq(users.id, id)).limit(1))[0];
    return r ? toUser(r) : undefined;
  };

  async function userFromToken(token: string | undefined): Promise<User | null> {
    if (!token) return null;
    const rows = await db
      .select(userCols)
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.tokenHash, hashToken(token)))
      .limit(1);
    return rows[0] ? toUser(rows[0]) : null;
  }
  const bearer = (req: FastifyRequest) => req.headers.authorization?.replace(/^Bearer /, "");

  async function startSession(userId: string) {
    const token = newToken();
    await db.insert(sessions).values({ tokenHash: hashToken(token), userId });
    return token;
  }

  /** Convite de servidor ainda utilizável (existe, não venceu, não esgotou os usos). */
  async function usableServerInvite(code: string) {
    const inv = (await db.select().from(serverInvites).where(eq(serverInvites.code, code)).limit(1))[0];
    if (!inv) return undefined;
    if (inv.expiresAt && inv.expiresAt.getTime() < Date.now()) return undefined;
    if (inv.maxUses !== null && inv.uses >= inv.maxUses) return undefined;
    return inv;
  }

  app.get("/health", async () => ({ ok: true }));

  app.post("/auth/register", async (req, reply) => {
    const body = registerBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "dados inválidos" });
    const { inviteCode, username, password } = body.data;
    const accountInvite = (await db.select().from(invites).where(eq(invites.code, inviteCode)).limit(1))[0];
    // Criar conta exige um convite do app (só admin gera). Convite de servidor só serve para quem já tem conta.
    if (!accountInvite && (await usableServerInvite(inviteCode)))
      return reply.code(403).send({ error: "convite inválido: esse é de servidor e só vale para quem já tem conta" });
    if (!accountInvite || accountInvite.usedBy) return reply.code(403).send({ error: "convite inválido" });
    if ((await db.select().from(users).where(eq(users.username, username)).limit(1)).length)
      return reply.code(409).send({ error: "nome já em uso" });
    const isFirst = (await db.select({ id: users.id }).from(users).limit(1)).length === 0;
    const id = newId();
    const user: User = { id, username, isAdmin: isFirst, canInvite: false, displayName: null, bio: null, avatar: null, banner: null };
    await db.insert(users).values({ id, username, passwordHash: await hashPassword(password), isAdmin: isFirst });
    // Convite de conta cria só a conta: a pessoa começa sem nenhum servidor.
    await db.update(invites).set({ usedBy: id }).where(eq(invites.code, inviteCode));
    return { token: await startSession(id), user };
  });

  app.post("/auth/login", async (req, reply) => {
    const body = loginBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "dados inválidos" });
    const row = (await db.select().from(users).where(eq(users.username, body.data.username)).limit(1))[0];
    if (!row || !(await verifyPassword(body.data.password, row.passwordHash)))
      return reply.code(401).send({ error: "usuário ou senha incorretos" });
    return { token: await startSession(row.id), user: toUser(row) };
  });

  // Prévia pública de um convite de servidor (para a tela "entrar com convite").
  app.get<{ Params: { code: string } }>("/invites/:code", async (req, reply) => {
    const inv = await usableServerInvite(req.params.code);
    if (!inv) return reply.code(404).send({ error: "convite inválido ou vencido" });
    const server = await findServer(inv.serverId);
    const n = (await db.select({ n: count() }).from(serverMembers).where(eq(serverMembers.serverId, inv.serverId)))[0]!.n;
    return { serverName: server!.name, members: n } satisfies InvitePreview;
  });

  // Fotos e banners. Públicos de propósito (um <img> não manda token); a chave é aleatória e muda a cada troca.
  app.get<{ Params: { key: string } }>("/files/:key", async (req, reply) => {
    if (!isFileKey(req.params.key)) return reply.code(404).send({ error: "não encontrado" });
    const path = join(files.dir, req.params.key);
    if (!(await stat(path).catch(() => null))) return reply.code(404).send({ error: "não encontrado" });
    return reply
      .header("content-type", "image/webp")
      .header("cache-control", "public, max-age=31536000, immutable")
      .header("x-content-type-options", "nosniff")
      .send(createReadStream(path));
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

    authed.get("/me", async (req) => (await loadUser(me(req).id)) ?? me(req));

    // ---- Perfil ----
    /** Propaga o perfil novo: conexões abertas, estado de voz e todo mundo rebusca membros/mensagens. */
    async function profileChanged(userId: string) {
      const fresh = await loadUser(userId);
      if (!fresh) return;
      for (const [s, u] of online) if (u.id === userId) online.set(s, fresh);
      for (const [s, v] of voice) if (v.userId === userId) voice.set(s, { ...v, displayName: fresh.displayName, avatar: fresh.avatar, staff: canInviteAccounts(fresh) });
      broadcastVoice();
      broadcast({ t: "sync" });
      return fresh;
    }

    authed.patch("/me", async (req, reply) => {
      const body = updateProfileBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: "nome de exibição de 1 a 32 letras e bio de até 190" });
      const set: { displayName?: string | null; bio?: string | null } = {};
      if (body.data.displayName !== undefined) set.displayName = body.data.displayName || null;
      if (body.data.bio !== undefined) set.bio = body.data.bio || null;
      if (Object.keys(set).length) await db.update(users).set(set).where(eq(users.id, me(req).id));
      return profileChanged(me(req).id);
    });

    const limits: Record<ImageKind, number> = { avatar: AVATAR_MAX_BYTES, banner: BANNER_MAX_BYTES };
    // Limite de uploads por conta: no máximo UPLOAD_LIMIT envios a cada UPLOAD_WINDOW_MS (memória do processo).
    const UPLOAD_LIMIT = 10;
    const UPLOAD_WINDOW_MS = 10 * 60 * 1000;
    const uploadsBy = new Map<string, number[]>();
    const uploadAllowed = (userId: string) => {
      const now = Date.now();
      const recent = (uploadsBy.get(userId) ?? []).filter((t) => now - t < UPLOAD_WINDOW_MS);
      if (recent.length >= UPLOAD_LIMIT) return (uploadsBy.set(userId, recent), false);
      recent.push(now);
      uploadsBy.set(userId, recent);
      return true;
    };
    for (const kind of ["avatar", "banner"] as const) {
      const col = kind === "avatar" ? "avatarKey" : "bannerKey";
      authed.put(`/me/${kind}`, async (req, reply) => {
        if (!uploadAllowed(me(req).id)) return reply.code(429).send({ error: "muitos envios seguidos; espere alguns minutos" });
        const part = await req.file().catch(() => undefined);
        if (!part) return reply.code(400).send({ error: "envie uma imagem" });
        const raw = await part.toBuffer().catch(() => undefined);
        if (!raw || part.file.truncated || raw.length > limits[kind])
          return reply.code(413).send({ error: `imagem grande demais (máximo ${limits[kind] / 1024 / 1024} MB)` });
        const out = await processImage(raw, kind);
        if (!out) return reply.code(415).send({ error: "use uma imagem PNG, JPEG, WebP ou GIF" });
        const key = await files.save(out);
        const old = (await loadUser(me(req).id))?.[kind];
        await db.update(users).set({ [col]: key }).where(eq(users.id, me(req).id));
        await files.remove(old);
        return profileChanged(me(req).id);
      });
      authed.delete(`/me/${kind}`, async (req) => {
        const old = (await loadUser(me(req).id))?.[kind];
        await db.update(users).set({ [col]: null }).where(eq(users.id, me(req).id));
        await files.remove(old);
        return profileChanged(me(req).id);
      });
    }

    /** Cartão de perfil de outra pessoa (só quem divide um servidor com ela). */
    authed.get<{ Params: { id: string } }>("/users/:id", async (req, reply) => {
      const myId = me(req).id;
      const id = req.params.id;
      const u = (await db.select({ ...userCols, createdAt: users.createdAt }).from(users).where(eq(users.id, id)).limit(1))[0];
      if (!u) return reply.code(404).send({ error: "pessoa não encontrada" });
      const mine = db.select({ id: serverMembers.serverId }).from(serverMembers).where(eq(serverMembers.userId, myId));
      const mutualServers = id === myId ? [] : await db
        .select({ id: servers.id, name: servers.name })
        .from(serverMembers)
        .innerJoin(servers, eq(servers.id, serverMembers.serverId))
        .where(and(eq(serverMembers.userId, id), inArray(serverMembers.serverId, mine)))
        .orderBy(asc(servers.createdAt));
      const friendship = id === myId ? undefined : await friendshipOf(myId, id);
      const myDms = db.select({ id: dmMembers.channelId }).from(dmMembers).where(eq(dmMembers.userId, myId));
      const sharesDm = id !== myId && !!(await db.select({ id: dmMembers.userId }).from(dmMembers).where(and(eq(dmMembers.userId, id), inArray(dmMembers.channelId, myDms))).limit(1)).length;
      // Só vê o perfil quem já tem algum laço com a pessoa: servidor, amizade (ou pedido) ou conversa.
      if (id !== myId && !mutualServers.length && !friendship && !sharesDm) return reply.code(404).send({ error: "pessoa não encontrada" });
      const friendsOf = async (who: string) =>
        (await db.select().from(friendships).where(and(eq(friendships.status, "accepted"), or(eq(friendships.userA, who), eq(friendships.userB, who)))))
          .map((r) => (r.userA === who ? r.userB : r.userA));
      const theirFriends = new Set(id === myId ? [] : await friendsOf(id));
      const common = id === myId ? [] : (await friendsOf(myId)).filter((x) => theirFriends.has(x));
      const mutualFriends = common.length
        ? (await db.select({ id: users.id, username: users.username, displayName: users.displayName, avatarKey: users.avatarKey }).from(users).where(inArray(users.id, common)))
            .map((r): Person => ({ id: r.id, username: r.username, displayName: r.displayName, avatar: r.avatarKey }))
        : [];
      const blocked = id !== myId && !!(await db.select({ x: blocks.blocker }).from(blocks).where(and(eq(blocks.blocker, myId), eq(blocks.blocked, id))).limit(1)).length;
      const { isAdmin: _a, canInvite: _c, ...pub } = toUser(u);
      return {
        ...pub,
        staff: canInviteAccounts(u),
        createdAt: u.createdAt.toISOString(),
        mutualServers,
        mutualFriends,
        friendship: !friendship ? "none" : friendship.status === "accepted" ? "friend" : friendship.requestedBy === myId ? "outgoing" : "incoming",
        blocked,
      } satisfies ProfileView;
    });

    // ---- Servidores ----
    authed.get("/servers", async (req) =>
      (
        await db
          .select({ id: servers.id, name: servers.name, ownerId: servers.ownerId, role: serverMembers.role })
          .from(serverMembers)
          .innerJoin(servers, eq(servers.id, serverMembers.serverId))
          .where(eq(serverMembers.userId, me(req).id))
          .orderBy(asc(servers.createdAt))
      ) satisfies Server[],
    );

    authed.post("/servers", async (req, reply) => {
      const body = createServerBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: "o nome precisa ter de 2 a 40 letras" });
      const created = await createServer(me(req), body.data.name);
      if (created === "limit") return reply.code(409).send({ error: `você já é dono de ${MAX_OWNED_SERVERS} servidores` });
      await refreshMemberships(me(req).id);
      toUsers([me(req).id], { t: "sync" });
      return created;
    });

    /** Resolve o servidor e o cargo de quem pede; responde 404/403 se não puder. */
    async function member(req: FastifyRequest, reply: any, serverId: string, allow: (r: ServerRole) => boolean = () => true) {
      const role = await roleIn(serverId, me(req).id);
      if (!role) return void reply.code(404).send({ error: "servidor não existe" });
      if (!allow(role)) return void reply.code(403).send({ error: "sem permissão" });
      return role;
    }

    authed.patch<{ Params: { id: string } }>("/servers/:id", async (req, reply) => {
      if (!(await member(req, reply, req.params.id, (r) => r === "owner"))) return;
      const body = renameServerBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: "o nome precisa ter de 2 a 40 letras" });
      await db.update(servers).set({ name: body.data.name }).where(eq(servers.id, req.params.id));
      toServer(req.params.id, { t: "sync" });
      return { ok: true };
    });

    authed.delete<{ Params: { id: string } }>("/servers/:id", async (req, reply) => {
      if (!(await member(req, reply, req.params.id, (r) => r === "owner"))) return;
      const server = (await findServer(req.params.id))!;
      const body = deleteServerBody.safeParse(req.body);
      if (!body.success || body.data.name !== server.name) return reply.code(400).send({ error: "digite o nome do servidor para apagar" });
      const ids = await memberIds(server.id);
      await dropFromCalls(server.id);
      await db.delete(servers).where(eq(servers.id, server.id));
      for (const id of ids) await refreshMemberships(id);
      toUsers(ids, { t: "sync" });
      return { ok: true };
    });

    authed.post<{ Params: { id: string } }>("/servers/:id/transfer", async (req, reply) => {
      if (!(await member(req, reply, req.params.id, (r) => r === "owner"))) return;
      const body = transferBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: "dados inválidos" });
      const target = body.data.userId;
      if (target === me(req).id || !(await roleIn(req.params.id, target))) return reply.code(400).send({ error: "escolha outro membro do servidor" });
      if ((await ownedCount(target)) >= MAX_OWNED_SERVERS) return reply.code(409).send({ error: `essa pessoa já é dona de ${MAX_OWNED_SERVERS} servidores` });
      await db.transaction(async (tx) => {
        await tx.update(servers).set({ ownerId: target }).where(eq(servers.id, req.params.id));
        await tx.update(serverMembers).set({ role: "owner" }).where(and(eq(serverMembers.serverId, req.params.id), eq(serverMembers.userId, target)));
        await tx.update(serverMembers).set({ role: "admin" }).where(and(eq(serverMembers.serverId, req.params.id), eq(serverMembers.userId, me(req).id)));
      });
      toServer(req.params.id, { t: "sync" });
      return { ok: true };
    });

    authed.get<{ Params: { id: string } }>("/servers/:id/channels", async (req, reply) => {
      if (!(await member(req, reply, req.params.id))) return;
      return db.select({ id: channels.id, serverId: channels.serverId, name: channels.name, kind: channels.kind }).from(channels).where(eq(channels.serverId, req.params.id)).orderBy(channels.createdAt);
    });

    authed.post<{ Params: { id: string } }>("/servers/:id/channels", async (req, reply) => {
      if (!(await member(req, reply, req.params.id, canManage))) return;
      const body = createChannelBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: "dados inválidos" });
      const channel = { id: newId(), serverId: req.params.id, name: body.data.name, kind: body.data.kind };
      try {
        await db.insert(channels).values(channel);
      } catch {
        return reply.code(409).send({ error: "canal já existe" });
      }
      toServer(req.params.id, { t: "channel", channel });
      return channel;
    });

    authed.get<{ Params: { id: string } }>("/servers/:id/members", async (req, reply) => {
      if (!(await member(req, reply, req.params.id))) return;
      const rows = await db
        .select({ userId: users.id, username: users.username, displayName: users.displayName, avatar: users.avatarKey, isAdmin: users.isAdmin, canInvite: users.canInvite, role: serverMembers.role })
        .from(serverMembers)
        .innerJoin(users, eq(users.id, serverMembers.userId))
        .where(eq(serverMembers.serverId, req.params.id));
      return rows.map(({ isAdmin, canInvite, ...r }): Member => ({ ...r, staff: canInviteAccounts({ isAdmin, canInvite }) }));
    });

    authed.patch<{ Params: { id: string; user: string } }>("/servers/:id/members/:user", async (req, reply) => {
      if (!(await member(req, reply, req.params.id, (r) => r === "owner"))) return;
      const body = roleBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: "dados inválidos" });
      const target = await roleIn(req.params.id, req.params.user);
      if (!target || target === "owner") return reply.code(400).send({ error: "não dá para mudar o cargo dessa pessoa" });
      await db.update(serverMembers).set({ role: body.data.role }).where(and(eq(serverMembers.serverId, req.params.id), eq(serverMembers.userId, req.params.user)));
      toServer(req.params.id, { t: "sync" });
      return { ok: true };
    });

    // Expulsar (dono e admin) ou sair (a própria pessoa, menos o dono).
    authed.delete<{ Params: { id: string; user: string } }>("/servers/:id/members/:user", async (req, reply) => {
      const role = await member(req, reply, req.params.id);
      if (!role) return;
      const target = await roleIn(req.params.id, req.params.user);
      if (!target) return reply.code(404).send({ error: "essa pessoa não está no servidor" });
      const self = req.params.user === me(req).id;
      if (target === "owner") return reply.code(403).send({ error: "o dono precisa passar a posse antes de sair" });
      if (!self && !(role === "owner" || (role === "admin" && target === "member"))) return reply.code(403).send({ error: "sem permissão" });
      await db.delete(serverMembers).where(and(eq(serverMembers.serverId, req.params.id), eq(serverMembers.userId, req.params.user)));
      await dropFromCalls(req.params.id, req.params.user);
      await refreshMemberships(req.params.user);
      toUsers([req.params.user], { t: "sync" });
      toServer(req.params.id, { t: "sync" });
      return { ok: true };
    });

    authed.post<{ Params: { id: string } }>("/servers/:id/invites", async (req, reply) => {
      if (!(await member(req, reply, req.params.id))) return;
      const body = createInviteBody.safeParse(req.body ?? {});
      if (!body.success) return reply.code(400).send({ error: "dados inválidos" });
      const code = newInviteCode();
      const expiresAt = body.data.days ? new Date(Date.now() + body.data.days * 86_400_000) : null;
      await db.insert(serverInvites).values({ code, serverId: req.params.id, createdBy: me(req).id, expiresAt, maxUses: body.data.maxUses ?? null });
      return { code, expiresAt: expiresAt?.toISOString() ?? null };
    });

    authed.post<{ Params: { code: string } }>("/invites/:code/join", async (req, reply) => {
      const inv = await usableServerInvite(req.params.code);
      if (!inv) return reply.code(404).send({ error: "convite inválido ou vencido" });
      const server = (await findServer(inv.serverId))!;
      if (!(await roleIn(inv.serverId, me(req).id))) {
        await db.insert(serverMembers).values({ serverId: inv.serverId, userId: me(req).id, role: "member" });
        await db.update(serverInvites).set({ uses: sql`${serverInvites.uses} + 1` }).where(eq(serverInvites.code, inv.code));
        await refreshMemberships(me(req).id);
        toServer(inv.serverId, { t: "sync" });
      }
      const role = (await roleIn(inv.serverId, me(req).id))!;
      return { id: server.id, name: server.name, ownerId: server.ownerId, role } satisfies Server;
    });

    // ---- Amigos ----
    const personOf = (r: { id: string; username: string; displayName: string | null; avatarKey: string | null }): Person => ({
      id: r.id, username: r.username, displayName: r.displayName, avatar: r.avatarKey,
    });
    authed.get("/friends", async (req) => {
      const id = me(req).id;
      const rows = await db.select().from(friendships).where(or(eq(friendships.userA, id), eq(friendships.userB, id)));
      const others = rows.map((r) => (r.userA === id ? r.userB : r.userA));
      const people = others.length
        ? await db.select({ id: users.id, username: users.username, displayName: users.displayName, avatarKey: users.avatarKey }).from(users).where(inArray(users.id, others))
        : [];
      return rows.flatMap((r): Friend[] => {
        const person = people.find((p) => p.id === (r.userA === id ? r.userB : r.userA));
        if (!person) return [];
        const status = r.status === "accepted" ? "friend" : r.requestedBy === id ? "outgoing" : "incoming";
        return [{ user: personOf(person), status }];
      });
    });
    /** Pede amizade; se a outra pessoa já tinha pedido, aceita. */
    authed.post<{ Params: { userId: string } }>("/friends/:userId", async (req, reply) => {
      const id = me(req).id;
      const other = req.params.userId;
      if (other === id) return reply.code(400).send({ error: "você não pode se adicionar" });
      if (!(await loadUser(other))) return reply.code(404).send({ error: "pessoa não encontrada" });
      if (await isBlocked(id, other)) return reply.code(403).send({ error: "não é possível adicionar essa pessoa" });
      const current = await friendshipOf(id, other);
      if (!current) {
        await db.insert(friendships).values({ ...pairOf(id, other), status: "pending", requestedBy: id }).onConflictDoNothing();
      } else if (current.status === "pending" && current.requestedBy !== id) {
        await db.update(friendships).set({ status: "accepted" }).where(and(eq(friendships.userA, current.userA), eq(friendships.userB, current.userB)));
      }
      toUsers([id, other], { t: "friends" });
      const now = await friendshipOf(id, other);
      return { status: now?.status === "accepted" ? "friend" : "outgoing" };
    });
    /** Pede amizade pelo nome de usuário (aba "Adicionar"). */
    authed.post("/friends", async (req, reply) => {
      const name = typeof (req.body as any)?.username === "string" ? (req.body as any).username.trim() : "";
      const row = name ? (await db.select({ id: users.id }).from(users).where(sql`lower(${users.username}) = lower(${name})`).limit(1))[0] : undefined;
      if (!row) return reply.code(404).send({ error: "ninguém com esse nome de usuário" });
      const res = await app.inject({ method: "POST", url: `/friends/${row.id}`, headers: { authorization: req.headers.authorization ?? "" } });
      return reply.code(res.statusCode).send(res.json());
    });
    /** Recusa, cancela o pedido ou desfaz a amizade. */
    authed.delete<{ Params: { userId: string } }>("/friends/:userId", async (req) => {
      const p = pairOf(me(req).id, req.params.userId);
      await db.delete(friendships).where(and(eq(friendships.userA, p.userA), eq(friendships.userB, p.userB)));
      toUsers([me(req).id, req.params.userId], { t: "friends" });
      return { ok: true };
    });

    // ---- Bloqueios ----
    authed.get("/blocks", async (req) => {
      const rows = await db
        .select({ id: users.id, username: users.username, displayName: users.displayName, avatarKey: users.avatarKey })
        .from(blocks)
        .innerJoin(users, eq(users.id, blocks.blocked))
        .where(eq(blocks.blocker, me(req).id));
      return rows.map(personOf);
    });
    /** Bloqueia: desfaz a amizade e impede pedidos, DMs 1:1 e chamadas entre as duas contas. */
    authed.post<{ Params: { userId: string } }>("/blocks/:userId", async (req, reply) => {
      const id = me(req).id;
      const other = req.params.userId;
      if (other === id) return reply.code(400).send({ error: "você não pode se bloquear" });
      if (!(await loadUser(other))) return reply.code(404).send({ error: "pessoa não encontrada" });
      await db.insert(blocks).values({ blocker: id, blocked: other }).onConflictDoNothing();
      const p = pairOf(id, other);
      await db.delete(friendships).where(and(eq(friendships.userA, p.userA), eq(friendships.userB, p.userB)));
      // Derruba a chamada 1:1 que estiver rolando entre os dois.
      for (const [sock, v] of voice) {
        if ((v.userId === id || v.userId === other) && !v.serverId && (await dmBlocked(v.channelId))) {
          voice.delete(sock);
          if (room) await room.removeParticipant(voiceRoomName(v.channelId), v.userId).catch(() => {});
        }
      }
      broadcastVoice();
      toUsers([id, other], { t: "friends" });
      return { ok: true };
    });
    authed.delete<{ Params: { userId: string } }>("/blocks/:userId", async (req) => {
      await db.delete(blocks).where(and(eq(blocks.blocker, me(req).id), eq(blocks.blocked, req.params.userId)));
      toUsers([me(req).id, req.params.userId], { t: "friends" });
      return { ok: true };
    });

    // ---- Mensagens diretas (1:1 e em grupo) ----
    const loadDm = async (channelId: string, meId: string): Promise<Dm | undefined> => {
      const ch = (await db.select({ id: channels.id, name: channels.name, g: channels.isGroup }).from(channels).where(and(eq(channels.id, channelId), eq(channels.kind, "dm"))).limit(1))[0];
      if (!ch) return undefined;
      const people = await db
        .select({ id: users.id, username: users.username, displayName: users.displayName, avatarKey: users.avatarKey })
        .from(dmMembers)
        .innerJoin(users, eq(users.id, dmMembers.userId))
        .where(eq(dmMembers.channelId, channelId));
      const last = (await db.select({ at: sql<Date | string>`max(${messages.createdAt})` }).from(messages).where(eq(messages.channelId, channelId)))[0]?.at;
      return {
        channelId, users: people.filter((p) => p.id !== meId).map(personOf), group: ch.g, name: ch.g && ch.name ? ch.name : null,
        lastMessageAt: last ? new Date(last).toISOString() : null,
      };
    };
    authed.get("/dms", async (req) => {
      const id = me(req).id;
      const mine = await db.select({ channelId: dmMembers.channelId }).from(dmMembers).where(eq(dmMembers.userId, id));
      const list = (await Promise.all(mine.map((m) => loadDm(m.channelId, id)))).filter((d): d is Dm => !!d);
      return list.sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""));
    });
    /** Abre (ou devolve) a conversa 1:1: precisa ser amigo ou dividir um servidor, e sem bloqueio. */
    authed.post<{ Params: { userId: string } }>("/dms/:userId", async (req, reply) => {
      const id = me(req).id;
      const other = req.params.userId;
      const person = other === id ? undefined : await loadUser(other);
      if (!person) return reply.code(404).send({ error: "pessoa não encontrada" });
      if (await isBlocked(id, other)) return reply.code(403).send({ error: "não é possível conversar com essa pessoa" });
      const f = await friendshipOf(id, other);
      if (f?.status !== "accepted" && !(await sharesServer(id, other)))
        return reply.code(403).send({ error: "só amigos ou quem está no mesmo servidor" });
      const channelId = await db.transaction(async (tx) => {
        const p = pairOf(id, other);
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${p.userA + p.userB}))`);
        const mineCh = tx.select({ id: dmMembers.channelId }).from(dmMembers).where(eq(dmMembers.userId, id));
        const found = (
          await tx
            .select({ id: dmMembers.channelId })
            .from(dmMembers)
            .innerJoin(channels, eq(channels.id, dmMembers.channelId))
            .where(and(eq(dmMembers.userId, other), inArray(dmMembers.channelId, mineCh), eq(channels.isGroup, false)))
            .limit(1)
        )[0];
        if (found) return found.id;
        const cid = newId();
        await tx.insert(channels).values({ id: cid, serverId: null, name: "", kind: "dm" });
        await tx.insert(dmMembers).values([{ channelId: cid, userId: id }, { channelId: cid, userId: other }]);
        return cid;
      });
      await refreshDmSets([id, other]);
      toUsers([id, other], { t: "friends" });
      return (await loadDm(channelId, id))!;
    });
    /** Cria um grupo: só com amigos seus (sem bloqueio), de 3 a GROUP_MAX_MEMBERS pessoas. */
    authed.post("/dms", async (req, reply) => {
      const body = createGroupBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: "escolha de 2 a 9 amigos" });
      const id = me(req).id;
      const others = [...new Set(body.data.userIds)].filter((u) => u !== id);
      if (others.length < 2) return reply.code(400).send({ error: "escolha pelo menos 2 amigos" });
      for (const o of others) {
        if ((await friendshipOf(id, o))?.status !== "accepted" || (await isBlocked(id, o)))
          return reply.code(403).send({ error: "grupos só com amigos" });
      }
      const cid = newId();
      await db.transaction(async (tx) => {
        await tx.insert(channels).values({ id: cid, serverId: null, name: body.data.name ?? "", kind: "dm", isGroup: true });
        await tx.insert(dmMembers).values([id, ...others].map((userId) => ({ channelId: cid, userId })));
      });
      await refreshDmSets([id, ...others]);
      toUsers([id, ...others], { t: "friends" });
      return (await loadDm(cid, id))!;
    });
    authed.post<{ Params: { channelId: string } }>("/dms/:channelId/members", async (req, reply) => {
      const body = addGroupMemberBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: "dados inválidos" });
      const id = me(req).id;
      const cid = req.params.channelId;
      const ch = (await db.select({ g: channels.isGroup }).from(channels).where(and(eq(channels.id, cid), eq(channels.kind, "dm"))).limit(1))[0];
      if (!ch?.g || !(await isDmMember(cid, id))) return reply.code(404).send({ error: "grupo não existe" });
      const target = body.data.userId;
      if ((await friendshipOf(id, target))?.status !== "accepted" || (await isBlocked(id, target))) return reply.code(403).send({ error: "só amigos seus" });
      const members = await dmPeers(cid);
      if (members.includes(target)) return reply.code(409).send({ error: "já está no grupo" });
      if (members.length >= GROUP_MAX_MEMBERS) return reply.code(409).send({ error: `grupo cheio (${GROUP_MAX_MEMBERS} pessoas)` });
      await db.insert(dmMembers).values({ channelId: cid, userId: target });
      await refreshDmSets([target]);
      toUsers([...members, target], { t: "friends" });
      return (await loadDm(cid, id))!;
    });
    /** Sair do grupo (o último a sair apaga a conversa). */
    authed.delete<{ Params: { channelId: string } }>("/dms/:channelId/members/me", async (req, reply) => {
      const id = me(req).id;
      const cid = req.params.channelId;
      const ch = (await db.select({ g: channels.isGroup }).from(channels).where(and(eq(channels.id, cid), eq(channels.kind, "dm"))).limit(1))[0];
      if (!ch?.g || !(await isDmMember(cid, id))) return reply.code(404).send({ error: "grupo não existe" });
      const members = await dmPeers(cid);
      await db.delete(dmMembers).where(and(eq(dmMembers.channelId, cid), eq(dmMembers.userId, id)));
      if (members.length <= 1) await db.delete(channels).where(eq(channels.id, cid));
      for (const [sock, v] of voice) if (v.userId === id && v.channelId === cid) {
        voice.delete(sock);
        if (room) await room.removeParticipant(voiceRoomName(cid), id).catch(() => {});
      }
      broadcastVoice();
      await refreshDmSets([id]);
      toUsers(members, { t: "friends" });
      return { ok: true };
    });

    // ---- Voz ----
    authed.post<{ Params: { id: string } }>("/voice/:id/token", async (req, reply) => {
      if (!livekit) return reply.code(503).send({ error: "voz não configurada no servidor" });
      const channel = await findChannel(req.params.id);
      const okChannel = !channel
        ? false
        : channel.kind === "dm"
          ? (await isDmMember(channel.id, me(req).id)) && !(await dmBlocked(channel.id))
          : channel.kind === "voice" && !!channel.serverId && !!(await roleIn(channel.serverId, me(req).id));
      if (!channel || !okChannel) return reply.code(404).send({ error: "canal de voz não existe" });
      const user = me(req);
      const at = new AccessToken(livekit.apiKey, livekit.apiSecret, { identity: user.id, name: user.username, ttl: "6h" });
      at.addGrant({
        room: voiceRoomName(channel.id),
        roomJoin: true,
        canSubscribe: true,
        canPublish: true,
        canPublishData: true,
        canPublishSources: [TrackSource.MICROPHONE, TrackSource.CAMERA, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO],
      });
      return { url: livekit.url, token: await at.toJwt() } satisfies VoiceToken;
    });

    // Convites de conta (admin do app ou cargo Convidador): criam uma conta que entra no servidor mais antigo.
    authed.post("/invites", async (req, reply) => {
      if (!canInviteAccounts(me(req))) return reply.code(403).send({ error: "só admin ou convidador" });
      const code = newInviteCode();
      await db.insert(invites).values({ code, createdBy: me(req).id });
      return { code };
    });

    // ---- Administração do app (só admin) ----
    authed.get("/admin/users", async (req, reply) => {
      if (!me(req).isAdmin) return reply.code(403).send({ error: "só admin" });
      const rows = await db.select(userCols).from(users).orderBy(asc(users.createdAt));
      return rows.map((r): Account => ({ id: r.id, username: r.username, displayName: r.displayName, avatar: r.avatarKey, isAdmin: r.isAdmin, canInvite: r.canInvite }));
    });
    /** Dá ou tira o cargo Convidador. */
    authed.patch<{ Params: { id: string } }>("/admin/users/:id", async (req, reply) => {
      if (!me(req).isAdmin) return reply.code(403).send({ error: "só admin" });
      const body = setInviterBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: "dados inválidos" });
      const done = await db.update(users).set({ canInvite: body.data.canInvite }).where(eq(users.id, req.params.id)).returning({ id: users.id });
      if (!done.length) return reply.code(404).send({ error: "pessoa não encontrada" });
      await profileChanged(req.params.id); // a tag TURTLE aparece/some para todo mundo
      return { ok: true };
    });

    authed.get<{ Params: { id: string }; Querystring: { before?: string; limit?: string } }>(
      "/channels/:id/messages",
      async (req, reply) => {
        const channel = await findChannel(req.params.id);
        const allowed = channel && (channel.kind === "dm" ? await isDmMember(channel.id, me(req).id) : !!channel.serverId && !!(await roleIn(channel.serverId, me(req).id)));
        if (!channel || !allowed) return reply.code(404).send({ error: "canal não existe" });
        const limit = Math.min(Number(req.query.limit ?? 50) || 50, 100);
        const before = req.query.before ? new Date(req.query.before) : undefined;
        const rows = await db
          .select({ id: messages.id, channelId: messages.channelId, userId: messages.userId, username: users.username, displayName: users.displayName, avatar: users.avatarKey, isAdmin: users.isAdmin, canInvite: users.canInvite, content: messages.content, createdAt: messages.createdAt })
          .from(messages)
          .innerJoin(users, eq(users.id, messages.userId))
          .where(and(eq(messages.channelId, req.params.id), before ? lt(messages.createdAt, before) : undefined))
          .orderBy(desc(messages.createdAt))
          .limit(limit);
        return rows.reverse().map(({ isAdmin, canInvite, ...r }): Message => ({ ...r, staff: canInviteAccounts({ isAdmin, canInvite }), createdAt: r.createdAt.toISOString() }));
      },
    );
  });

  app.register(async (instance) => {
    instance.get<{ Querystring: { token?: string } }>("/ws", { websocket: true }, async (socket: Socket, req) => {
      const connected = await userFromToken(req.query.token);
      if (!connected) return socket.close(4401, "unauthorized");
      online.set(socket, connected);
      memberships.set(socket, await loadMemberships(connected.id));
      dmSets.set(socket, await loadDmSet(connected.id));
      presence();
      socket.send(JSON.stringify(voiceStatesFor(socket)));
      socket.on("close", () => {
        online.delete(socket);
        memberships.delete(socket);
        dmSets.delete(socket);
        presence();
        if (voice.delete(socket)) broadcastVoice();
      });
      socket.on("message", async (raw: Buffer) => {
        let evt;
        try {
          evt = clientEvent.parse(JSON.parse(raw.toString()));
        } catch {
          return socket.send(JSON.stringify({ t: "error", error: "evento inválido" } satisfies ServerEvent));
        }
        // O perfil pode ter mudado desde que a conexão abriu.
        const user = online.get(socket) ?? connected;
        if (evt.t === "ping") return socket.send(JSON.stringify({ t: "pong" } satisfies ServerEvent));
        if (evt.t === "voice") {
          if (evt.channelId === null) {
            if (voice.delete(socket)) broadcastVoice();
            return;
          }
          const channel = await findChannel(evt.channelId);
          const okVoice = !channel
            ? false
            : channel.kind === "dm"
              ? (await isDmMember(channel.id, user.id)) && !(await dmBlocked(channel.id))
              : channel.kind === "voice" && !!channel.serverId && !!memberships.get(socket)?.has(channel.serverId);
          if (!channel || !okVoice)
            return socket.send(JSON.stringify({ t: "error", error: "canal de voz não existe" } satisfies ServerEvent));
          // A mesma conta só fica numa chamada por vez (o LiveKit derruba a sessão antiga).
          for (const [s, v] of voice) if (s !== socket && v.userId === user.id) voice.delete(s);
          voice.set(socket, {
            userId: user.id, username: user.username, displayName: user.displayName, avatar: user.avatar, staff: canInviteAccounts(user), channelId: channel.id, serverId: channel.serverId ?? "",
            muted: evt.muted, deafened: evt.deafened, camera: evt.camera, screen: evt.screen,
          });
          broadcastVoice();
          return;
        }
        const channel = await findChannel(evt.channelId);
        const isDm = channel?.kind === "dm";
        const allowed = !channel
          ? false
          : isDm
            ? await isDmMember(channel.id, user.id)
            : channel.kind === "text" && !!channel.serverId && !!memberships.get(socket)?.has(channel.serverId);
        if (!channel || !allowed)
          return socket.send(JSON.stringify({ t: "error", error: "canal não existe" } satisfies ServerEvent));
        if (isDm && (await dmBlocked(channel.id)))
          return socket.send(JSON.stringify({ t: "error", error: "não é possível enviar mensagem para essa pessoa" } satisfies ServerEvent));
        const message: Message = {
          id: newId(), channelId: evt.channelId, userId: user.id, username: user.username, displayName: user.displayName, avatar: user.avatar, staff: canInviteAccounts(user),
          content: evt.content, createdAt: new Date().toISOString(),
        };
        await db.insert(messages).values({ id: message.id, channelId: message.channelId, userId: user.id, content: message.content, createdAt: new Date(message.createdAt) });
        if (isDm) toUsers(await dmPeers(channel.id), { t: "message", message });
        else toServer(channel.serverId!, { t: "message", message });
      });
    });
  });

  return app;
}
