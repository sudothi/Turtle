import { sql } from "drizzle-orm";
import { boolean, index, integer, pgTable, primaryKey, real, text, timestamp, uniqueIndex, type AnyPgColumn } from "drizzle-orm/pg-core";

export const waitlistEntries = pgTable("waitlist_entries", {
  email: text("email").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  notificationAttemptedAt: timestamp("notification_attempted_at", { withTimezone: true }),
  notificationSentAt: timestamp("notification_sent_at", { withTimezone: true }),
});

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
  /** Cargo "Convidador": pode gerar convites de conta sem ser admin do app. */
  canInvite: boolean("can_invite").notNull().default(false),
  displayName: text("display_name"),
  bio: text("bio"),
  avatarKey: text("avatar_key"),
  bannerKey: text("banner_key"),
  /** "online" ou "busy" (Não perturbe). */
  status: text("status", { enum: ["online", "busy"] }).notNull().default("online"),
  /** Conta desativada pelo admin (bloqueia login e apaga as sessões). */
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    /** Id público da sessão (UUID aleatório, nunca derivado do token). */
    id: text("id").notNull().default(sql`(gen_random_uuid()::text)`),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull().default(sql`(now() + interval '30 days')`),
  },
  (t) => [uniqueIndex("sessions_id_idx").on(t.id), index("sessions_user_idx").on(t.userId)],
);

export const invites = pgTable("invites", {
  code: text("code").primaryKey(),
  createdBy: text("created_by"),
  usedBy: text("used_by"),
  /** Servidor em que a conta nova já entra ao se cadastrar (null = começa sem servidor). */
  serverId: text("server_id").references((): AnyPgColumn => servers.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const servers = pgTable("servers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ownerId: text("owner_id").notNull().references(() => users.id),
  iconKey: text("icon_key"),
  /** Só dono e admins adicionam sons ao soundboard. */
  soundboardAdminsOnly: boolean("soundboard_admins_only").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const serverMembers = pgTable(
  "server_members",
  {
    serverId: text("server_id").notNull().references(() => servers.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "admin", "member"] }).notNull().default("member"),
    /** Apelido só neste servidor (null = usa o nome da conta). */
    nickname: text("nickname"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.serverId, t.userId] }), index("server_members_user_idx").on(t.userId)],
);

export const serverInvites = pgTable("server_invites", {
  code: text("code").primaryKey(),
  serverId: text("server_id").notNull().references(() => servers.id, { onDelete: "cascade" }),
  createdBy: text("created_by").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  maxUses: integer("max_uses"),
  uses: integer("uses").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const channels = pgTable(
  "channels",
  {
    id: text("id").primaryKey(),
    serverId: text("server_id").references(() => servers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["text", "voice", "dm"] }).notNull().default("text"),
    /** DM com 3 ou mais pessoas (o nome é opcional). */
    isGroup: boolean("is_group").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("channels_server_name_idx").on(t.serverId, t.name)],
);

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    /** Mensagem respondida (do mesmo canal). Sem chave estrangeira: se a original for apagada, a resposta mostra "mensagem apagada". */
    replyTo: text("reply_to"),
    /** Quando foi fixada no canal (nulo = não fixada). */
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
  },
  (t) => [
    index("messages_channel_created_idx").on(t.channelId, t.createdAt),
    index("messages_channel_cursor_idx").on(t.channelId, t.createdAt, sql`${t.id} COLLATE "C"`),
    index("messages_reply_to_idx").on(t.replyTo),
  ],
);

/** Idempotent sends survive deletion; keep only a fingerprint of text and reply target. */
export const messageReceipts = pgTable("message_receipts", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  requestId: text("request_id").notNull(),
  channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  bodyHash: text("body_hash").notNull(),
}, t => [primaryKey({ columns: [t.userId, t.requestId] })]);

/** Arquivos do chat. Sem `messageId` = enviado mas ainda não usado numa mensagem (some depois de 1 h). */
export const attachments = pgTable(
  "attachments",
  {
    id: text("id").primaryKey(),
    channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    messageId: text("message_id").references(() => messages.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    fileKey: text("file_key").notNull(),
    name: text("name").notNull(),
    size: integer("size").notNull(),
    mime: text("mime").notNull(),
    width: integer("width"),
    height: integer("height"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("attachments_message_idx").on(t.messageId), uniqueIndex("attachments_key_idx").on(t.fileKey), index("attachments_created_idx").on(t.createdAt)],
);

/** Até quando cada pessoa leu cada conversa (para as marcas de não lida). */
export const readStates = pgTable(
  "read_states",
  {
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.channelId] })],
);

export const friendships = pgTable(
  "friendships",
  {
    /** Sempre userA < userB (ordem de texto), para o par não duplicar. */
    userA: text("user_a").notNull().references(() => users.id, { onDelete: "cascade" }),
    userB: text("user_b").notNull().references(() => users.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["pending", "accepted"] }).notNull().default("pending"),
    requestedBy: text("requested_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userA, t.userB] }), index("friendships_b_idx").on(t.userB)],
);

export const dmMembers = pgTable(
  "dm_members",
  {
    channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.channelId, t.userId] }), index("dm_members_user_idx").on(t.userId)],
);

export const blocks = pgTable(
  "blocks",
  {
    blocker: text("blocker").notNull().references(() => users.id, { onDelete: "cascade" }),
    blocked: text("blocked").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.blocker, t.blocked] }), index("blocks_blocked_idx").on(t.blocked)],
);

export const serverBans = pgTable(
  "server_bans",
  {
    serverId: text("server_id").notNull().references(() => servers.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    bannedBy: text("banned_by").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.serverId, t.userId] })],
);

/** Reações com emoji nas mensagens (uma por pessoa e emoji). */
export const reactions = pgTable(
  "reactions",
  {
    messageId: text("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId, t.emoji] })],
);

/** Sons do soundboard de cada servidor (o arquivo WAV fica na pasta de uploads). */
export const soundboardSounds = pgTable(
  "soundboard_sounds",
  {
    id: text("id").primaryKey(),
    serverId: text("server_id").notNull().references(() => servers.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    icon: text("icon").notNull(),
    /** 0 a 1. */
    volume: real("volume").notNull().default(1),
    durationMs: integer("duration_ms").notNull(),
    size: integer("size").notNull(),
    fileKey: text("file_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("soundboard_sounds_server_idx").on(t.serverId), uniqueIndex("soundboard_sounds_key_idx").on(t.fileKey)],
);
