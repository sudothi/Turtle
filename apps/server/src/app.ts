import Fastify, { type FastifyReply, type FastifyRequest, type FastifyServerOptions } from "fastify";
import { AccessToken, RoomServiceClient, TrackSource, WebhookReceiver } from "livekit-server-sdk";
import fastifyStatic from "@fastify/static";
import multipart from "@fastify/multipart";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { stat, statfs } from "node:fs/promises";
import { join } from "node:path";
import websocket from "@fastify/websocket";
import {
  and, asc, attachments, blocks, channels, count, desc, dmMembers, eq, friendships, gt, inArray, invites, isNotNull, isNull, lt, messages, messageReceipts, ne, or, reactions, readStates, serverInvites, serverBans, serverMembers, servers, sessions, soundboardSounds, sql, users, type Db,
} from "@turtle/db";
import {
  ATTACHMENT_MAX_BYTES,
  type Attachment,
  REPLY_PREVIEW_CHARS,
  type ReplyPreview,
  SESSION_TOUCH_MS,
  SESSION_TTL_MS,
  type SessionInfo,
  changePasswordBody,
  editMessageBody,
  sendTextBody,
  sentMessageId,
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
  MAX_EMOJI_LENGTH, MAX_OWNED_SERVERS, MAX_PINS, MAX_REACTION_KINDS,
  clientEvent,
  createChannelBody,
  createInviteBody,
  createAccountInviteBody,
  type AccountInvitePreview,
  createServerBody,
  deleteServerBody,
  loginBody,
  registerBody,
  renameServerBody,
  NICKNAME_MAX,
  nicknameBody,
  moveVoiceBody,
  roleBody,
  transferBody,
  updateProfileBody,
  type InvitePreview,
  type Member,
  type Message,
  type Server,
  type ServerEvent,
  type Activity,
  type ServerRole,
  type User,
  type VoiceState,
  type VoiceToken,
  MAX_CONCURRENT_SOUNDS, MAX_SOUNDS_PER_SERVER, SOUND_COOLDOWN_MS, SOUND_MAX_BYTES, SOUNDS_PER_MINUTE,
  createSoundQuery, soundboardSettingsBody, updateSoundBody, canEditSound, JUKEBOX_ADDS_PER_MINUTE, jukeboxAddBody,
  type Sound, type SoundIcon,
} from "@turtle/protocol";
import { processSound } from "./sound.js";
import { fileStore, isFileKey, processAttachment, processImage, type ImageKind } from "./profile.js";
import { hashPassword, hashToken, newId, newInviteCode, newSessionId, newToken, verifyPassword } from "./auth.js";
import { attemptLimiter } from "./limiter.js";
import { fetchLinkPreview, type LinkPreview } from "./linkpreview.js";
import { MUSIC_ID, musicService, type Fetcher } from "./music.js";
import { audioType, jukeboxService } from "./jukebox.js";
import { ytdlp, ytdlpRunner, type YtdlpRun } from "./ytdlp.js";
import { registerWaitlist, type WaitlistNotice } from "./waitlist.js";

export interface AppOptions {
  db: Db;
  waitlistNotify?: WaitlistNotice;
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
  /** Cota de anexos por conta, em bytes (soma de attachments.size). Padrão: 500 MB. */
  attachmentQuotaBytes?: number;
  /** Por quanto tempo os anexos das mensagens ficam no servidor antes de expirar. Padrão: 7 dias. */
  attachmentRetentionMs?: number;
  /** Intervalo da limpeza automática de anexos órfãos e vencidos. Padrão: 15 min. */
  sweepIntervalMs?: number;
  /** Uso máximo do disco (0 a 1) antes de recusar novos uploads para proteger o banco. Padrão: 0.85 (85%). */
  maxDiskUsageRatio?: number;
  /** Quanto esperar, depois de alguém entrar numa sala do LiveKit, para conferir se avisou o gateway. Padrão: 30 s. */
  voiceGraceMs?: number;
  /** Só para testes: deixa a prévia de links alcançar endereços locais. */
  linkPreviewAllowPrivate?: boolean;
  /** Só para testes: substitui a busca HTTP do cartão de música (Spotify e Deezer). */
  musicFetch?: Fetcher;
  /**
   * Discoteca (bot de música da chamada). `ytdlp`: caminho do yt-dlp (liga links do YouTube, SoundCloud e Bandcamp
   * e a música completa na busca); sem ele, a busca toca só a prévia de 30 s. `run` e `fetchImage` são para testes.
   */
  jukebox?: { cacheDir?: string; cacheMb?: number; ytdlp?: string; ytdlpArgs?: string[]; run?: YtdlpRun; fetchImage?: (url: string) => Promise<Buffer | null>; leadMs?: number; idleMs?: number };
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
/** Arquivo do cache da discoteca, com suporte a Range (o <audio> pede pedaços ao pular para o meio). */
async function sendCached(req: FastifyRequest, reply: FastifyReply, path: string, type: string) {
  const st = await stat(path).catch(() => null);
  if (!st?.isFile()) return reply.code(404).send({ error: "não encontrado" });
  reply
    .header("content-type", type)
    .header("accept-ranges", "bytes")
    .header("cache-control", "private, max-age=86400, immutable")
    .header("x-content-type-options", "nosniff")
    .header("content-security-policy", "default-src 'none'; sandbox");
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : Math.max(0, st.size - Number(m[2]));
    let end = m[1] && m[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1;
    if (start >= st.size || start > end) return reply.code(416).header("content-range", `bytes */${st.size}`).send();
    start = Math.max(0, start);
    end = Math.max(start, end);
    return reply.code(206).header("content-range", `bytes ${start}-${end}/${st.size}`).header("content-length", end - start + 1).send(createReadStream(path, { start, end }));
  }
  return reply.header("content-length", st.size).send(createReadStream(path));
}

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
  heartbeatMs = 30_000, attachmentQuotaBytes = 500 * 1024 ** 2,
  attachmentRetentionMs = 7 * 24 * 3_600_000, sweepIntervalMs = 15 * 60_000, maxDiskUsageRatio = 0.85,
  voiceGraceMs = 30_000, roomService, linkPreviewAllowPrivate, musicFetch, waitlistNotify, jukebox: jukeboxOpts = {},
}: AppOptions) {
  const app = Fastify({ logger, trustProxy });
  registerWaitlist(app, db, waitlistNotify);
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
  /** Sessão de cada conexão WebSocket: permite encerrar os sockets de uma sessão ou conta com 4401. */
  const socketSessions = new Map<Socket, { userId: string; tokenHash: string; sessionId: string }>();
  const closeSessions = (pred: (s: { userId: string; tokenHash: string; sessionId: string }) => boolean) => {
    for (const [sock, info] of socketSessions) {
      if (pred(info)) {
        socketSessions.delete(sock);
        sock.close(4401, "unauthorized");
      }
    }
  };
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
    presence();
  };
  /** Amizades (pendentes ou aceitas) de cada conexão: quem tem amizade com você vê sua presença e seu perfil. */
  const friendSets = new Map<Socket, Set<string>>();
  const loadFriendSet = async (userId: string) =>
    new Set(
      (await db.select().from(friendships).where(or(eq(friendships.userA, userId), eq(friendships.userB, userId)))).map((r) =>
        r.userA === userId ? r.userB : r.userA,
      ),
    );
  const refreshFriends = async (userIds: Iterable<string>) => {
    for (const id of new Set(userIds)) {
      const set = await loadFriendSet(id);
      for (const [s, u] of online) if (u.id === id) friendSets.set(s, set);
    }
    presence();
  };
  const loadMemberships = async (userId: string) =>
    new Set((await db.select({ id: serverMembers.serverId }).from(serverMembers).where(eq(serverMembers.userId, userId))).map((r) => r.id));
  const refreshMemberships = async (userId: string) => {
    const set = await loadMemberships(userId);
    for (const [s, u] of online) if (u.id === userId) memberships.set(s, set);
    presence();
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
  const intersects = (a?: Set<string>, b?: Set<string>) => {
    if (!a || !b) return false;
    for (const x of a) if (b.has(x)) return true;
    return false;
  };
  /** `viewer` enxerga `other` (presença, perfil) se for a mesma conta ou se dividirem servidor, DM ou amizade. */
  const sees = (viewer: Socket, other: Socket) =>
    online.get(viewer)!.id === online.get(other)!.id ||
    intersects(memberships.get(viewer), memberships.get(other)) ||
    intersects(dmSets.get(viewer), dmSets.get(other)) ||
    (friendSets.get(viewer)?.has(online.get(other)!.id) ?? false);
  /** Cada conexão recebe só a presença de quem ela enxerga (não a lista de todas as contas conectadas). */
  /** Jogo informado por cada conexão (só memória: some quando ela cai). */
  const activities = new Map<Socket, Activity>();
  const presence = () => {
    const sockets = [...online.keys()];
    for (const viewer of sockets) {
      const seen = sockets.filter((o) => sees(viewer, o));
      const people = seen.map((o) => online.get(o)!);
      const acts: Record<string, Activity> = {};
      for (const o of seen) {
        const a = activities.get(o);
        if (a) acts[online.get(o)!.id] = a;
      }
      viewer.send(JSON.stringify({ t: "presence", online: [...new Set(people.map((u) => u.id))], busy: [...new Set(people.filter((u) => u.status === "busy").map((u) => u.id))], activities: acts } satisfies ServerEvent));
    }
  };

  /** Quem deve receber a mudança de perfil de `userId`: ele mesmo e quem divide servidor, DM ou amizade com ele. */
  const profileAudience = async (userId: string) => {
    const ids = new Set<string>([userId]);
    const servers = [...(await loadMemberships(userId))];
    if (servers.length) for (const r of await db.select({ id: serverMembers.userId }).from(serverMembers).where(inArray(serverMembers.serverId, servers))) ids.add(r.id);
    const dms = [...(await loadDmSet(userId))];
    if (dms.length) for (const r of await db.select({ id: dmMembers.userId }).from(dmMembers).where(inArray(dmMembers.channelId, dms))) ids.add(r.id);
    for (const id of await loadFriendSet(userId)) ids.add(id);
    return ids;
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
  // Discoteca: fila e relógio de cada chamada de servidor; quem está no servidor (mesmo fora da chamada) recebe o estado.
  const music = musicService(musicFetch);
  const ytdlpRun = jukeboxOpts.run ?? (jukeboxOpts.ytdlp ? ytdlpRunner(jukeboxOpts.ytdlp, jukeboxOpts.ytdlpArgs) : undefined);
  const jukebox = jukeboxService({
    cacheDir: jukeboxOpts.cacheDir ?? join(uploadDir, "..", "music-cache"),
    cacheBytes: (jukeboxOpts.cacheMb ?? 1024) * 1024 * 1024,
    yt: ytdlpRun ? ytdlp(ytdlpRun, (msg) => app.log.warn(msg)) : undefined, log: (msg) => app.log.warn(msg),
    music, fetchImage: jukeboxOpts.fetchImage, leadMs: jukeboxOpts.leadMs, idleMs: jukeboxOpts.idleMs,
    onChange: (channelId, serverId, state) => toServer(serverId, { t: "jukebox", channelId, state }),
  });
  const inCall = (channelId: string, userId: string) => [...voice.values()].some((v) => v.channelId === channelId && v.userId === userId);
  // Soundboard: quando cada conta tocou sons (último minuto) e até quando os sons de cada chamada tocam.
  const soundPlays = new Map<string, number[]>();
  const soundsPlaying = new Map<string, number[]>();
  // Toque de chamada em DM/grupo: um por canal; para quando alguém atende, quem ligou sai, recusam todos ou passam 30 s.
  const RING_MS = 30_000;
  const rings = new Map<string, { callerId: string; targets: Set<string>; timer: ReturnType<typeof setTimeout> }>();
  const endRing = (channelId: string, only?: string) => {
    const r = rings.get(channelId);
    if (!r) return;
    if (only) {
      r.targets.delete(only);
      toUsers([only], { t: "ringEnd", channelId });
      if (r.targets.size) return;
    } else toUsers(r.targets, { t: "ringEnd", channelId });
    clearTimeout(r.timer);
    rings.delete(channelId);
  };
  /** Chamado a cada mudança de voz: encerra o toque de quem já foi atendido ou cancelado. */
  const syncRings = () => {
    for (const [channelId, r] of rings) {
      const inCall = [...voice.values()].filter((v) => v.channelId === channelId);
      if (!inCall.some((v) => v.userId === r.callerId) || inCall.some((v) => v.userId !== r.callerId)) endRing(channelId);
    }
  };
  const broadcastVoice = () => {
    syncRings();
    // Discoteca: chamada que esvaziou pausa (e acaba depois de um tempo); alguém voltou, continua.
    for (const id of jukebox.channels()) jukebox.occupancy(id, [...voice.values()].filter((v) => v.channelId === id).length);
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
  /** Tira uma conta de qualquer chamada (de servidor ou conversa direta). */
  const dropUserFromCalls = async (userId: string) => {
    const gone: VoiceState[] = [];
    for (const [s, v] of voice) if (v.userId === userId) { gone.push(v); voice.delete(s); }
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
      return { id, name, ownerId: owner.id, role: "owner", icon: null, soundboardAdminsOnly: false } satisfies Server;
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
    isAdmin: users.isAdmin, canInvite: users.canInvite, content: messages.content, createdAt: messages.createdAt, editedAt: messages.editedAt, replyTo: messages.replyTo, pinnedAt: messages.pinnedAt,
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
  const groupReactions = (rows: { emoji: string; userId: string }[]) => {
    const by = new Map<string, string[]>();
    for (const r of rows) by.set(r.emoji, [...(by.get(r.emoji) ?? []), r.userId]);
    return [...by].map(([emoji, userIds]) => ({ emoji, userIds }));
  };
  /** Linhas do banco (com o autor) viram mensagens com os anexos e a prévia da resposta. */
  async function toMessages(rows: { id: string; channelId: string; userId: string; username: string; displayName: string | null; avatar: string | null; isAdmin: boolean; canInvite: boolean; content: string; createdAt: Date; editedAt: Date | null; replyTo: string | null; pinnedAt: Date | null }[]): Promise<Message[]> {
    const files = rows.length ? await db.select(attachmentCols).from(attachments).where(inArray(attachments.messageId, rows.map((r) => r.id))).orderBy(asc(attachments.createdAt)) : [];
    const replies = await replyPreviews(rows.flatMap((r) => (r.replyTo ? [r.replyTo] : [])));
    const reacts = rows.length ? await db.select().from(reactions).where(inArray(reactions.messageId, rows.map((r) => r.id))).orderBy(asc(reactions.createdAt)) : [];
    return rows.map(({ isAdmin, canInvite, replyTo, pinnedAt, ...r }) => ({
      ...r,
      pinned: pinnedAt !== null,
      staff: canInviteAccounts({ isAdmin, canInvite }),
      createdAt: r.createdAt.toISOString(),
      editedAt: r.editedAt?.toISOString() ?? null,
      attachments: files.filter((f) => f.messageId === r.id).map(toAttachment),
      replyToId: replyTo,
      replyTo: (replyTo && replies.get(replyTo)) || null,
      reactions: groupReactions(reacts.filter((x) => x.messageId === r.id)),
    }));
  }
  const loadMessage = async (id: string) => {
    const row = (await db.select(messageCols).from(messages).innerJoin(users, eq(users.id, messages.userId)).where(eq(messages.id, id)).limit(1))[0];
    return row ? (await toMessages([row]))[0] : undefined;
  };
  const soundCols = {
    id: soundboardSounds.id, serverId: soundboardSounds.serverId, userId: soundboardSounds.userId, name: soundboardSounds.name,
    icon: soundboardSounds.icon, volume: soundboardSounds.volume, durationMs: soundboardSounds.durationMs, key: soundboardSounds.fileKey,
  };
  const toSound = (r: { icon: string } & Omit<Sound, "icon">): Sound => ({ ...r, icon: r.icon as SoundIcon });
  /** Apaga do disco os anexos dos canais (antes de apagar os canais, que leva as linhas junto). */
  const fileKeysOf = async (channelIds: string[]) =>
    channelIds.length ? (await db.select({ key: attachments.fileKey }).from(attachments).where(inArray(attachments.channelId, channelIds))).map((r) => r.key) : [];
  const removeFiles = async (keys: (string | null | undefined)[]) => {
    for (const k of keys) await files.remove(k).catch(() => {});
  };
  /** Marca a conversa como lida agora. */
  const markRead = (userId: string, channelId: string) =>
    db.insert(readStates).values({ userId, channelId, lastReadAt: new Date() }).onConflictDoUpdate({ target: [readStates.userId, readStates.channelId], set: { lastReadAt: new Date() } });

  // Anexos órfãos (enviados e nunca usados numa mensagem) somem depois de 1 h;
  // anexos de mensagens antigas somem depois de `attachmentRetentionMs` (7 dias por padrão), mantendo o texto da conversa.
  const sweepAttachments = async () => {
    const now = Date.now();
    const orphans = await db.select({ id: attachments.id, key: attachments.fileKey }).from(attachments).where(and(isNull(attachments.messageId), lt(attachments.createdAt, new Date(now - 3_600_000))));
    if (orphans.length) {
      await db.delete(attachments).where(inArray(attachments.id, orphans.map((o) => o.id)));
      await removeFiles(orphans.map((o) => o.key));
    }
    const expired = await db
      .select({ id: attachments.id, messageId: attachments.messageId, key: attachments.fileKey, name: attachments.name })
      .from(attachments)
      .where(and(isNotNull(attachments.messageId), lt(attachments.createdAt, new Date(now - attachmentRetentionMs))));
    if (!expired.length) return;
    await db.delete(attachments).where(inArray(attachments.id, expired.map((e) => e.id)));
    await removeFiles(expired.map((e) => e.key));
    const byMsg = new Map<string, string[]>();
    for (const e of expired) if (e.messageId) byMsg.set(e.messageId, [...(byMsg.get(e.messageId) ?? []), e.name]);
    for (const [msgId, names] of byMsg) {
      const row = (await db.select({ id: messages.id, channelId: messages.channelId, content: messages.content }).from(messages).where(eq(messages.id, msgId)).limit(1))[0];
      if (!row) continue;
      const rem = (await db.select({ n: count() }).from(attachments).where(eq(attachments.messageId, msgId)))[0]?.n ?? 0;
      if (rem === 0 && row.content.trim() === "") {
        await db.update(messages).set({ content: `[anexo expirado: ${names.join(", ")}]` }).where(eq(messages.id, msgId));
      }
      const channel = await findChannel(row.channelId);
      const message = await loadMessage(msgId);
      if (channel && message) await toChannel(channel, { t: "messageUpdate", message });
    }
  };
  void sweepAttachments().catch(() => {});
  const sweeper = setInterval(() => void sweepAttachments().catch(() => {}), sweepIntervalMs);
  sweeper.unref();
  app.addHook("onClose", async () => { clearInterval(sweeper); for (const r of rings.values()) clearTimeout(r.timer); jukebox.close(); });

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

  async function sessionFromToken(token: string | undefined): Promise<{ user: User; tokenHash: string; sessionId: string } | null> {
    if (!token) return null;
    const th = hashToken(token);
    const row = (
      await db
        .select({ ...userCols, disabledAt: users.disabledAt, sessionId: sessions.id, lastUsedAt: sessions.lastUsedAt, expiresAt: sessions.expiresAt })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(eq(sessions.tokenHash, th))
        .limit(1)
    )[0];
    if (!row) return null;
    const now = Date.now();
    if (row.disabledAt || row.expiresAt.getTime() <= now) {
      if (row.expiresAt.getTime() <= now) await db.delete(sessions).where(eq(sessions.tokenHash, th));
      return null;
    }
    // Validade deslizante (30 dias sem uso expira); escreve no banco no máximo uma vez por hora.
    if (now - row.lastUsedAt.getTime() >= SESSION_TOUCH_MS) {
      const at = new Date(now);
      await db.update(sessions).set({ lastUsedAt: at, expiresAt: new Date(now + SESSION_TTL_MS) }).where(eq(sessions.tokenHash, th));
    }
    return { user: toUser(row), tokenHash: th, sessionId: row.sessionId };
  }
  const bearer = (req: FastifyRequest) => req.headers.authorization?.replace(/^Bearer /, "");

  async function startSession(userId: string, req: FastifyRequest) {
    const token = newToken();
    const now = new Date();
    const ua = typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"].trim().slice(0, 240) || null : null;
    await db.insert(sessions).values({
      tokenHash: hashToken(token),
      id: newSessionId(),
      userId,
      userAgent: ua,
      createdAt: now,
      lastUsedAt: now,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    });
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
    // Marca o convite numa única operação: se dois cadastros usarem o mesmo código ao mesmo tempo, só um vence.
    const claimed = await db.update(invites).set({ usedBy: id }).where(and(eq(invites.code, inviteCode), isNull(invites.usedBy))).returning({ code: invites.code, serverId: invites.serverId });
    if (!claimed.length) {
      await db.delete(users).where(eq(users.id, id));
      return reply.code(403).send({ error: "convite inválido" });
    }
    // Convite de conta com servidor: a pessoa já começa dentro dele (se o servidor ainda existir).
    const serverId = claimed[0]!.serverId;
    if (serverId && (await findServer(serverId))) {
      await db.insert(serverMembers).values({ serverId, userId: id, role: "member" }).onConflictDoNothing();
      toServer(serverId, { t: "sync" });
    }
    return { token: await startSession(id, req), user };
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
    if (row.disabledAt) return reply.code(403).send({ error: "conta desativada" });
    byName.reset(name);
    return { token: await startSession(row.id, req), user: toUser(row) };
  });

  // Prévia de um convite de conta na tela de cadastro: diz em qual servidor a pessoa vai entrar.
  // Usa o mesmo limite por IP do cadastro, para não virar um jeito de testar códigos.
  app.get<{ Params: { code: string } }>("/account-invites/:code", async (req, reply) => {
    const wait = byIp.blockedFor(req.ip);
    if (wait) return tooMany(reply, wait);
    const inv = (await db.select().from(invites).where(eq(invites.code, req.params.code)).limit(1))[0];
    if (!inv || inv.usedBy) {
      byIp.hit(req.ip);
      return reply.code(404).send({ error: "convite inválido" });
    }
    const server = inv.serverId ? await findServer(inv.serverId) : undefined;
    return { serverName: server?.name ?? null } satisfies AccountInvitePreview;
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
  // Áudio e capa da discoteca: sem login (o <audio> não manda o token); a assinatura na URL é a permissão.
  app.get<{ Params: { sig: string; file: string } }>("/jukebox/audio/:sig/:file", async (req, reply) => {
    const path = jukebox.file("audio", req.params.sig, req.params.file);
    return path ? sendCached(req, reply, path, audioType(req.params.file)!) : reply.code(404).send({ error: "não encontrado" });
  });
  app.get<{ Params: { sig: string; file: string } }>("/jukebox/cover/:sig/:file", async (req, reply) => {
    const path = jukebox.file("cover", req.params.sig, req.params.file);
    return path ? sendCached(req, reply, path, "image/webp") : reply.code(404).send({ error: "não encontrado" });
  });
  app.get<{ Params: { key: string } }>("/files/:key", async (req, reply) => {
    const key = req.params.key;
    if (!isFileKey(key)) return reply.code(404).send({ error: "não encontrado" });
    const path = join(files.dir, key);
    if (!(await stat(path).catch(() => null))) return reply.code(404).send({ error: "não encontrado" });
    if (key.endsWith(".wav")) {
      // Som do soundboard (só existe enquanto a linha existir).
      const snd = (await db.select({ id: soundboardSounds.id }).from(soundboardSounds).where(eq(soundboardSounds.fileKey, key)).limit(1))[0];
      if (!snd) return reply.code(404).send({ error: "não encontrado" });
      reply
        .header("content-type", "audio/wav")
        .header("cache-control", "public, max-age=31536000, immutable")
        .header("x-content-type-options", "nosniff")
        .header("content-security-policy", "default-src 'none'; sandbox");
      return reply.send(createReadStream(path));
    }
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
      const sess = await sessionFromToken(bearer(req));
      if (!sess) return reply.code(401).send({ error: "não autenticado" });
      (req as any).user = sess.user;
      (req as any).tokenHash = sess.tokenHash;
      (req as any).sessionId = sess.sessionId;
    });
    const me = (req: FastifyRequest) => (req as any).user as User;
    const myTokenHash = (req: FastifyRequest) => (req as any).tokenHash as string;
    const mySessionId = (req: FastifyRequest) => (req as any).sessionId as string;

    authed.get("/me", async (req) => (await loadUser(me(req).id)) ?? me(req));

    /** Sair de verdade: apaga a sessão atual no banco e fecha os WebSockets dela com 4401. */
    authed.post("/auth/logout", async (req) => {
      const th = myTokenHash(req);
      await db.delete(sessions).where(eq(sessions.tokenHash, th));
      closeSessions((s) => s.tokenHash === th);
      return { ok: true };
    });

    /** Lista as sessões ativas da conta (aparelho, último uso e qual é a atual). */
    authed.get("/me/sessions", async (req) => {
      const myId = me(req).id;
      const curId = mySessionId(req);
      const rows = await db
        .select({ id: sessions.id, userAgent: sessions.userAgent, createdAt: sessions.createdAt, lastUsedAt: sessions.lastUsedAt })
        .from(sessions)
        .where(and(eq(sessions.userId, myId), gt(sessions.expiresAt, new Date())))
        .orderBy(desc(sessions.lastUsedAt));
      return rows.map((r): SessionInfo => ({
        id: r.id,
        userAgent: r.userAgent,
        createdAt: r.createdAt.toISOString(),
        lastUsedAt: r.lastUsedAt.toISOString(),
        current: r.id === curId,
      }));
    });

    /** Encerra uma sessão específica da conta ("sair deste") e fecha o WebSocket dela com 4401. */
    authed.delete<{ Params: { id: string } }>("/me/sessions/:id", async (req, reply) => {
      const myId = me(req).id;
      const done = await db
        .delete(sessions)
        .where(and(eq(sessions.userId, myId), eq(sessions.id, req.params.id)))
        .returning({ id: sessions.id });
      if (!done.length) return reply.code(404).send({ error: "sessão não encontrada" });
      closeSessions((s) => s.userId === myId && s.sessionId === req.params.id);
      return { ok: true };
    });

    /** Encerra todas as sessões da conta ("sair de todos") e fecha os WebSockets com 4401. */
    authed.delete("/me/sessions", async (req) => {
      const myId = me(req).id;
      await db.delete(sessions).where(eq(sessions.userId, myId));
      closeSessions((s) => s.userId === myId);
      return { ok: true };
    });

    /** Troca a senha, mantém a sessão atual e derruba todas as outras sessões da conta. */
    authed.post("/me/password", async (req, reply) => {
      const user = me(req);
      const name = nameKey(user.username);
      const wait = Math.max(byIp.blockedFor(req.ip), byName.blockedFor(name));
      if (wait) return tooMany(reply, wait);
      byIp.hit(req.ip);
      const body = changePasswordBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: "a nova senha precisa ter pelo menos 8 caracteres" });
      const row = (await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, user.id)).limit(1))[0];
      if (!row || !(await verifyPassword(body.data.currentPassword, row.passwordHash))) {
        byName.hit(name);
        return reply.code(401).send({ error: "senha atual incorreta" });
      }
      byName.reset(name);
      const curHash = myTokenHash(req);
      await db.update(users).set({ passwordHash: await hashPassword(body.data.newPassword) }).where(eq(users.id, user.id));
      await db.delete(sessions).where(and(eq(sessions.userId, user.id), ne(sessions.tokenHash, curHash)));
      closeSessions((s) => s.userId === user.id && s.tokenHash !== curHash);
      return { ok: true };
    });

    // ---- Perfil ----
    /** Propaga o perfil novo: conexões abertas, estado de voz e evento userUpdate só para quem divide servidor, DM ou amizade. */
    async function profileChanged(userId: string) {
      const fresh = await loadUser(userId);
      if (!fresh) return;
      for (const [s, u] of online) if (u.id === userId) online.set(s, fresh);
      for (const [s, v] of voice) if (v.userId === userId) voice.set(s, { ...v, displayName: fresh.displayName, avatar: fresh.avatar, staff: canInviteAccounts(fresh) });
      broadcastVoice();
      toUsers(await profileAudience(userId), {
        t: "userUpdate",
        user: { id: fresh.id, username: fresh.username, displayName: fresh.displayName, bio: fresh.bio, avatar: fresh.avatar, banner: fresh.banner, staff: canInviteAccounts(fresh) },
      });
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
          .select({ id: servers.id, name: servers.name, ownerId: servers.ownerId, role: serverMembers.role, icon: servers.iconKey, soundboardAdminsOnly: servers.soundboardAdminsOnly })
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
      for (const st of jukebox.statesFor(new Set([server.id]))) jukebox.clear(st.channelId);
      const chans = (await db.select({ id: channels.id }).from(channels).where(eq(channels.serverId, server.id))).map((c) => c.id);
      const keys = await fileKeysOf(chans);
      const soundKeys = (await db.select({ key: soundboardSounds.fileKey }).from(soundboardSounds).where(eq(soundboardSounds.serverId, server.id))).map((r) => r.key);
      await db.delete(servers).where(eq(servers.id, server.id));
      await removeFiles([...keys, ...soundKeys, server.iconKey]);
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
      jukebox.clear(channel.id);
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
        .select({ userId: users.id, username: users.username, displayName: users.displayName, avatar: users.avatarKey, isAdmin: users.isAdmin, canInvite: users.canInvite, role: serverMembers.role, nickname: serverMembers.nickname })
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

    // Banimentos: mesmas regras de expulsar (dono bane qualquer um; admin só membro comum).
    const canModerate = (role: ServerRole, target: ServerRole | undefined) => role === "owner" || (role === "admin" && (!target || target === "member"));
    authed.get<{ Params: { id: string } }>("/servers/:id/bans", async (req, reply) => {
      if (!(await member(req, reply, req.params.id, (r) => r === "owner" || r === "admin"))) return;
      const rows = await db
        .select({ userId: serverBans.userId, username: users.username, displayName: users.displayName, reason: serverBans.reason, createdAt: serverBans.createdAt })
        .from(serverBans).innerJoin(users, eq(users.id, serverBans.userId)).where(eq(serverBans.serverId, req.params.id)).orderBy(desc(serverBans.createdAt));
      return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
    });
    authed.post<{ Params: { id: string; user: string } }>("/servers/:id/bans/:user", async (req, reply) => {
      const role = await member(req, reply, req.params.id, (r) => r === "owner" || r === "admin");
      if (!role) return;
      if (req.params.user === me(req).id) return reply.code(400).send({ error: "você não pode banir a si mesmo" });
      const target = await roleIn(req.params.id, req.params.user);
      if (target === "owner") return reply.code(403).send({ error: "o dono não pode ser banido" });
      if (!canModerate(role, target)) return reply.code(403).send({ error: "sem permissão" });
      if (!(await db.select({ id: users.id }).from(users).where(eq(users.id, req.params.user)).limit(1)).length) return reply.code(404).send({ error: "pessoa não existe" });
      const reason = typeof (req.body as any)?.reason === "string" ? (req.body as any).reason.trim().slice(0, 200) || null : null;
      await db.insert(serverBans).values({ serverId: req.params.id, userId: req.params.user, bannedBy: me(req).id, reason }).onConflictDoNothing();
      if (target) {
        await db.delete(serverMembers).where(and(eq(serverMembers.serverId, req.params.id), eq(serverMembers.userId, req.params.user)));
        await dropFromCalls(req.params.id, req.params.user);
        await refreshMemberships(req.params.user);
        toUsers([req.params.user], { t: "sync" });
        toServer(req.params.id, { t: "sync" });
      }
      return { ok: true };
    });
    authed.delete<{ Params: { id: string; user: string } }>("/servers/:id/bans/:user", async (req, reply) => {
      if (!(await member(req, reply, req.params.id, (r) => r === "owner" || r === "admin"))) return;
      await db.delete(serverBans).where(and(eq(serverBans.serverId, req.params.id), eq(serverBans.userId, req.params.user)));
      return { ok: true };
    });

    // Apelido no servidor: cada um muda o seu; dono e admin mudam o de quem podem moderar.
    authed.patch<{ Params: { id: string; user: string } }>("/servers/:id/members/:user/nickname", async (req, reply) => {
      const role = await member(req, reply, req.params.id);
      if (!role) return;
      const body = nicknameBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: `o apelido pode ter até ${NICKNAME_MAX} letras` });
      const target = await roleIn(req.params.id, req.params.user);
      if (!target) return reply.code(404).send({ error: "essa pessoa não está no servidor" });
      if (req.params.user !== me(req).id && (target === "owner" || !canModerate(role, target))) return reply.code(403).send({ error: "sem permissão" });
      const nickname = body.data.nickname || null;
      await db.update(serverMembers).set({ nickname }).where(and(eq(serverMembers.serverId, req.params.id), eq(serverMembers.userId, req.params.user)));
      toServer(req.params.id, { t: "sync" });
      return { nickname };
    });

    // Mover ou desconectar alguém de uma chamada do servidor (mesmas regras de expulsar).
    const callOf = (serverId: string, userId: string) => [...voice.entries()].find(([, v]) => v.serverId === serverId && v.userId === userId);
    const voiceModerator = async (req: FastifyRequest<{ Params: { id: string; user: string } }>, reply: FastifyReply) => {
      const role = await member(req, reply, req.params.id, (r) => r === "owner" || r === "admin");
      if (!role) return;
      if (req.params.user === me(req).id) return void reply.code(400).send({ error: "use os controles da chamada" });
      const target = await roleIn(req.params.id, req.params.user);
      if (!canModerate(role, target)) return void reply.code(403).send({ error: "sem permissão" });
      const call = callOf(req.params.id, req.params.user);
      if (!call) return void reply.code(404).send({ error: "essa pessoa não está numa chamada deste servidor" });
      return call;
    };
    authed.post<{ Params: { id: string; user: string } }>("/servers/:id/voice/:user/move", async (req, reply) => {
      const body = moveVoiceBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: "dados inválidos" });
      const call = await voiceModerator(req, reply);
      if (!call) return;
      const channel = await findChannel(body.data.channelId);
      if (!channel || channel.kind !== "voice" || channel.serverId !== req.params.id) return reply.code(404).send({ error: "canal de voz não existe" });
      if (call[1].channelId === channel.id) return { ok: true };
      // Quem se move é o próprio aplicativo da pessoa: ele sai da sala atual e entra na nova.
      call[0].send(JSON.stringify({ t: "voiceMoved", channelId: channel.id, by: me(req).id } satisfies ServerEvent));
      return { ok: true };
    });
    authed.delete<{ Params: { id: string; user: string } }>("/servers/:id/voice/:user", async (req, reply) => {
      const call = await voiceModerator(req, reply);
      if (!call) return;
      const [sock, v] = call;
      sock.send(JSON.stringify({ t: "voiceMoved", channelId: null, by: me(req).id } satisfies ServerEvent));
      voice.delete(sock);
      broadcastVoice();
      if (room) await room.removeParticipant(voiceRoomName(v.channelId), v.userId).catch(() => {});
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
      if ((await db.select({ u: serverBans.userId }).from(serverBans).where(and(eq(serverBans.serverId, inv.serverId), eq(serverBans.userId, me(req).id))).limit(1)).length)
        return reply.code(403).send({ error: "você foi banido deste servidor" });
      if (!(await roleIn(inv.serverId, me(req).id))) {
        await db.insert(serverMembers).values({ serverId: inv.serverId, userId: me(req).id, role: "member" });
        await db.update(serverInvites).set({ uses: sql`${serverInvites.uses} + 1` }).where(eq(serverInvites.code, inv.code));
        await refreshMemberships(me(req).id);
        toServer(inv.serverId, { t: "sync" });
      }
      const role = (await roleIn(inv.serverId, me(req).id))!;
      return { id: server.id, name: server.name, ownerId: server.ownerId, role, icon: server.iconKey, soundboardAdminsOnly: server.soundboardAdminsOnly } satisfies Server;
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
      await refreshFriends([id, other]);
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
      await refreshFriends([me(req).id, req.params.userId]);
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
      await refreshFriends([id, other]);
      toUsers([id, other], { t: "friends" });
      return { ok: true };
    });
    authed.delete<{ Params: { userId: string } }>("/blocks/:userId", async (req) => {
      await db.delete(blocks).where(and(eq(blocks.blocker, me(req).id), eq(blocks.blocked, req.params.userId)));
      await refreshFriends([me(req).id, req.params.userId]);
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

    // Convites de conta (admin do app ou cargo Convidador), de uso único. Com `serverId`, a conta nova já entra
    // nesse servidor; quem convida precisa ser membro dele (não dá para mandar gente para servidor alheio).
    authed.post("/invites", async (req, reply) => {
      if (!canInviteAccounts(me(req))) return reply.code(403).send({ error: "só admin ou convidador" });
      const body = createAccountInviteBody.safeParse(req.body ?? {});
      if (!body.success) return reply.code(400).send({ error: "dados inválidos" });
      const serverId = body.data.serverId ?? null;
      if (serverId && !(await member(req, reply, serverId))) return;
      const code = newInviteCode();
      await db.insert(invites).values({ code, createdBy: me(req).id, serverId });
      return { code };
    });

    // ---- Administração do app (só admin) ----
    authed.get("/admin/users", async (req, reply) => {
      if (!me(req).isAdmin) return reply.code(403).send({ error: "só admin" });
      const rows = await db.select({ ...userCols, disabledAt: users.disabledAt }).from(users).orderBy(asc(users.createdAt));
      return rows.map((r): Account => ({
        id: r.id,
        username: r.username,
        displayName: r.displayName,
        avatar: r.avatarKey,
        isAdmin: r.isAdmin,
        canInvite: r.canInvite,
        disabled: r.disabledAt !== null,
      }));
    });
    /** Dá ou tira o cargo Convidador e desativa ou reativa uma conta. */
    authed.patch<{ Params: { id: string } }>("/admin/users/:id", async (req, reply) => {
      if (!me(req).isAdmin) return reply.code(403).send({ error: "só admin" });
      const body = setInviterBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: "dados inválidos" });
      const target = (await db.select({ id: users.id, isAdmin: users.isAdmin }).from(users).where(eq(users.id, req.params.id)).limit(1))[0];
      if (!target) return reply.code(404).send({ error: "pessoa não encontrada" });
      if (body.data.disabled && (target.id === me(req).id || target.isAdmin))
        return reply.code(403).send({ error: "não é possível desativar um administrador" });
      const set: { canInvite?: boolean; disabledAt?: Date | null } = {};
      if (body.data.canInvite !== undefined) set.canInvite = body.data.canInvite;
      if (body.data.disabled !== undefined) set.disabledAt = body.data.disabled ? new Date() : null;
      await db.update(users).set(set).where(eq(users.id, target.id));
      if (body.data.disabled) {
        await db.delete(sessions).where(eq(sessions.userId, target.id));
        await dropUserFromCalls(target.id);
        closeSessions((s) => s.userId === target.id);
      }
      await profileChanged(req.params.id); // a tag TURTLE aparece/some para todo mundo
      return { ok: true };
    });

    authed.post<{ Params: { id: string } }>("/channels/:id/messages", async (req, reply) => {
      const body = sendTextBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: "mensagem inválida (1 a 4000 caracteres)" });
      const channel = await findChannel(req.params.id);
      const user = me(req);
      if (!channel || !(await canUseText(channel, user.id))) return reply.code(404).send({ error: "canal não existe" });
      if (channel.kind === "dm" && await dmBlocked(channel.id)) return reply.code(403).send({ error: "não é possível enviar mensagem para essa pessoa" });
      const { requestId, content } = body.data;
      const id = sentMessageId(user.id, requestId);
      const bodyHash = createHash("sha256").update(content).digest("hex");
      const result = await db.transaction(async tx => {
        const inserted = await tx.insert(messageReceipts).values({ userId: user.id, requestId, channelId: channel.id, bodyHash }).onConflictDoNothing().returning();
        if (!inserted.length) {
          const [receipt] = await tx.select().from(messageReceipts).where(and(eq(messageReceipts.userId, user.id), eq(messageReceipts.requestId, requestId)));
          return receipt?.channelId === channel.id && receipt.bodyHash === bodyHash ? "replay" : "conflict";
        }
        await tx.insert(messages).values({ id, channelId: channel.id, userId: user.id, content, createdAt: new Date() });
        return "created";
      });
      if (result === "conflict") return reply.code(409).send({ error: "identificador de envio já usado com outra mensagem" });
      const message = await loadMessage(id);
      if (!message) return reply.code(410).send({ error: "esta mensagem já foi enviada e apagada" });
      if (result === "created") await toChannel(channel, { t: "message", message });
      await markRead(user.id, channel.id);
      return message;
    });

    authed.get<{ Params: { id: string }; Querystring: { before?: string; beforeId?: string; limit?: string } }>(
      "/channels/:id/messages",
      async (req, reply) => {
        const channel = await findChannel(req.params.id);
        if (!channel || !(await canUseText(channel, me(req).id))) return reply.code(404).send({ error: "canal não existe" });
        const limit = Math.max(1, Math.min(Math.trunc(Number(req.query.limit ?? 50)) || 50, 100));
        const before = req.query.before ? new Date(req.query.before) : undefined;
        if (before && Number.isNaN(before.getTime())) return reply.code(400).send({ error: "data inválida" });
        if (req.query.beforeId && !before) return reply.code(400).send({ error: "beforeId exige before" });
        // Match the binary ID ordering used by clients, regardless of the database locale.
        const orderedId = sql`${messages.id} COLLATE "C"`;
        const cursor = before ? req.query.beforeId
          ? or(lt(messages.createdAt, before), and(eq(messages.createdAt, before), lt(orderedId, req.query.beforeId)))
          : lt(messages.createdAt, before) : undefined;
        const rows = await db
          .select(messageCols)
          .from(messages)
          .innerJoin(users, eq(users.id, messages.userId))
          .where(and(eq(messages.channelId, req.params.id), cursor))
          .orderBy(desc(messages.createdAt), desc(orderedId))
          .limit(limit);
        return toMessages(rows.reverse());
      },
    );

    // ---- Busca ----
    // Só em conversas que a pessoa vê: o canal pedido, ou todos os canais de texto de um servidor dela.
    const searchIn = async (channelIds: string[], q: string) => {
      if (!channelIds.length) return [];
      const rows = await db
        .select(messageCols).from(messages).innerJoin(users, eq(users.id, messages.userId))
        .where(and(inArray(messages.channelId, channelIds), sql`to_tsvector('portuguese', ${messages.content}) @@ websearch_to_tsquery('portuguese', ${q})`))
        .orderBy(desc(messages.createdAt)).limit(25);
      return toMessages(rows);
    };
    const searchQuery = (q: unknown) => (typeof q === "string" ? q.trim().slice(0, 100) : "");
    authed.get<{ Params: { id: string }; Querystring: { q?: string } }>("/channels/:id/search", async (req, reply) => {
      const channel = await findChannel(req.params.id);
      if (!channel || !(await canUseText(channel, me(req).id))) return reply.code(404).send({ error: "canal não existe" });
      const q = searchQuery(req.query.q);
      return q.length < 2 ? [] : searchIn([channel.id], q);
    });
    authed.get<{ Params: { id: string }; Querystring: { q?: string } }>("/servers/:id/search", async (req, reply) => {
      if (!(await member(req, reply, req.params.id))) return;
      const q = searchQuery(req.query.q);
      if (q.length < 2) return [];
      const ids = (await db.select({ id: channels.id }).from(channels).where(and(eq(channels.serverId, req.params.id), eq(channels.kind, "text")))).map((c) => c.id);
      return searchIn(ids, q);
    });

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
    // ---- Fixar mensagens ----
    /** Em servidor, só dono/admin fixam; em conversa direta, qualquer participante. */
    const pinTo = (pin: boolean) => async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const row = (await db.select({ channelId: messages.channelId, pinnedAt: messages.pinnedAt }).from(messages).where(eq(messages.id, req.params.id)).limit(1))[0];
      const channel = row && (await findChannel(row.channelId));
      if (!row || !channel || !(await canUseText(channel, me(req).id))) return reply.code(404).send({ error: "mensagem não existe" });
      if (channel.serverId && !canManage(await roleIn(channel.serverId, me(req).id))) return reply.code(403).send({ error: "só dono e admins fixam mensagens" });
      if (pin && row.pinnedAt === null) {
        const n = (await db.select({ n: count() }).from(messages).where(and(eq(messages.channelId, channel.id), isNotNull(messages.pinnedAt))))[0]?.n ?? 0;
        if (Number(n) >= MAX_PINS) return reply.code(400).send({ error: `no máximo ${MAX_PINS} mensagens fixadas por canal` });
      }
      if ((row.pinnedAt !== null) !== pin) {
        await db.update(messages).set({ pinnedAt: pin ? new Date() : null }).where(eq(messages.id, req.params.id));
      }
      const message = (await loadMessage(req.params.id))!;
      await toChannel(channel, { t: "messageUpdate", message });
      return message;
    };
    authed.put<{ Params: { id: string } }>("/messages/:id/pin", pinTo(true));
    authed.delete<{ Params: { id: string } }>("/messages/:id/pin", pinTo(false));
    authed.get<{ Params: { id: string } }>("/channels/:id/pins", async (req, reply) => {
      const channel = await findChannel(req.params.id);
      if (!channel || !(await canUseText(channel, me(req).id))) return reply.code(404).send({ error: "canal não existe" });
      const rows = await db
        .select(messageCols).from(messages).innerJoin(users, eq(users.id, messages.userId))
        .where(and(eq(messages.channelId, channel.id), isNotNull(messages.pinnedAt)))
        .orderBy(desc(messages.pinnedAt));
      return toMessages(rows);
    });

    // ---- Reações ----
    const reactTo = (add: boolean) => async (req: FastifyRequest<{ Params: { id: string; emoji: string } }>, reply: FastifyReply) => {
      const emoji = req.params.emoji.normalize("NFC");
      // Só emoji de verdade: sem letras/dígitos soltos nem texto livre.
      if (!emoji || [...emoji].length > MAX_EMOJI_LENGTH || emoji.length > 32 || !/^[\p{Extended_Pictographic}\p{Emoji_Component}\u200d\ufe0f]+$/u.test(emoji) || /^[\d#*]+$/.test(emoji))
        return reply.code(400).send({ error: "emoji inválido" });
      const row = (await db.select({ channelId: messages.channelId }).from(messages).where(eq(messages.id, req.params.id)).limit(1))[0];
      const channel = row && (await findChannel(row.channelId));
      if (!row || !channel || !(await canUseText(channel, me(req).id))) return reply.code(404).send({ error: "mensagem não existe" });
      if (add) {
        const kinds = (await db.selectDistinct({ e: reactions.emoji }).from(reactions).where(eq(reactions.messageId, req.params.id))).map((k) => k.e);
        if (!kinds.includes(emoji) && kinds.length >= MAX_REACTION_KINDS) return reply.code(400).send({ error: "reações demais nessa mensagem" });
        await db.insert(reactions).values({ messageId: req.params.id, userId: me(req).id, emoji }).onConflictDoNothing();
      } else {
        await db.delete(reactions).where(and(eq(reactions.messageId, req.params.id), eq(reactions.userId, me(req).id), eq(reactions.emoji, emoji)));
      }
      const message = (await loadMessage(req.params.id))!;
      await toChannel(channel, { t: "messageUpdate", message });
      return message;
    };
    authed.put<{ Params: { id: string; emoji: string } }>("/messages/:id/reactions/:emoji", reactTo(true));
    authed.delete<{ Params: { id: string; emoji: string } }>("/messages/:id/reactions/:emoji", reactTo(false));

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

    // ---- Soundboard ----
    // Sons curtos por servidor. Tocar é pelo WebSocket (evento soundboardPlay); aqui fica só a lista e a edição.
    authed.get<{ Params: { id: string } }>("/servers/:id/sounds", async (req, reply) => {
      if (!(await member(req, reply, req.params.id))) return;
      return (await db.select(soundCols).from(soundboardSounds).where(eq(soundboardSounds.serverId, req.params.id)).orderBy(asc(soundboardSounds.createdAt))).map(toSound);
    });
    authed.post<{ Params: { id: string }; Querystring: Record<string, string> }>("/servers/:id/sounds", async (req, reply) => {
      const role = await member(req, reply, req.params.id);
      if (!role) return;
      const server = (await findServer(req.params.id))!;
      if (server.soundboardAdminsOnly && !canManage(role)) return reply.code(403).send({ error: "só admins podem adicionar sons neste servidor" });
      const meta = createSoundQuery.safeParse(req.query);
      if (!meta.success) return reply.code(400).send({ error: "dê um nome de 1 a 32 letras ao som" });
      const n = (await db.select({ n: count() }).from(soundboardSounds).where(eq(soundboardSounds.serverId, server.id)))[0]!.n;
      if (n >= MAX_SOUNDS_PER_SERVER) return reply.code(409).send({ error: `o servidor já tem ${MAX_SOUNDS_PER_SERVER} sons; apague algum antes` });
      if (!attachmentAllowed(me(req).id)) return reply.code(429).send({ error: "muitos arquivos seguidos; espere alguns minutos" });
      const disk = await statfs(files.dir).catch(() => undefined);
      if (disk && disk.blocks > 0 && (disk.blocks - disk.bavail) / disk.blocks >= maxDiskUsageRatio)
        return reply.code(507).send({ error: "disco do servidor quase cheio; tente mais tarde" });
      const part = await req.file({ limits: { fileSize: SOUND_MAX_BYTES, files: 1 } }).catch(() => undefined);
      if (!part) return reply.code(400).send({ error: "envie um áudio" });
      const raw = await part.toBuffer().catch(() => undefined);
      if (!raw || part.file.truncated || raw.length > SOUND_MAX_BYTES) return reply.code(413).send({ error: `áudio grande demais (máximo ${SOUND_MAX_BYTES / 1024} KB)` });
      const out = processSound(raw);
      if ("error" in out) return reply.code(415).send({ error: out.error });
      const key = await files.save(out.data, "wav");
      const sound: Sound = { id: newId(), serverId: server.id, userId: me(req).id, name: meta.data.name, icon: meta.data.icon, volume: meta.data.volume, durationMs: out.durationMs, key };
      await db.insert(soundboardSounds).values({ ...sound, fileKey: key, size: out.data.length });
      toServer(server.id, { t: "sounds", serverId: server.id });
      return sound;
    });
    /** Som que quem pede pode editar (quem enviou, ou dono/admin). */
    async function editableSound(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
      const row = (await db.select(soundCols).from(soundboardSounds).where(eq(soundboardSounds.id, req.params.id)).limit(1))[0];
      const role = row ? await roleIn(row.serverId, me(req).id) : undefined;
      if (!row || !role) return void reply.code(404).send({ error: "som não existe" });
      if (!canEditSound(row, me(req).id, role)) return void reply.code(403).send({ error: "sem permissão" });
      return toSound(row);
    }
    authed.patch<{ Params: { id: string } }>("/sounds/:id", async (req, reply) => {
      const sound = await editableSound(req, reply);
      if (!sound) return;
      const body = updateSoundBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: "dados inválidos" });
      const next = { ...sound, ...body.data };
      await db.update(soundboardSounds).set({ name: next.name, icon: next.icon, volume: next.volume }).where(eq(soundboardSounds.id, sound.id));
      toServer(sound.serverId, { t: "sounds", serverId: sound.serverId });
      return next;
    });
    authed.delete<{ Params: { id: string } }>("/sounds/:id", async (req, reply) => {
      const sound = await editableSound(req, reply);
      if (!sound) return;
      await db.delete(soundboardSounds).where(eq(soundboardSounds.id, sound.id));
      await files.remove(sound.key).catch(() => {});
      toServer(sound.serverId, { t: "sounds", serverId: sound.serverId });
      return { ok: true };
    });
    authed.put<{ Params: { id: string } }>("/servers/:id/soundboard", async (req, reply) => {
      if (!(await member(req, reply, req.params.id, canManage))) return;
      const body = soundboardSettingsBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: "dados inválidos" });
      await db.update(servers).set({ soundboardAdminsOnly: body.data.adminsOnly }).where(eq(servers.id, req.params.id));
      toServer(req.params.id, { t: "sync" });
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
    const attachmentUsage = async (userId: string) =>
      Number((await db.select({ n: sql<number>`coalesce(sum(${attachments.size}), 0)` }).from(attachments).where(eq(attachments.userId, userId)))[0]?.n ?? 0);
    const fmtMb = (b: number) => (b / 1024 / 1024).toFixed(b >= 10 * 1024 * 1024 ? 0 : 1);
    /** Uso da cota de anexos da própria conta (mostrado em Configurações). */
    // ---- Prévia de links ----
    // O servidor busca a página (só endereços públicos, sem imagem, 512 KB, 5 s); o cliente nunca toca no site de terceiros.
    const previewLimit = attemptLimiter({ max: 30, windowMs: 60_000 });
    const previewCache = new Map<string, { at: number; preview: LinkPreview | null }>();
    authed.get<{ Querystring: { url?: string } }>("/link-preview", async (req, reply) => {
      const url = String(req.query.url ?? "").slice(0, 2000);
      if (!url) return reply.code(400).send({ error: "link inválido" });
      const key = me(req).id;
      if (previewLimit.blockedFor(key)) return reply.code(429).send({ error: "devagar" });
      let hit = previewCache.get(url);
      if (!hit || Date.now() - hit.at > 3_600_000) {
        previewLimit.hit(key);
        hit = { at: Date.now(), preview: await fetchLinkPreview(url, { allowPrivate: linkPreviewAllowPrivate }) };
        if (previewCache.size >= 500) previewCache.delete(previewCache.keys().next().value!);
        previewCache.set(url, hit);
      }
      return hit.preview ?? reply.code(404).send({ error: "sem prévia" });
    });

    // ---- Cartão de música (link do Spotify) ----
    // Título, artista e capa da página pública do Spotify; prévia de 30 s do Deezer. Capa e áudio passam pelo servidor.
    const musicLimit = attemptLimiter({ max: 60, windowMs: 60_000 });
    authed.get<{ Querystring: { url?: string } }>("/music/spotify", async (req, reply) => {
      const url = String(req.query.url ?? "").slice(0, 500);
      if (!url) return reply.code(400).send({ error: "link inválido" });
      const key = me(req).id;
      if (musicLimit.blockedFor(key)) return reply.code(429).send({ error: "devagar" });
      musicLimit.hit(key);
      const track = await music.resolve(url);
      return track ?? reply.code(404).send({ error: "música não encontrada" });
    });
    authed.get<{ Querystring: { q?: string } }>("/music/search", async (req, reply) => {
      const q = String(req.query.q ?? "").trim().slice(0, 100);
      if (q.length < 2) return [];
      const key = me(req).id;
      if (musicLimit.blockedFor(key)) return reply.code(429).send({ error: "devagar" });
      musicLimit.hit(key);
      return music.search(q);
    });
    authed.get<{ Params: { id: string } }>("/music/:id/cover", async (req, reply) => {
      const img = MUSIC_ID.test(req.params.id) ? await music.cover(req.params.id) : null;
      if (!img) return reply.code(404).send({ error: "sem capa" });
      return reply.header("cache-control", "private, max-age=86400").type("image/webp").send(img);
    });
    authed.get<{ Params: { id: string } }>("/music/:id/preview", async (req, reply) => {
      const audio = MUSIC_ID.test(req.params.id) ? await music.preview(req.params.id) : null;
      if (!audio) return reply.code(404).send({ error: "sem prévia" });
      return reply.header("cache-control", "private, max-age=3600").type("audio/mpeg").send(audio);
    });

    // ---- Discoteca ----
    // Só quem está na chamada mexe na fila; quem está no servidor vê o estado pelo WebSocket (evento jukebox).
    const jukeboxAdds = attemptLimiter({ max: JUKEBOX_ADDS_PER_MINUTE, windowMs: 60_000 });
    const jukeboxActs = attemptLimiter({ max: 40, windowMs: 60_000 });
    async function jukeboxCall(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
      const channel = await findChannel(req.params.id);
      if (!channel || channel.kind !== "voice" || !channel.serverId || !(await roleIn(channel.serverId, me(req).id))) {
        reply.code(404).send({ error: "canal de voz não existe" });
        return null;
      }
      if (!inCall(channel.id, me(req).id)) {
        reply.code(403).send({ error: "entre na chamada para usar a discoteca" });
        return null;
      }
      return channel as typeof channel & { serverId: string };
    }
    authed.get<{ Params: { id: string } }>("/jukebox/:id", async (req, reply) => {
      const channel = await findChannel(req.params.id);
      if (!channel || channel.kind !== "voice" || !channel.serverId || !(await roleIn(channel.serverId, me(req).id))) return reply.code(404).send({ error: "canal de voz não existe" });
      return { state: jukebox.state(channel.id) };
    });
    authed.post<{ Params: { id: string } }>("/jukebox/:id/queue", async (req, reply) => {
      const body = jukeboxAddBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: "mande um link ou uma música da busca" });
      const channel = await jukeboxCall(req, reply);
      if (!channel) return;
      const key = me(req).id;
      if (jukeboxAdds.blockedFor(key)) return reply.code(429).send({ error: "muitas músicas em pouco tempo; espere um minuto" });
      jukeboxAdds.hit(key);
      const r = await jukebox.add(channel.id, channel.serverId, key, body.data);
      if ("error" in r) return reply.code(r.code).send({ error: r.error });
      return r.item;
    });
    for (const act of ["pause", "resume", "skip"] as const) {
      authed.post<{ Params: { id: string }; Body: { itemId?: string } }>(`/jukebox/:id/${act}`, async (req, reply) => {
        const channel = await jukeboxCall(req, reply);
        if (!channel) return;
        if (jukeboxActs.blockedFor(me(req).id)) return reply.code(429).send({ error: "calma; espere um pouco" });
        jukeboxActs.hit(me(req).id);
        const itemId = typeof req.body?.itemId === "string" ? req.body.itemId : undefined;
        const ok = act === "pause" ? jukebox.pause(channel.id) : act === "resume" ? jukebox.resume(channel.id) : jukebox.skip(channel.id, itemId);
        return { ok };
      });
    }
    authed.delete<{ Params: { id: string; item: string } }>("/jukebox/:id/queue/:item", async (req, reply) => {
      const channel = await jukeboxCall(req, reply);
      if (!channel) return;
      return { ok: jukebox.remove(channel.id, req.params.item) };
    });

    authed.get("/me/storage", async (req) => ({ used: await attachmentUsage(me(req).id), quota: attachmentQuotaBytes }));
    /** Envia um arquivo para usar na próxima mensagem do canal (evento "send" com `attachments`). */
    authed.post<{ Params: { id: string } }>("/channels/:id/attachments", async (req, reply) => {
      const channel = await findChannel(req.params.id);
      if (!channel || !(await canUseText(channel, me(req).id))) return reply.code(404).send({ error: "canal não existe" });
      if (channel.kind === "dm" && (await dmBlocked(channel.id))) return reply.code(403).send({ error: "não é possível enviar para essa pessoa" });
      if (!attachmentAllowed(me(req).id)) return reply.code(429).send({ error: "muitos arquivos seguidos; espere alguns minutos" });
      const disk = await statfs(files.dir).catch(() => undefined);
      if (disk && disk.blocks > 0 && (disk.blocks - disk.bavail) / disk.blocks >= maxDiskUsageRatio)
        return reply.code(507).send({ error: "disco do servidor quase cheio; tente mais tarde" });
      const part = await req.file({ limits: { fileSize: ATTACHMENT_MAX_BYTES, files: 1 } }).catch(() => undefined);
      if (!part) return reply.code(400).send({ error: "envie um arquivo" });
      const raw = await part.toBuffer().catch(() => undefined);
      if (!raw || part.file.truncated || raw.length > ATTACHMENT_MAX_BYTES) return reply.code(413).send({ error: `arquivo grande demais (máximo ${ATTACHMENT_MAX_BYTES / 1024 / 1024} MB)` });
      if (!raw.length) return reply.code(400).send({ error: "arquivo vazio" });
      const out = await processAttachment(raw);
      const used = await attachmentUsage(me(req).id);
      if (used + out.data.length > attachmentQuotaBytes)
        return reply.code(413).send({ error: `cota de anexos cheia (${fmtMb(used)} de ${fmtMb(attachmentQuotaBytes)} MB); apague mensagens com arquivos para liberar espaço` });
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
      const sess = await sessionFromToken(token);
      if (!sess) return socket.close(4401, "unauthorized");
      const connected = sess.user;
      if (gone) return;
      online.set(socket, connected);
      socketSessions.set(socket, { userId: connected.id, tokenHash: sess.tokenHash, sessionId: sess.sessionId });
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
      friendSets.set(socket, await loadFriendSet(connected.id));
      cleanup = () => {
        clearInterval(beat);
        socketSessions.delete(socket);
        online.delete(socket);
        memberships.delete(socket);
        dmSets.delete(socket);
        friendSets.delete(socket);
        activities.delete(socket);
        presence();
        if (voice.delete(socket)) broadcastVoice();
      };
      if (gone) return cleanup();
      presence();
      socket.send(JSON.stringify(voiceStatesFor(socket)));
      for (const state of jukebox.statesFor(memberships.get(socket))) socket.send(JSON.stringify({ t: "jukebox", channelId: state.channelId, state } satisfies ServerEvent));
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
      const floodSecond = attemptLimiter({ max: 10, windowMs: 1_000 });
      const floodWindow = attemptLimiter({ max: 60, windowMs: 10_000 });
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
        // Contra flood: por conexão, no máximo 10 eventos por segundo e 60 a cada 10 s (ping não conta).
        if (evt.t !== "auth") {
          if (floodSecond.blockedFor("c") || floodWindow.blockedFor("c"))
            return socket.send(JSON.stringify({ t: "error", error: "calma: eventos demais; tente de novo em instantes" } satisfies ServerEvent));
          floodSecond.hit("c");
          floodWindow.hit("c");
        }
        if (evt.t === "auth") return; // já autenticado (token veio na URL)
        if (evt.t === "activity") {
          const prev = activities.get(socket);
          const next = evt.activity;
          if (!next) {
            if (prev && activities.delete(socket)) presence();
            return;
          }
          // Mesmo jogo: mantém o início. Só repassa quando algo mudou.
          if (prev && prev.game === next.game && prev.phase === next.phase && prev.detail === next.detail) return;
          activities.set(socket, { ...next, since: prev?.game === next.game ? prev.since : new Date().toISOString() });
          presence();
          return;
        }
        if (evt.t === "typing") {
          const ch = await findChannel(evt.channelId);
          const ok = !ch ? false : ch.kind === "dm" ? await isDmMember(ch.id, user.id) : ch.kind === "text" && !!ch.serverId && !!memberships.get(socket)?.has(ch.serverId);
          if (ch && ok) await toChannel(ch, { t: "typing", channelId: ch.id, userId: user.id });
          return;
        }
        if (evt.t === "ringDecline") {
          const r = rings.get(evt.channelId);
          if (r?.targets.has(user.id)) {
            toUsers([r.callerId], { t: "ringDeclined", channelId: evt.channelId, by: user.id });
            endRing(evt.channelId, user.id);
          }
          return;
        }
        if (evt.t === "soundboardPlay") {
          const fail = (error: string) => socket.send(JSON.stringify({ t: "error", error } satisfies ServerEvent));
          const v = voice.get(socket);
          if (!v || !v.serverId) return fail("entre numa chamada de servidor para tocar sons");
          if (v.deafened) return fail("tire o ensurdecer para tocar sons");
          const row = (await db.select(soundCols).from(soundboardSounds).where(eq(soundboardSounds.id, evt.soundId)).limit(1))[0];
          if (!row || row.serverId !== v.serverId) return fail("som não existe");
          const now = Date.now();
          const mine = (soundPlays.get(user.id) ?? []).filter((t) => now - t < 60_000);
          const last = mine[mine.length - 1];
          if (last !== undefined && now - last < SOUND_COOLDOWN_MS) return fail("espere um pouco para tocar outro som");
          if (mine.length >= SOUNDS_PER_MINUTE) return fail("sons demais em pouco tempo; espere um minuto");
          const playing = (soundsPlaying.get(v.channelId) ?? []).filter((end) => end > now);
          if (playing.length >= MAX_CONCURRENT_SOUNDS) return fail("já tem sons tocando; espere acabar");
          mine.push(now);
          soundPlays.set(user.id, mine);
          playing.push(now + row.durationMs);
          soundsPlaying.set(v.channelId, playing);
          const out = JSON.stringify({ t: "soundboardPlay", channelId: v.channelId, userId: user.id, sound: toSound(row) } satisfies ServerEvent);
          for (const [s, state] of voice) if (state.channelId === v.channelId) s.send(out);
          return;
        }
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
          // Primeira pessoa a entrar na chamada de uma DM/grupo: toca para as outras (só a quem está conectado).
          const alreadyThere = [...voice.values()].some((v) => v.channelId === channel.id);
          const ringTargets = channel.kind === "dm" && !alreadyThere && !rings.has(channel.id)
            ? (await db.select({ id: dmMembers.userId }).from(dmMembers).where(eq(dmMembers.channelId, channel.id))).map((r) => r.id).filter((id) => id !== user.id)
            : [];
          voice.set(socket, {
            userId: user.id, username: user.username, displayName: user.displayName, avatar: user.avatar, staff: canInviteAccounts(user), channelId: channel.id, serverId: channel.serverId ?? "",
            muted: evt.muted, deafened: evt.deafened, camera: evt.camera, screen: evt.screen,
          });
          if (ringTargets.length) {
            const from = { id: user.id, username: user.username, displayName: user.displayName, avatar: user.avatar };
            const targets = new Set(ringTargets);
            const timer = setTimeout(() => endRing(channel.id), RING_MS);
            timer.unref?.();
            rings.set(channel.id, { callerId: user.id, targets, timer });
            for (const s of online.keys()) {
              const u = online.get(s)!;
              if (targets.has(u.id)) s.send(JSON.stringify({ t: "ring", channelId: channel.id, from, silent: u.status === "busy" } satisfies ServerEvent));
            }
          }
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
          replyToId: replyTo?.id ?? null, replyTo: replyTo ?? null, reactions: [], pinned: false,
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
