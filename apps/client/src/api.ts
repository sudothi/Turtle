import type { Account, Channel, ChannelKind, InvitePreview, Member, Message, Server, User, VoiceToken } from "@turtle/protocol";

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

/** URL de uma foto/banner a partir da chave guardada no perfil. */
export const fileUrl = (key: string | null | undefined) => (key ? `/files/${key}` : null);

/** Perfil público de alguém (cartão de perfil). */
export type Profile = Pick<User, "id" | "username" | "displayName" | "bio" | "avatar" | "banner"> & { staff?: boolean };

async function upload(kind: "avatar" | "banner", file: File): Promise<User> {
  const form = new FormData();
  form.append("file", file);
  const token = getToken();
  const res = await fetch(`/me/${kind}`, { method: "PUT", headers: token ? { authorization: `Bearer ${token}` } : {}, body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `erro ${res.status}`);
  return data as User;
}

export const api = {
  updateProfile: (p: { displayName?: string | null; bio?: string | null }) => req<User>("PATCH", "/me", p),
  uploadImage: upload,
  removeImage: (kind: "avatar" | "banner") => req<User>("DELETE", `/me/${kind}`),
  profile: (id: string) => req<Profile>("GET", `/users/${id}`),
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
  accounts: () => req<Account[]>("GET", "/admin/users"),
  setInviter: (userId: string, canInvite: boolean) => req<{ ok: true }>("PATCH", `/admin/users/${userId}`, { canInvite }),
  createAccountInvite: () => req<{ code: string }>("POST", "/invites", {}),
  createInvite: (serverId: string, days = 7) => req<{ code: string; expiresAt: string | null }>("POST", `/servers/${serverId}/invites`, { days }),
  invitePreview: (code: string) => req<InvitePreview>("GET", `/invites/${encodeURIComponent(code)}`),
  joinInvite: (code: string) => req<Server>("POST", `/invites/${encodeURIComponent(code)}/join`, {}),
  voiceToken: (channelId: string) => req<VoiceToken>("POST", `/voice/${channelId}/token`, {}),
  messages: (channelId: string) => req<Message[]>("GET", `/channels/${channelId}/messages`),
};
