import type { Channel, ChannelKind, InvitePreview, Member, Message, Server, User, VoiceToken } from "@turtle/protocol";

const KEY = "turtle.token";
export const getToken = () => localStorage.getItem(KEY);
export const setToken = (t: string | null) => (t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY));

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const token = getToken();
  const res = await fetch(url, {
    method,
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `erro ${res.status}`);
  return data as T;
}

export const api = {
  login: (username: string, password: string) => req<{ token: string; user: User }>("POST", "/auth/login", { username, password }),
  register: (inviteCode: string, username: string, password: string) =>
    req<{ token: string; user: User }>("POST", "/auth/register", { inviteCode, username, password }),
  me: () => req<User>("GET", "/me"),
  servers: () => req<Server[]>("GET", "/servers"),
  createServer: (name: string) => req<Server>("POST", "/servers", { name }),
  renameServer: (id: string, name: string) => req<{ ok: true }>("PATCH", `/servers/${id}`, { name }),
  deleteServer: (id: string, name: string) => req<{ ok: true }>("DELETE", `/servers/${id}`, { name }),
  transferServer: (id: string, userId: string) => req<{ ok: true }>("POST", `/servers/${id}/transfer`, { userId }),
  channels: (serverId: string) => req<Channel[]>("GET", `/servers/${serverId}/channels`),
  createChannel: (serverId: string, name: string, kind: ChannelKind = "text") => req<Channel>("POST", `/servers/${serverId}/channels`, { name, kind }),
  members: (serverId: string) => req<Member[]>("GET", `/servers/${serverId}/members`),
  setRole: (serverId: string, userId: string, role: "admin" | "member") => req<{ ok: true }>("PATCH", `/servers/${serverId}/members/${userId}`, { role }),
  removeMember: (serverId: string, userId: string) => req<{ ok: true }>("DELETE", `/servers/${serverId}/members/${userId}`),
  createInvite: (serverId: string, days = 7) => req<{ code: string; expiresAt: string | null }>("POST", `/servers/${serverId}/invites`, { days }),
  invitePreview: (code: string) => req<InvitePreview>("GET", `/invites/${encodeURIComponent(code)}`),
  joinInvite: (code: string) => req<Server>("POST", `/invites/${encodeURIComponent(code)}/join`, {}),
  voiceToken: (channelId: string) => req<VoiceToken>("POST", `/voice/${channelId}/token`, {}),
  messages: (channelId: string) => req<Message[]>("GET", `/channels/${channelId}/messages`),
};
