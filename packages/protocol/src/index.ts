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

export const channelSchema = z.object({ id: z.string(), name: z.string() });
export type Channel = z.infer<typeof channelSchema>;

export const userSchema = z.object({ id: z.string(), username: z.string(), isAdmin: z.boolean() });
export type User = z.infer<typeof userSchema>;

export const usernameSchema = z.string().trim().min(2).max(32).regex(/^[\p{L}\p{N}_.-]+$/u);
export const passwordSchema = z.string().min(8).max(200);

export const registerBody = z.object({ inviteCode: z.string().min(1), username: usernameSchema, password: passwordSchema });
export const loginBody = z.object({ username: z.string(), password: z.string() });
export const createChannelBody = z.object({ name: z.string().trim().min(1).max(40) });

/** Eventos do gateway WebSocket (cliente <-> servidor). */
export const clientEvent = z.discriminatedUnion("t", [
  z.object({ t: z.literal("ping") }),
  z.object({ t: z.literal("send"), channelId: z.string(), content: z.string().trim().min(1).max(4000) }),
]);
export const serverEvent = z.discriminatedUnion("t", [
  z.object({ t: z.literal("pong") }),
  z.object({ t: z.literal("message"), message: messageSchema }),
  z.object({ t: z.literal("channel"), channel: channelSchema }),
  z.object({ t: z.literal("presence"), online: z.array(z.string()) }),
  z.object({ t: z.literal("error"), error: z.string() }),
]);

export type ClientEvent = z.infer<typeof clientEvent>;
export type ServerEvent = z.infer<typeof serverEvent>;
