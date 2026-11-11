import { updateProfileBody, accountSchema, createServerBody, createChannelBody, renameServerBody, invitePreviewSchema, createGroupBody, personSchema, profileViewSchema, unreadSchema, channelSchema, dmSchema, friendSchema, loginBody, memberSchema, messageSchema, registerBody, sendTextBody, serverSchema, userSchema, voiceTokenSchema } from "@turtle/protocol";
import { z } from "zod";
import { editMessageBody } from "@turtle/protocol";

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

/** Only the public origin is configurable. Never put server or Apple secrets here. */
export function apiOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Use a origem HTTPS do servidor, sem caminho, usuário ou senha.");
  }
  return url.origin;
}

const authResponse = z.object({ token: z.string().min(1), user: userSchema });
export type Credentials = z.infer<typeof registerBody>;

export class Api {
  readonly origin: string;
  constructor(origin: string, private readonly token?: string, private readonly transport: typeof fetch = fetch) {
    this.origin = apiOrigin(origin);
  }

  gatewayUrl() {
    const url = new URL("/ws", this.origin);
    url.protocol = "wss:";
    return url.toString();
  }

  authenticateGateway(socket: Pick<WebSocket, "send">) {
    socket.send(JSON.stringify({ t: "auth", token: this.token ?? "" }));
  }

  private async request<Schema extends z.ZodTypeAny>(path: string, schema: Schema, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<z.output<Schema>> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 15_000);
    try {
      const response = await this.transport(`${this.origin}${path}`, {
        method,
        headers: {
          accept: "application/json",
          ...(body === undefined || body instanceof FormData ? {} : { "content-type": "application/json" }),
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        },
        body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
        signal: abort.signal,
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const parsed = z.object({ error: z.string() }).safeParse(data);
        throw new ApiError(response.status, parsed.success ? parsed.data.error : `O servidor respondeu com erro ${response.status}.`);
      }
      const parsed = schema.safeParse(data);
      if (!parsed.success) throw new Error("Resposta incompatível do servidor. Confira a versão do app.");
      return parsed.data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (abort.signal.aborted) throw new Error("O servidor demorou a responder. Tente novamente.");
      if (error instanceof TypeError) throw new Error("Não foi possível conectar. Confira sua conexão e o endereço do servidor.");
      throw error;
    } finally { clearTimeout(timer); }
  }

  login = (username: string, password: string) => this.request("/auth/login", authResponse, loginBody.parse({ username, password }));
  register = (credentials: Credentials) => this.request("/auth/register", authResponse, registerBody.parse(credentials));
  me = () => this.request("/me", userSchema);
  servers = () => this.request("/servers", z.array(serverSchema));
  createServer = (name: string) => this.request("/servers", serverSchema, createServerBody.parse({ name }));
  renameServer = (id: string, name: string) => this.request(`/servers/${encodeURIComponent(id)}`, z.object({ ok: z.literal(true) }), renameServerBody.parse({ name }), "PATCH");
  deleteServer = (id: string, name: string) => this.request(`/servers/${encodeURIComponent(id)}`, z.object({ ok: z.literal(true) }), { name }, "DELETE");
  transferServer = (id: string, userId: string) => this.request(`/servers/${encodeURIComponent(id)}/transfer`, z.object({ ok: z.literal(true) }), { userId });
  createChannel = (id: string, name: string, kind: "text" | "voice") => this.request(`/servers/${encodeURIComponent(id)}/channels`, channelSchema, createChannelBody.parse({ name, kind }));
  setRole = (id: string, userId: string, role: "admin" | "member") => this.request(`/servers/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, z.object({ ok: z.literal(true) }), { role }, "PATCH");
  removeMember = (id: string, userId: string) => this.request(`/servers/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, z.object({ ok: z.literal(true) }), undefined, "DELETE");
  createInvite = (id: string) => this.request(`/servers/${encodeURIComponent(id)}/invites`, z.object({ code: z.string(), expiresAt: z.string().nullable() }), { days: 7 });
  invitePreview = (code: string) => this.request(`/invites/${encodeURIComponent(code)}`, invitePreviewSchema);
  joinInvite = (code: string) => this.request(`/invites/${encodeURIComponent(code)}/join`, serverSchema, {});
  accounts = () => this.request("/admin/users", z.array(accountSchema));
  setAccount = (id: string, body: { canInvite?: boolean; disabled?: boolean }) => this.request(`/admin/users/${encodeURIComponent(id)}`, z.object({ ok: z.literal(true) }), body, "PATCH");
  createAccountInvite = () => this.request("/invites", z.object({ code: z.string() }), {});
  channels = (id: string) => this.request(`/servers/${encodeURIComponent(id)}/channels`, z.array(channelSchema));
  members = (id: string) => this.request(`/servers/${encodeURIComponent(id)}/members`, z.array(memberSchema));
  friends = () => this.request("/friends", z.array(friendSchema));
  dms = () => this.request("/dms", z.array(dmSchema));
  updateProfile = (body: z.input<typeof updateProfileBody>) => this.request("/me", userSchema, updateProfileBody.parse(body), "PATCH");
  uploadImage = async (kind: "avatar" | "banner", uri: string) => {
    const { File } = await import("expo-file-system");
    const form = new FormData();
    // Expo's fetch accepts File bytes; RN's proprietary { uri } part is unsupported.
    form.append("file", new File(uri));
    return this.request(`/me/${kind}`, userSchema, form, "PUT");
  };
  removeImage = (kind: "avatar" | "banner") => this.request(`/me/${kind}`, userSchema, undefined, "DELETE");
  profile = (id: string) => this.request(`/users/${encodeURIComponent(id)}`, profileViewSchema);
  addFriend = (id: string) => this.request(`/friends/${encodeURIComponent(id)}`, z.object({ status: z.enum(["friend", "outgoing"]) }), {});
  addFriendByName = (username: string) => this.request("/friends", z.object({ status: z.enum(["friend", "outgoing"]) }), { username: username.trim() });
  removeFriend = (id: string) => this.request(`/friends/${encodeURIComponent(id)}`, z.object({ ok: z.literal(true) }), undefined, "DELETE");
  openDm = (id: string) => this.request(`/dms/${encodeURIComponent(id)}`, dmSchema, {});
  createGroup = (userIds: string[], name?: string) => this.request("/dms", dmSchema, createGroupBody.parse({ userIds, name: name?.trim() || undefined }));
  addToGroup = (id: string, userId: string) => this.request(`/dms/${encodeURIComponent(id)}/members`, dmSchema, { userId });
  leaveGroup = (id: string) => this.request(`/dms/${encodeURIComponent(id)}/members/me`, z.object({ ok: z.literal(true) }), undefined, "DELETE");
  blocks = () => this.request("/blocks", z.array(personSchema));
  block = (id: string) => this.request(`/blocks/${encodeURIComponent(id)}`, z.object({ ok: z.literal(true) }), {});
  unblock = (id: string) => this.request(`/blocks/${encodeURIComponent(id)}`, z.object({ ok: z.literal(true) }), undefined, "DELETE");
  unread = () => this.request("/unread", z.array(unreadSchema));
  markRead = (id: string) => this.request(`/channels/${encodeURIComponent(id)}/read`, z.object({ ok: z.literal(true) }), {});
  messages = (id: string, page: { before?: string; beforeId?: string; limit?: number } = {}) => {
    const query = new URLSearchParams({ limit: String(page.limit ?? 50) });
    if (page.before) query.set("before", page.before);
    if (page.beforeId) query.set("beforeId", page.beforeId);
    return this.request(`/channels/${encodeURIComponent(id)}/messages?${query}`, z.array(messageSchema));
  };
  sendText = (id: string, body: z.input<typeof sendTextBody>) => this.request(`/channels/${encodeURIComponent(id)}/messages`, messageSchema, sendTextBody.parse(body));
  editMessage = (id: string, content: string) => this.request(`/messages/${encodeURIComponent(id)}`, messageSchema, editMessageBody.parse({ content }), "PATCH");
  deleteMessage = (id: string) => this.request(`/messages/${encodeURIComponent(id)}`, z.object({ ok: z.literal(true) }), undefined, "DELETE");
  setReaction = (id: string, emoji: string, add: boolean) => this.request(`/messages/${encodeURIComponent(id)}/reactions/${encodeURIComponent(emoji)}`, messageSchema, undefined, add ? "PUT" : "DELETE");
  fileUrl = (key: string | null | undefined) => key ? `${this.origin}/files/${encodeURIComponent(key)}` : undefined;
  voiceToken = (id: string) => this.request(`/voice/${encodeURIComponent(id)}/token`, voiceTokenSchema, {});
}
