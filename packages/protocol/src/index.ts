import { z } from "zod";

export const messageSchema = z.object({
  id: z.string(),
  channelId: z.string(),
  userId: z.string(),
  username: z.string(),
  content: z.string(),
  createdAt: z.string(),
});
export type Message = z.infer<typeof messageSchema>;

export const channelKind = z.enum(["text", "voice"]);
export type ChannelKind = z.infer<typeof channelKind>;
export const channelSchema = z.object({ id: z.string(), name: z.string(), kind: channelKind });
export type Channel = z.infer<typeof channelSchema>;

export const userSchema = z.object({ id: z.string(), username: z.string(), isAdmin: z.boolean() });
export type User = z.infer<typeof userSchema>;

export const usernameSchema = z.string().trim().min(2).max(32).regex(/^[\p{L}\p{N}_.-]+$/u);
export const passwordSchema = z.string().min(8).max(200);

export const registerBody = z.object({ inviteCode: z.string().min(1), username: usernameSchema, password: passwordSchema });
export const loginBody = z.object({ username: z.string(), password: z.string() });
export const createChannelBody = z.object({ name: z.string().trim().min(1).max(40), kind: channelKind.default("text") });

/** Quem está em qual canal de voz (para a barra lateral, mesmo fora da chamada). */
export const voiceStateSchema = z.object({
  userId: z.string(),
  username: z.string(),
  channelId: z.string(),
  muted: z.boolean(),
  deafened: z.boolean(),
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
  z.object({ t: z.literal("voice"), channelId: z.string().nullable(), muted: z.boolean(), deafened: z.boolean() }),
]);
export const serverEvent = z.discriminatedUnion("t", [
  z.object({ t: z.literal("pong") }),
  z.object({ t: z.literal("message"), message: messageSchema }),
  z.object({ t: z.literal("channel"), channel: channelSchema }),
  z.object({ t: z.literal("presence"), online: z.array(z.string()) }),
  z.object({ t: z.literal("voiceStates"), states: z.array(voiceStateSchema) }),
  z.object({ t: z.literal("error"), error: z.string() }),
]);

export type ClientEvent = z.infer<typeof clientEvent>;
export type ServerEvent = z.infer<typeof serverEvent>;
