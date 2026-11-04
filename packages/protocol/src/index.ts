import { z } from "zod";

export const messageSchema = z.object({
  id: z.string(),
  channelId: z.string(),
  userId: z.string(),
  username: z.string(),
  displayName: z.string().nullable().default(null),
  avatar: z.string().nullable().default(null),
  /** Admin do app (ou convidador): mostra a tag TURTLE ao lado do nome. */
  staff: z.boolean().default(false),
  content: z.string(),
  createdAt: z.string(),
});
export type Message = z.infer<typeof messageSchema>;

export const channelKind = z.enum(["text", "voice"]);
export type ChannelKind = z.infer<typeof channelKind>;
export const channelSchema = z.object({ id: z.string(), serverId: z.string(), name: z.string(), kind: channelKind });
export type Channel = z.infer<typeof channelSchema>;

/** Perfil público: `avatar` e `banner` são chaves de arquivo (GET /files/:key). */
export const BIO_MAX = 190;
export const displayNameSchema = z.string().trim().min(1).max(32);
export const userSchema = z.object({
  id: z.string(),
  username: z.string(),
  isAdmin: z.boolean(),
  /** Cargo "Convidador": pode gerar convites de conta (o admin sempre pode). */
  canInvite: z.boolean().default(false),
  displayName: z.string().nullable().default(null),
  bio: z.string().nullable().default(null),
  avatar: z.string().nullable().default(null),
  banner: z.string().nullable().default(null),
});
export type User = z.infer<typeof userSchema>;
export const updateProfileBody = z.object({
  /** null/vazio volta a usar o nome de usuário. */
  displayName: displayNameSchema.nullable().optional().or(z.literal("").transform(() => null)),
  bio: z.string().trim().max(BIO_MAX).nullable().optional(),
});
/** Limites de upload (bytes) e tamanho final das imagens. */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const BANNER_MAX_BYTES = 4 * 1024 * 1024;
/** Nome a mostrar: o de exibição, se houver, senão o de usuário. */
/** Quem pode gerar convites de conta. */
export const canInviteAccounts = (u: { isAdmin: boolean; canInvite?: boolean }) => u.isAdmin || !!u.canInvite;
/** Conta vista pelo admin na aba Administração. */
export const accountSchema = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string().nullable().default(null),
  avatar: z.string().nullable().default(null),
  isAdmin: z.boolean(),
  canInvite: z.boolean(),
});
export type Account = z.infer<typeof accountSchema>;
export const setInviterBody = z.object({ canInvite: z.boolean() });

/** Menção no texto da mensagem: `<@id>`. O cliente mostra o nome de exibição atual da pessoa. */
export const mentionToken = (userId: string) => `<@${userId}>`;
export const MENTION_RE = /<@([A-Za-z0-9_-]+)>/g;
export const mentionedIds = (content: string) => [...content.matchAll(MENTION_RE)].map((m) => m[1]!);
type Named = { userId: string; username: string; displayName?: string | null };
/**
 * Troca `@Nome` (de exibição ou de usuário) pelo token `<@id>` antes de enviar.
 * Nomes mais longos primeiro, e só quando o nome termina numa fronteira (espaço, pontuação ou fim).
 */
export function encodeMentions(text: string, people: Named[]): string {
  const names = people
    .flatMap((p) => [...new Set([shownName(p), p.username])].map((name) => ({ name, id: p.userId })))
    .sort((a, b) => b.name.length - a.name.length);
  let out = "";
  for (let i = 0; i < text.length; ) {
    const before = i === 0 ? " " : text[i - 1]!;
    if (text[i] === "@" && /[\s([{]/u.test(before)) {
      const rest = text.slice(i + 1).toLocaleLowerCase("pt-BR");
      const hit = names.find(({ name }) => {
        if (!rest.startsWith(name.toLocaleLowerCase("pt-BR"))) return false;
        const next = rest[name.length];
        return next === undefined || !/[\p{L}\p{N}_]/u.test(next);
      });
      if (hit) {
        out += mentionToken(hit.id);
        i += 1 + hit.name.length;
        continue;
      }
    }
    out += text[i];
    i += 1;
  }
  return out;
}
/** Quebra o texto em pedaços de texto puro e menções (para desenhar). */
export function splitMentions(content: string): ({ text: string } | { userId: string })[] {
  const parts: ({ text: string } | { userId: string })[] = [];
  let last = 0;
  for (const m of content.matchAll(MENTION_RE)) {
    if (m.index! > last) parts.push({ text: content.slice(last, m.index) });
    parts.push({ userId: m[1]! });
    last = m.index! + m[0].length;
  }
  if (last < content.length) parts.push({ text: content.slice(last) });
  return parts;
}

export const shownName = (u: { username: string; displayName?: string | null }) => u.displayName || u.username;

export const usernameSchema = z.string().trim().min(2).max(32).regex(/^[\p{L}\p{N}_.-]+$/u);
export const passwordSchema = z.string().min(8).max(200);

export const registerBody = z.object({ inviteCode: z.string().min(1), username: usernameSchema, password: passwordSchema });
export const loginBody = z.object({ username: z.string(), password: z.string() });
/** Quantos servidores uma conta pode ter como dona. */
export const MAX_OWNED_SERVERS = 2;

export const serverRole = z.enum(["owner", "admin", "member"]);
export type ServerRole = z.infer<typeof serverRole>;
/** Um servidor visto por quem é membro dele. */
export const serverSchema = z.object({ id: z.string(), name: z.string(), ownerId: z.string(), role: serverRole });
export type Server = z.infer<typeof serverSchema>;
export const memberSchema = z.object({
  userId: z.string(),
  username: z.string(),
  displayName: z.string().nullable().default(null),
  avatar: z.string().nullable().default(null),
  staff: z.boolean().default(false),
  role: serverRole,
});
export type Member = z.infer<typeof memberSchema>;

export const serverNameSchema = z.string().trim().min(2).max(40);
export const createServerBody = z.object({ name: serverNameSchema });
export const renameServerBody = z.object({ name: serverNameSchema });
export const deleteServerBody = z.object({ name: z.string() });
export const transferBody = z.object({ userId: z.string() });
export const roleBody = z.object({ role: z.enum(["admin", "member"]) });
/** days: validade em dias (padrão 7; 0 = não expira). */
export const createInviteBody = z.object({
  days: z.number().int().min(0).max(365).default(7),
  maxUses: z.number().int().min(1).max(1000).optional(),
});
/** O que se vê de um convite antes de entrar. */
export const invitePreviewSchema = z.object({ serverName: z.string(), members: z.number() });
export type InvitePreview = z.infer<typeof invitePreviewSchema>;

export const createChannelBody = z.object({ name: z.string().trim().min(1).max(40), kind: channelKind.default("text") });

/** Pessoa como aparece nas listas de amigos e de conversas. */
export const personSchema = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string().nullable().default(null),
  avatar: z.string().nullable().default(null),
});
export type Person = z.infer<typeof personSchema>;
/** friend = amigos; incoming = pediu amizade a você; outgoing = você pediu. */
export const friendSchema = z.object({ user: personSchema, status: z.enum(["friend", "incoming", "outgoing"]) });
export type Friend = z.infer<typeof friendSchema>;
/**
 * Conversa direta: `channelId` serve em /channels/:id/messages, no evento "send" e na chamada.
 * `users` são as outras pessoas (sem você); `group` = 3 ou mais pessoas; `name` é só de grupo.
 */
export const GROUP_MIN_OTHERS = 2;
export const GROUP_MAX_MEMBERS = 10;
export const dmSchema = z.object({
  channelId: z.string(),
  users: z.array(personSchema),
  group: z.boolean().default(false),
  name: z.string().nullable().default(null),
  lastMessageAt: z.string().nullable(),
});
export const createGroupBody = z.object({ userIds: z.array(z.string()).min(GROUP_MIN_OTHERS).max(GROUP_MAX_MEMBERS - 1), name: z.string().trim().max(40).optional() });
export const addGroupMemberBody = z.object({ userId: z.string() });
/** Título de uma conversa direta: nome do grupo, ou os nomes das pessoas. */
export const dmTitle = (d: Pick<Dm, "users" | "name">) => d.name || d.users.map(shownName).join(", ") || "Conversa";
export type Dm = z.infer<typeof dmSchema>;

/** Quem está em qual canal de voz (para a barra lateral, mesmo fora da chamada). */
export const voiceStateSchema = z.object({
  userId: z.string(),
  username: z.string(),
  displayName: z.string().nullable().default(null),
  avatar: z.string().nullable().default(null),
  staff: z.boolean().default(false),
  channelId: z.string(),
  serverId: z.string(),
  muted: z.boolean(),
  deafened: z.boolean(),
  camera: z.boolean().default(false),
  /** Compartilhando tela (mostra "AO VIVO" na barra lateral). */
  screen: z.boolean().default(false),
});
export type VoiceState = z.infer<typeof voiceStateSchema>;

/** Resposta de POST /voice/:channelId/token. */
export const voiceTokenSchema = z.object({ url: z.string(), token: z.string() });
export type VoiceToken = z.infer<typeof voiceTokenSchema>;

/** Eventos do gateway WebSocket (cliente <-> servidor). */
export const clientEvent = z.discriminatedUnion("t", [
  z.object({ t: z.literal("ping") }),
  z.object({ t: z.literal("send"), channelId: z.string(), content: z.string().trim().min(1).max(4000) }),
  /** channelId null = saiu da voz. */
  z.object({
    t: z.literal("voice"), channelId: z.string().nullable(), muted: z.boolean(), deafened: z.boolean(),
    camera: z.boolean().default(false), screen: z.boolean().default(false),
  }),
]);
export const serverEvent = z.discriminatedUnion("t", [
  z.object({ t: z.literal("pong") }),
  z.object({ t: z.literal("message"), message: messageSchema }),
  z.object({ t: z.literal("channel"), channel: channelSchema }),
  /** Algo mudou nos servidores, canais ou membros: buscar de novo. */
  z.object({ t: z.literal("sync") }),
  /** Amigos ou conversas diretas mudaram: buscar GET /friends e GET /dms de novo. */
  z.object({ t: z.literal("friends") }),
  /** ids das pessoas conectadas. */
  z.object({ t: z.literal("presence"), online: z.array(z.string()) }),
  z.object({ t: z.literal("voiceStates"), states: z.array(voiceStateSchema) }),
  z.object({ t: z.literal("error"), error: z.string() }),
]);

export type ClientEvent = z.infer<typeof clientEvent>;
export type ServerEvent = z.infer<typeof serverEvent>;
