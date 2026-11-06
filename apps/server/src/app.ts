import Fastify, { type FastifyRequest, type FastifyServerOptions } from "fastify";
import { AccessToken, RoomServiceClient, TrackSource, WebhookReceiver } from "livekit-server-sdk";
import fastifyStatic from "@fastify/static";
import multipart from "@fastify/multipart";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import websocket from "@fastify/websocket";
import {
  and, asc, attachments, blocks, channels, count, desc, dmMembers, eq, friendships, inArray, invites, isNull, lt, messages, or, readStates, serverInvites, serverMembers, servers, sessions, sql, users, type Db,
} from "@turtle/db";
import {
  ATTACHMENT_MAX_BYTES,
  type Attachment,
  REPLY_PREVIEW_CHARS,
  type ReplyPreview,
  editMessageBody,
  renameChannelBody,
  SERVER_ICON_MAX_BYTES,
  type Unread,
  mentionToken,
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
import { fileStore, isFileKey, processAttachment, processImage, type ImageKind } from "./profile.js";
import { hashPassword, hashToken, newId, newInviteCode, newToken, verifyPassword } from "./auth.js";
import { attemptLimiter } from "./limiter.js";

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
  /**
   * De quem aceitar o X-Forwarded-For (o IP real de quem acessa, usado no limite de tentativas de login).
   * Padrão: redes privadas e localhost, onde fica o Caddy em produção.
   */
  trustProxy?: string[] | boolean;
  /** Tentativas de login/cadastro por IP a cada 10 min e erros de senha por nome a cada 15 min. Padrão: 20 e 8. */
  authLimit?: { perIp: number; perName: number };
  /** Intervalo do ping do WebSocket; conexão que não responde até o próximo é derrubada. Padrão: 30 s. */
  heartbeatMs?: number;
  /** Quanto esperar, depois de alguém entrar numa sala do LiveKit, para conferir se avisou o gateway. Padrão: 30 s. */
  voiceGraceMs?: number;
  /** Só para testes: substitui o cliente da API de salas do LiveKit. */
  roomService?: Pick<RoomServiceClient, "removeParticipant" | "getParticipant">;
  /** Logs (pino). Padrão: desligado; em produção o index.ts liga com `serverLogger()`. */
  logger?: FastifyServerOptions["logger"];
}

/** Esconde o token da sessão que o WebSocket leva na URL (`/ws?token=...`). */
export const hideToken = (url: string) => url.replace(/([?&]token=)[^&]*/g, "$1***");

/** Configuração dos logs de produção: JSON numa linha, sem o cabeçalho Authorization nem o token do WebSocket. */
export function serverLogger(level = "info", stream?: { write(line: string): void }) {
  return {
    level,
    ...(stream ? { stream } : {}),
    redact: ["req.headers.authorization", "req.headers.cookie"],
    serializers: {
      req: (req: { method: string; url: string; ip?: string; headers?: Record<string, unknown> }) => ({
        method: req.method,
        url: hideToken(req.url),
        ip: req.ip,
        ua: req.headers?.["user-agent"],
      }),
    },
  };
}

/** Hash de uma senha aleatória, para o login de um nome que não existe levar o mesmo tempo. */
const DUMMY_HASH = await hashPassword(newToken());

/** Endereços do proxy (Caddy na rede do Docker). */
const PRIVATE_NETS = ["127.0.0.1", "::1", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"];

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
  on(event: "message" | "close" | "pong", cb: (...args: any[]) => void): void;
  ping?(): void;
  terminate?(): void;
}

/** Cargos que podem gerir canais e expulsar membros. */
const canManage = (role: ServerRole | undefined) => role === "owner" || role === "admin";

export async function buildApp({
  db, bootstrapInvite, livekit, clientDir, uploadDir = "data/uploads", logger = false,
  trustProxy = PRIVATE_NETS, authLimit = { perIp: 20, perName: 8 },
  heartbeatMs = 30_000, voiceGraceMs = 30_000, roomService,
}: AppOptions) {
  const app = Fastify({ logger, trustProxy });
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
    ? (roomService ?? new RoomServiceClient(livekit.url.replace(/^ws/, "http"), livekit.apiKey, livekit.apiSecret))
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
  const presence = () => {
    const people = [...online.values()];
    broadcast({ t: "presence", online: [...new Set(people.map((u) => u.id))], busy: [...new Set(people.filter((u) => u.status === "busy").map((u) => u.id))] });
  };

  /** Nonces de envio recentes (10 min) por conta: o reenvio depois de uma queda não duplica a mensagem. */
  const sentNonces = new Map<string, { id: string; at: number }>();
  const rememberNonce = (key: string, id: string) => {
    const now = Date.now();
    if (sentNonces.size > 5000) for (const [k, v] of sentNonces) if (now - v.at > 10 * 60_000) sentNonces.delete(k);
    sentNonces.set(key, { id, at: now });
  };

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
      return { id, name, ownerId: owner.id, role: "owner", icon: null } satisfies Server;
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

  /** Quem pode ler e escrever num canal de texto (de servidor ou conversa direta). */
  const canUseText = async (channel: { id: string; serverId: string | null; kind: string } | undefined, userId: string) =>
    !!channel && (channel.kind === "dm" ? await isDmMember(channel.id, userId) : channel.kind === "text" && !!channel.serverId && !!(await roleIn(channel.serverId, userId)));
  /** Manda um evento para quem vê o canal. */
  const toChannel = async (channel: { id: string; serverId: string | null; kind: string }, evt: ServerEvent) => {
    if (channel.kind === "dm") toUsers(await dmPeers(channel.id), evt);
    else if (channel.serverId) toServer(channel.serverId, evt);
  };
  const attachmentCols = { id: attachments.id, messageId: attachments.messageId, key: attachments.fileKey, name: attachments.name, size: attachments.size, mime: attachments.mime, width: attachments.width, height: attachments.height };
  const toAttachment = ({ messageId: _m, ...a }: { id: string; messageId: string | null; key: string; name: string; size: number; mime: string; width: number | null; height: number | null }): Attachment => a;
  const messageCols = {
    id: messages.id, channelId: messages.channelId, userId: messages.userId, username: users.username, displayName: users.displayName, avatar: users.avatarKey,
    isAdmin: users.isAdmin, canInvite: users.canInvite, content: messages.content, createdAt: messages.createdAt, editedAt: messages.editedAt, replyTo: messages.replyTo,
  };
  /** Prévias das mensagens respondidas (as que não existem mais ficam de fora). */
  async function replyPreviews(ids: string[]): Promise<Map<string, ReplyPreview>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const rows = await db
      .select({ id: messages.id, userId: messages.userId, username: users.username, displayName: users.displayName, avatar: users.avatarKey, content: messages.content })
      .from(messages)
      .innerJoin(users, eq(users.id, messages.userId))
      .where(inArray(messages.id, unique));
    const files = rows.length
      ? await db.select({ messageId: attachments.messageId, n: count() }).from(attachments).where(inArray(attachments.messageId, rows.map((r) => r.id))).groupBy(attachments.messageId)
      : [];
    return new Map(rows.map((r) => [r.id, { ...r, content: r.content.slice(0, REPLY_PREVIEW_CHARS), attachments: Number(files.find((f) => f.messageId === r.id)?.n ?? 0) }]));
  }
  /** Linhas do banco (com o autor) viram mensagens com os anexos e a prévia da resposta. */
  async function toMessages(rows: { id: string; channelId: string; userId: string; username: string; displayName: string | null; avatar: string | null; isAdmin: boolean; canInvite: boolean; content: string; createdAt: Date; editedAt: Date | null; replyTo: string | null }[]): Promise<Message[]> {
    const files = rows.length ? await db.select(attachmentCols).from(attachments).where(inArray(attachments.messageId, rows.map((r) => r.id))).orderBy(asc(attachments.createdAt)) : [];
    const replies = await replyPreviews(rows.flatMap((r) => (r.replyTo ? [r.replyTo] : [])));
    return rows.map(({ isAdmin, canInvite, replyTo, ...r }) => ({
      ...r,
      staff: canInviteAccounts({ isAdmin, canInvite }),
      createdAt: r.createdAt.toISOString(),
      editedAt: r.editedAt?.toISOString() ?? null,
      attachments: files.filter((f) => f.messageId === r.id).map(toAttachment),
      replyToId: replyTo,
      replyTo: (replyTo && replies.get(replyTo)) || null,
    }));
  }
  const loadMessage = async (id: string) => {
    const row = (await db.select(messageCols).from(messages).innerJoin(users, eq(users.id, messages.userId)).where(eq(messages.id, id)).limit(1))[0];
    return row ? (await toMessages([row]))[0] : undefined;
  };
  /** Apaga do disco os anexos dos canais (antes de apagar os canais, que leva as linhas junto). */
  const fileKeysOf = async (channelIds: string[]) =>
    channelIds.length ? (await db.select({ key: attachments.fileKey }).from(attachments).where(inArray(attachments.channelId, channelIds))).map((r) => r.key) : [];
  const removeFiles = async (keys: (string | null | undefined)[]) => {
    for (const k of keys) await files.remove(k).catch(() => {});
  };
  /** Marca a conversa como lida agora. */
  const markRead = (userId: string, channelId: string) =>
    db.insert(readStates).values({ userId, channelId, lastReadAt: new Date() }).onConflictDoUpdate({ target: [readStates.userId, readStates.channelId], set: { lastReadAt: new Date() } });

  // Anexo enviado e nunca usado numa mensagem some depois de uma hora.
  const sweepOrphans = async () => {
    const old = await db.select({ id: attachments.id, key: attachments.fileKey }).from(attachments).where(and(isNull(attachments.messageId), lt(attachments.createdAt, new Date(Date.now() - 3_600_000))));
    if (!old.length) return;
    await db.delete(attachments).where(inArray(attachments.id, old.map((o) => o.id)));
    await removeFiles(old.map((o) => o.key));
  };
  const sweeper = setInterval(() => void sweepOrphans().catch(() => {}), 15 * 60_000);
  sweeper.unref();
  app.addHook("onClose", async () => clearInterval(sweeper));

  const userCols = {
    id: users.id, username: users.username, isAdmin: users.isAdmin, canInvite: users.canInvite,
    displayName: users.displayName, bio: users.bio, avatarKey: users.avatarKey, bannerKey: users.bannerKey, status: users.status,
  };
  const toUser = (r: { id: string; username: string; isAdmin: boolean; canInvite: boolean; displayName: string | null; bio: string | null; avatarKey: string | null; bannerKey: string | null; status: "online" | "busy" }): User => ({
    id: r.id, username: r.username, isAdmin: r.isAdmin, canInvite: r.canInvite, displayName: r.displayName, bio: r.bio, avatar: r.avatarKey, banner: r.bannerKey, status: r.status,
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

  // Saúde de verdade: responde 503 se o banco não responde (o healthcheck do Docker e o monitor externo usam isto).
  // logLevel warn: o healthcheck do Docker (a cada 30 s) não enche o log.
  app.get("/health", { logLevel: "warn" }, async (req, reply) => {
    try {
      await db.execute(sql`select 1`);
      return { ok: true };
    } catch (err) {
      req.log.error({ err }, "health: banco não responde");
      return reply.code(503).send({ ok: false, error: "banco não responde" });
    }
  });

  // Limite de tentativas: por IP (login e cadastro juntos) e por nome de usuário (só erros de senha).
  // Login certo zera o contador do nome. Sem isso, qualquer um na internet testaria senhas sem parar.
  const byIp = attemptLimiter({ max: authLimit.perIp, windowMs: 10 * 60_000 });
  const byName = attemptLimiter({ max: authLimit.perName, windowMs: 15 * 60_000 });
  const tooMany = (reply: any, seconds: number) =>
    reply
      .code(429)
      .header("retry-after", String(seconds))
      .send({ error: `muitas tentativas; tente de novo em ${seconds < 90 ? `${seconds} segundos` : `${Math.ceil(seconds / 60)} minutos`}` });
  const nameKey = (name: string) => name.trim().toLocaleLowerCase("pt-BR");

  app.post("/auth/register", async (req, reply) => {
    const wait = byIp.blockedFor(req.ip);
    if (wait) return tooMany(reply, wait);
    byIp.hit(req.ip);
    const body = registerBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "dados inválidos" });
    const { inviteCode, username, password } = body.data;
    const accountInvite = (await db.select().from(invites).where(eq(invites.code, inviteCode)).limit(1))[0];
    // Criar conta exige um convite do app (só admin gera). Convite de servidor só serve para quem já tem conta.
    if (!accountInvite && (await usableServerInvite(inviteCode)))
      return reply.code(403).send({ error: "convite inválido: esse é de servidor e só vale para quem já tem conta" });
    if (!accountInvite || accountInvite.usedBy) return reply.code(403).send({ error: "convite inválido" });
    if ((await db.select({ id: users.id }).from(users).where(sql`lower(${users.username}) = lower(${username})`).limit(1)).length)
      return reply.code(409).send({ error: "nome já em uso" });
    const isFirst = (await db.select({ id: users.id }).from(users).limit(1)).length === 0;
    const id = newId();
    const user: User = { id, username, isAdmin: isFirst, canInvite: false, displayName: null, bio: null, avatar: null, banner: null, status: "online" };
    try {
      await db.insert(users).values({ id, username, passwordHash: await hashPassword(password), isAdmin: isFirst });
    } catch {
      // dois cadastros com o mesmo nome ao mesmo tempo: o índice único segura o segundo
      return reply.code(409).send({ error: "nome já em uso" });
    }
    // Convite de conta cria só a conta: a pessoa começa sem nenhum servidor.
    await db.update(invites).set({ usedBy: id }).where(eq(invites.code, inviteCode));
    return { token: await startSession(id), user };
  });

  app.post("/auth/login", async (req, reply) => {
    const body = loginBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "dados inválidos" });
    const name = nameKey(body.data.username);
    const wait = Math.max(byIp.blockedFor(req.ip), byName.blockedFor(name));
    if (wait) return tooMany(reply, wait);
    byIp.hit(req.ip);
    // Sem diferenciar maiúsculas; se o banco antigo tiver dois nomes iguais nessa forma, vale a grafia exata.
    const found = await db.select().from(users).where(sql`lower(${users.username}) = lower(${body.data.username})`).limit(5);
    const row = found.find((u) => u.username === body.data.username) ?? (found.length === 1 ? found[0] : undefined);
    // Sem a conta, compara com um hash qualquer: o tempo de resposta não revela quais nomes existem.
    const ok = await verifyPassword(body.data.password, row?.passwordHash ?? DUMMY_HASH);
    if (!row || !ok) {
      byName.hit(name);
      return reply.code(401).send({ error: "usuário ou senha incorretos" });
    }
    byName.reset(name);
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
  // Anexos do chat seguem a mesma ideia (chave aleatória); só imagens comuns abrem no navegador, o resto é baixado.
  app.get<{ Params: { key: string } }>("/files/:key", async (req, reply) => {
    const key = req.params.key;
    if (!isFileKey(key)) return reply.code(404).send({ error: "não encontrado" });
    const path = join(files.dir, key);
    if (!(await stat(path).catch(() => null))) return reply.code(404).send({ error: "não encontrado" });
    const att = key.endsWith(".webp") ? undefined : (await db.select({ name: attachments.name, mime: attachments.mime }).from(attachments).where(eq(attachments.fileKey, key)).limit(1))[0];
    if (!key.endsWith(".webp") && !att) return reply.code(404).send({ error: "não encontrado" });
    const image = !att || /^image\/(png|jpeg|gif|webp)$/.test(att.mime);
    reply
      .header("content-type", att && !image ? "application/octet-stream" : (att?.mime ?? "image/webp"))
      .header("cache-control", "public, max-age=31536000, immutable")
      .header("x-content-type-options", "nosniff")
      .header("content-security-policy", "default-src 'none'; sandbox");
    if (att) {
      const ascii = att.name.replace(/[^\x20-\x7e]|["\\]/g, "_");
      reply.header("content-disposition", `${image ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(att.name)}`);
    }
    return reply.send(createReadStream(path));
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
      const set: { displayName?: string | null; bio?: string | null; status?: "online" | "busy" } = {};
      if (body.data.displayName !== undefined) set.displayName = body.data.displayName || null;
      if (body.data.bio !== undefined) set.bio = body.data.bio || null;
      if (body.data.status !== undefined) set.status = body.data.status;
      if (Object.keys(set).length) await db.update(users).set(set).where(eq(users.id, me(req).id));
      // Só o status mudou: avisa a presença e pronto (sem fazer todo mundo rebuscar tudo).
      if (Object.keys(set).length === 1 && set.status) {
        const fresh = (await loadUser(me(req).id))!;
        for (const [sock, u] of online) if (u.id === fresh.id) online.set(sock, fresh);
        presence();
        return fresh;
      }
      const fresh = await profileChanged(me(req).id);
      presence();
      return fresh;
    });

    const limits: Record<ImageKind, number> = { avatar: AVATAR_MAX_BYTES, banner: BANNER_MAX_BYTES, icon: SERVER_ICON_MAX_BYTES };
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
          .select({ id: servers.id, name: servers.name, ownerId: servers.ownerId, role: serverMembers.role, icon: servers.iconKey })
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
      const chans = (await db.select({ id: channels.id }).from(channels).where(eq(channels.serverId, server.id))).map((c) => c.id);
      const keys = await fileKeysOf(chans);
      await db.delete(servers).where(eq(servers.id, server.id));
      await removeFiles([...keys, server.iconKey]);
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

    // Ícone do servidor (só o dono, como o nome).
    authed.put<{ Params: { id: string } }>("/servers/:id/icon", async (req, reply) => {
      if (!(await member(req, reply, req.params.id, (r) => r === "owner"))) return;
      if (!uploadAllowed(me(req).id)) return reply.code(429).send({ error: "muitos envios seguidos; espere alguns minutos" });
      const part = await req.file().catch(() => undefined);
      if (!part) return reply.code(400).send({ error: "envie uma imagem" });
      const raw = await part.toBuffer().catch(() => undefined);
      if (!raw || part.file.truncated || raw.length > SERVER_ICON_MAX_BYTES) return reply.code(413).send({ error: "imagem grande demais (máximo 2 MB)" });
      const out = await processImage(raw, "icon");
      if (!out) return reply.code(415).send({ error: "use uma imagem PNG, JPEG, WebP ou GIF" });
      const key = await files.save(out);
      const old = (await findServer(req.params.id))?.iconKey;
      await db.update(servers).set({ iconKey: key }).where(eq(servers.id, req.params.id));
      await files.remove(old);
      toServer(req.params.id, { t: "sync" });
      return { icon: key };
    });
    authed.delete<{ Params: { id: string } }>("/servers/:id/icon", async (req, reply) => {
      if (!(await member(req, reply, req.params.id, (r) => r === "owner"))) return;
      const old = (await findServer(req.params.id))?.iconKey;
      await db.update(servers).set({ iconKey: null }).where(eq(servers.id, req.params.id));
      await files.remove(old);
      toServer(req.params.id, { t: "sync" });
      return { icon: null };
    });

    /** Canal de servidor que quem pede pode gerir (dono ou admin). */
    async function managedChannel(req: FastifyRequest, reply: any, id: string) {
      const channel = await findChannel(id);
      if (!channel?.serverId) return void reply.code(404).send({ error: "canal não existe" });
      if (!(await member(req, reply, channel.serverId, canManage))) return;
      return channel as typeof channel & { serverId: string };
    }
    authed.patch<{ Params: { id: string } }>("/channels/:id", async (req, reply) => {
      const channel = await managedChannel(req, reply, req.params.id);
      if (!channel) return;
      const body = renameChannelBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: "o nome precisa ter de 1 a 40 letras" });
      try {
        await db.update(channels).set({ name: body.data.name }).where(eq(channels.id, channel.id));
      } catch {
        return reply.code(409).send({ error: "já existe um canal com esse nome" });
      }
      toServer(channel.serverId, { t: "sync" });
      return { ...channel, name: body.data.name };
    });
    authed.delete<{ Params: { id: string } }>("/channels/:id", async (req, reply) => {
      const channel = await managedChannel(req, reply, req.params.id);
      if (!channel) return;
      const gone: VoiceState[] = [];
      for (const [sock, v] of voice) if (v.channelId === channel.id) { gone.push(v); voice.delete(sock); }
      if (gone.length) broadcastVoice();
      if (room) await Promise.all(gone.map((v) => room.removeParticipant(voiceRoomName(channel.id), v.userId).catch(() => {})));
      const keys = await fileKeysOf([channel.id]);
      await db.delete(channels).where(eq(channels.id, channel.id));
      await removeFiles(keys);
      toServer(channel.serverId, { t: "sync" });
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
      return { id: server.id, name: server.name, ownerId: server.ownerId, role, icon: server.iconKey } satisfies Server;
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
      // Token curto: só serve para entrar. Com a conexão aberta o LiveKit renova sozinho; quem foi expulso
      // não consegue voltar com um token antigo.
      const at = new AccessToken(livekit.apiKey, livekit.apiSecret, { identity: user.id, name: user.username, ttl: "10m" });
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
        if (!channel || !(await canUseText(channel, me(req).id))) return reply.code(404).send({ error: "canal não existe" });
        const limit = Math.min(Number(req.query.limit ?? 50) || 50, 100);
        const before = req.query.before ? new Date(req.query.before) : undefined;
        if (before && Number.isNaN(before.getTime())) return reply.code(400).send({ error: "data inválida" });
        const rows = await db
          .select(messageCols)
          .from(messages)
          .innerJoin(users, eq(users.id, messages.userId))
          .where(and(eq(messages.channelId, req.params.id), before ? lt(messages.createdAt, before) : undefined))
          .orderBy(desc(messages.createdAt))
          .limit(limit);
        return toMessages(rows.reverse());
      },
    );

    // ---- Não lidas ----
    /** Conversas com mensagens de outras pessoas depois da última leitura (canais de texto dos meus servidores e DMs). */
    authed.get("/unread", async (req) => {
      const id = me(req).id;
      const token = `%${mentionToken(id)}%`;
      const rows = await db.execute(sql`
        WITH mine AS (
          SELECT c.id, c.server_id, COALESCE(r.last_read_at, sm.joined_at) AS since
            FROM channels c
            JOIN server_members sm ON sm.server_id = c.server_id AND sm.user_id = ${id}
            LEFT JOIN read_states r ON r.channel_id = c.id AND r.user_id = ${id}
            WHERE c.kind = 'text'
          UNION ALL
          SELECT c.id, NULL, COALESCE(r.last_read_at, 'epoch'::timestamptz)
            FROM dm_members d
            JOIN channels c ON c.id = d.channel_id
            LEFT JOIN read_states r ON r.channel_id = c.id AND r.user_id = ${id}
            WHERE d.user_id = ${id})
        SELECT mine.id AS "channelId", mine.server_id AS "serverId", count(m.id)::int AS count,
               (count(m.id) FILTER (WHERE m.content LIKE ${token} OR r.user_id = ${id}))::int AS mentions
          FROM mine JOIN messages m ON m.channel_id = mine.id AND m.created_at > mine.since AND m.user_id <> ${id}
          LEFT JOIN messages r ON r.id = m.reply_to
          GROUP BY mine.id, mine.server_id`);
      const list = (Array.isArray(rows) ? rows : (rows as { rows: unknown[] }).rows) as Unread[];
      return list.map((r) => ({ channelId: r.channelId, serverId: r.serverId ?? null, count: Number(r.count), mentions: Number(r.mentions) }) satisfies Unread);
    });
    authed.post<{ Params: { id: string } }>("/channels/:id/read", async (req, reply) => {
      const channel = await findChannel(req.params.id);
      if (!channel || !(await canUseText(channel, me(req).id))) return reply.code(404).send({ error: "canal não existe" });
      await markRead(me(req).id, channel.id);
      toUsers([me(req).id], { t: "read", channelId: channel.id });
      return { ok: true };
    });

    // ---- Editar e apagar mensagens ----
    authed.patch<{ Params: { id: string } }>("/messages/:id", async (req, reply) => {
      const body = editMessageBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: "a mensagem precisa ter de 1 a 4000 letras" });
      const row = (await db.select({ userId: messages.userId, channelId: messages.channelId }).from(messages).where(eq(messages.id, req.params.id)).limit(1))[0];
      const channel = row && (await findChannel(row.channelId));
      if (!row || !channel || !(await canUseText(channel, me(req).id))) return reply.code(404).send({ error: "mensagem não existe" });
      if (row.userId !== me(req).id) return reply.code(403).send({ error: "só quem escreveu pode editar" });
      await db.update(messages).set({ content: body.data.content, editedAt: new Date() }).where(eq(messages.id, req.params.id));
      const message = (await loadMessage(req.params.id))!;
      await toChannel(channel, { t: "messageUpdate", message });
      return message;
    });
    /** Apaga a própria mensagem; em servidor, dono e admin também apagam a dos outros. */
    authed.delete<{ Params: { id: string } }>("/messages/:id", async (req, reply) => {
      const row = (await db.select({ userId: messages.userId, channelId: messages.channelId }).from(messages).where(eq(messages.id, req.params.id)).limit(1))[0];
      const channel = row && (await findChannel(row.channelId));
      if (!row || !channel || !(await canUseText(channel, me(req).id))) return reply.code(404).send({ error: "mensagem não existe" });
      const mine = row.userId === me(req).id;
      if (!mine && !(channel.serverId && canManage(await roleIn(channel.serverId, me(req).id)))) return reply.code(403).send({ error: "sem permissão" });
      const keys = (await db.select({ key: attachments.fileKey }).from(attachments).where(eq(attachments.messageId, req.params.id))).map((r) => r.key);
      await db.delete(messages).where(eq(messages.id, req.params.id));
      await removeFiles(keys);
      await toChannel(channel, { t: "messageDelete", channelId: channel.id, id: req.params.id });
      return { ok: true };
    });

    // ---- Anexos ----
    // Limite próprio, mais folgado que o de fotos de perfil: 40 arquivos a cada 10 minutos.
    const attachmentsBy = new Map<string, number[]>();
    const attachmentAllowed = (userId: string) => {
      const now = Date.now();
      const recent = (attachmentsBy.get(userId) ?? []).filter((t) => now - t < UPLOAD_WINDOW_MS);
      if (recent.length >= 40) return (attachmentsBy.set(userId, recent), false);
      recent.push(now);
      attachmentsBy.set(userId, recent);
      return true;
    };
    /** Envia um arquivo para usar na próxima mensagem do canal (evento "send" com `attachments`). */
    authed.post<{ Params: { id: string } }>("/channels/:id/attachments", async (req, reply) => {
      const channel = await findChannel(req.params.id);
      if (!channel || !(await canUseText(channel, me(req).id))) return reply.code(404).send({ error: "canal não existe" });
      if (channel.kind === "dm" && (await dmBlocked(channel.id))) return reply.code(403).send({ error: "não é possível enviar para essa pessoa" });
      if (!attachmentAllowed(me(req).id)) return reply.code(429).send({ error: "muitos arquivos seguidos; espere alguns minutos" });
      const part = await req.file({ limits: { fileSize: ATTACHMENT_MAX_BYTES, files: 1 } }).catch(() => undefined);
      if (!part) return reply.code(400).send({ error: "envie um arquivo" });
      const raw = await part.toBuffer().catch(() => undefined);
      if (!raw || part.file.truncated || raw.length > ATTACHMENT_MAX_BYTES) return reply.code(413).send({ error: `arquivo grande demais (máximo ${ATTACHMENT_MAX_BYTES / 1024 / 1024} MB)` });
      if (!raw.length) return reply.code(400).send({ error: "arquivo vazio" });
      const out = await processAttachment(raw);
      const name = (part.filename || "arquivo").split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 120) || "arquivo";
      const key = await files.save(out.data, out.ext);
      const att: Attachment = { id: newId(), key, name, size: out.data.length, mime: out.mime, width: out.width, height: out.height };
      await db.insert(attachments).values({ id: att.id, channelId: channel.id, userId: me(req).id, fileKey: key, name, size: att.size, mime: att.mime, width: att.width, height: att.height });
      return att;
    });
  });

  // Webhooks do LiveKit: o servidor confere quem está de fato nas salas (a lista de quem está na chamada vem do
  // gateway, que só sabe o que o cliente avisou). Ligar no livekit.yaml: webhook.api_key + webhook.urls.
  if (livekit && room) {
    const receiver = new WebhookReceiver(livekit.apiKey, livekit.apiSecret);
    const checks = new Set<ReturnType<typeof setTimeout>>();
    app.addHook("onClose", async () => { for (const t of checks) clearTimeout(t); });
    /** Pode estar nesta sala agora (mesma regra do token)? */
    const mayJoin = async (channelId: string, userId: string) => {
      const channel = await findChannel(channelId);
      if (!channel) return false;
      if (channel.kind === "dm") return (await isDmMember(channel.id, userId)) && !(await dmBlocked(channel.id));
      return channel.kind === "voice" && !!channel.serverId && !!(await roleIn(channel.serverId, userId));
    };
    const reported = (channelId: string, userId: string) => [...voice.values()].some((v) => v.channelId === channelId && v.userId === userId);
    app.register(async (hook) => {
      hook.addContentTypeParser("application/webhook+json", { parseAs: "string" }, (_req, body, done) => done(null, body));
      hook.post("/livekit/webhook", async (req, reply) => {
        let evt;
        try {
          evt = await receiver.receive(String(req.body ?? ""), req.headers.authorization);
        } catch {
          return reply.code(401).send({ error: "assinatura inválida" });
        }
        const name = evt.room?.name ?? "";
        const identity = evt.participant?.identity;
        if (!name.startsWith("voice-") || !identity) return { ok: true };
        const channelId = name.slice("voice-".length);
        if (evt.event === "participant_joined") {
          // Entrou sem permissão (token antigo de quem foi expulso): sai na hora.
          if (!(await mayJoin(channelId, identity))) {
            await room.removeParticipant(name, identity).catch(() => {});
            return { ok: true };
          }
          // Entrou e não avisou o gateway (ouvinte invisível): depois de um tempo, sai.
          const t = setTimeout(() => {
            checks.delete(t);
            if (reported(channelId, identity)) return;
            void (async () => {
              const still = await room.getParticipant(name, identity).then(() => true, () => false);
              if (still && !reported(channelId, identity)) await room.removeParticipant(name, identity).catch(() => {});
            })();
          }, voiceGraceMs);
          t.unref?.();
          checks.add(t);
        }
        if (evt.event === "participant_left" && reported(channelId, identity)) {
          // Pode ter só trocado de aparelho: confirma com o LiveKit antes de tirar da lista.
          const still = await room.getParticipant(name, identity).then(() => true, () => false);
          if (!still) {
            let changed = false;
            for (const [s, v] of voice) if (v.channelId === channelId && v.userId === identity) { voice.delete(s); changed = true; }
            if (changed) broadcastVoice();
          }
        }
        return { ok: true };
      });
    });
  }

  app.register(async (instance) => {
    instance.get<{ Querystring: { token?: string } }>("/ws", { websocket: true }, async (socket: Socket, req) => {
      // Escuta desde já: o que chega enquanto a conexão é preparada (consultas ao banco) fica numa fila.
      // Antes, o estado de voz que o cliente reenvia ao reconectar podia se perder aqui.
      const queue: Buffer[] = [];
      let deliver: ((raw: Buffer) => void) | undefined;
      let waiter: (() => void) | undefined;
      socket.on("message", (raw: Buffer) => {
        if (deliver) return deliver(raw);
        queue.push(raw);
        waiter?.();
      });
      // Fechou no meio da preparação: limpa assim que a preparação terminar.
      let gone = false;
      let cleanup: (() => void) | undefined;
      socket.on("close", () => {
        gone = true;
        cleanup?.();
      });
      const nextQueued = (ms: number) =>
        new Promise<Buffer | undefined>((resolve) => {
          if (queue.length) return resolve(queue.shift());
          const t = setTimeout(() => { waiter = undefined; resolve(undefined); }, ms);
          waiter = () => { clearTimeout(t); waiter = undefined; resolve(queue.shift()); };
        });
      // Token na primeira mensagem ({ t: "auth", token }), para não ficar em URL nem em log; os apps
      // antigos ainda mandam na URL (?token=).
      let token = req.query.token;
      if (!token) {
        const first = await nextQueued(10_000);
        try {
          const e = first && JSON.parse(first.toString());
          if (e?.t === "auth" && typeof e.token === "string") token = e.token;
        } catch {
          // primeira mensagem inválida: fica sem token
        }
      }
      const connected = await userFromToken(token);
      if (!connected) return socket.close(4401, "unauthorized");
      if (gone) return;
      online.set(socket, connected);
      // Ping a cada heartbeatMs: quem não responde (notebook dormiu, Wi-Fi caiu sem fechar) é derrubado,
      // e o close tira a pessoa da presença e da chamada. Qualquer mensagem também conta como sinal de vida.
      let alive = true;
      socket.on("pong", () => (alive = true));
      const beat = setInterval(() => {
        if (!alive) return socket.terminate ? socket.terminate() : socket.close(4000, "sem resposta");
        alive = false;
        socket.ping?.();
      }, heartbeatMs);
      beat.unref?.();
      memberships.set(socket, await loadMemberships(connected.id));
      dmSets.set(socket, await loadDmSet(connected.id));
      cleanup = () => {
        clearInterval(beat);
        online.delete(socket);
        memberships.delete(socket);
        dmSets.delete(socket);
        presence();
        if (voice.delete(socket)) broadcastVoice();
      };
      if (gone) return cleanup();
      presence();
      socket.send(JSON.stringify(voiceStatesFor(socket)));
      deliver = (raw: Buffer) => {
        alive = true;
        // Um erro aqui (banco fora, por exemplo) não pode virar promessa rejeitada solta: isso derruba o processo.
        handle(raw).catch((err) => {
          req.log.error({ err, userId: connected.id }, "ws: erro ao tratar evento");
          try {
            socket.send(JSON.stringify({ t: "error", error: "erro no servidor; tente de novo" } satisfies ServerEvent));
          } catch {
            // conexão já fechada
          }
        });
      };
      const handle = async (raw: Buffer) => {
        let evt;
        try {
          evt = clientEvent.parse(JSON.parse(raw.toString()));
        } catch {
          return socket.send(JSON.stringify({ t: "error", error: "evento inválido" } satisfies ServerEvent));
        }
        // O perfil pode ter mudado desde que a conexão abriu.
        const user = online.get(socket) ?? connected;
        if (evt.t === "ping") return socket.send(JSON.stringify({ t: "pong" } satisfies ServerEvent));
        if (evt.t === "auth") return; // já autenticado (token veio na URL)
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
        // Reenvio de algo que já entrou (a conexão caiu antes da confirmação): só confirma de novo.
        const nonceKey = evt.nonce ? `${user.id}:${evt.nonce}` : undefined;
        const already = nonceKey ? sentNonces.get(nonceKey) : undefined;
        if (already) {
          const prev = await loadMessage(already.id);
          if (prev) socket.send(JSON.stringify({ t: "message", message: prev, nonce: evt.nonce } satisfies ServerEvent));
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
          return socket.send(JSON.stringify({ t: "error", nonce: evt.nonce, error: "canal não existe" } satisfies ServerEvent));
        if (isDm && (await dmBlocked(channel.id)))
          return socket.send(JSON.stringify({ t: "error", nonce: evt.nonce, error: "não é possível enviar mensagem para essa pessoa" } satisfies ServerEvent));
        // Anexos: só os que a própria pessoa enviou para este canal e ainda não usou.
        const picked = evt.attachments.length
          ? await db.select(attachmentCols).from(attachments).where(and(inArray(attachments.id, evt.attachments), eq(attachments.userId, user.id), eq(attachments.channelId, channel.id), isNull(attachments.messageId)))
          : [];
        if (picked.length !== new Set(evt.attachments).size)
          return socket.send(JSON.stringify({ t: "error", nonce: evt.nonce, error: "anexo inválido; envie o arquivo de novo" } satisfies ServerEvent));
        // Resposta: só a uma mensagem que ainda existe no mesmo canal.
        const replyTo = evt.replyTo ? (await replyPreviews([evt.replyTo])).get(evt.replyTo) : undefined;
        if (evt.replyTo) {
          const target = replyTo && (await db.select({ c: messages.channelId }).from(messages).where(eq(messages.id, evt.replyTo)).limit(1))[0];
          if (!target || target.c !== channel.id)
            return socket.send(JSON.stringify({ t: "error", nonce: evt.nonce, error: "a mensagem respondida não existe mais" } satisfies ServerEvent));
        }
        const message: Message = {
          id: newId(), channelId: evt.channelId, userId: user.id, username: user.username, displayName: user.displayName, avatar: user.avatar, staff: canInviteAccounts(user),
          content: evt.content, createdAt: new Date().toISOString(), editedAt: null,
          attachments: evt.attachments.map((id) => toAttachment(picked.find((f) => f.id === id)!)),
          replyToId: replyTo?.id ?? null, replyTo: replyTo ?? null,
        };
        await db.insert(messages).values({ id: message.id, channelId: message.channelId, userId: user.id, content: message.content, createdAt: new Date(message.createdAt), replyTo: message.replyToId });
        if (picked.length) await db.update(attachments).set({ messageId: message.id }).where(inArray(attachments.id, picked.map((f) => f.id)));
        if (nonceKey) rememberNonce(nonceKey, message.id);
        await markRead(user.id, channel.id);
        if (isDm) toUsers(await dmPeers(channel.id), { t: "message", message, nonce: evt.nonce });
        else toServer(channel.serverId!, { t: "message", message, nonce: evt.nonce });
      };
      // Pronto: entrega o que chegou durante a preparação, na ordem.
      for (const raw of queue.splice(0)) deliver(raw);
    });
  });

  return app;
}
