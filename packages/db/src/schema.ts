import { boolean, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const invites = pgTable("invites", {
  code: text("code").primaryKey(),
  createdBy: text("created_by"),
  usedBy: text("used_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const servers = pgTable("servers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ownerId: text("owner_id").notNull().references(() => users.id),
  iconKey: text("icon_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const serverMembers = pgTable(
  "server_members",
  {
    serverId: text("server_id").notNull().references(() => servers.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "admin", "member"] }).notNull().default("member"),
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
  },
  (t) => [index("messages_channel_created_idx").on(t.channelId, t.createdAt)],
);

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
  (t) => [index("attachments_message_idx").on(t.messageId), uniqueIndex("attachments_key_idx").on(t.fileKey)],
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
