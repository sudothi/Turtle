import type { Attachment, SessionInfo, Unread, UserStatus } from "@turtle/protocol";
import type { Account, Channel, ChannelKind, Dm, Friend, Person, ProfileView, InvitePreview, Member, Message, Server, User, VoiceToken } from "@turtle/protocol";

const KEY = "turtle.token";
export const getToken = () => localStorage.getItem(KEY);
export const setToken = (t: string | null) => (t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY));

let onUnauthorized: (() => void) | undefined;
/** Chamado quando o servidor recusa o token (sessão expirada, encerrada ou conta desativada). */
export const setOnUnauthorized = (fn: (() => void) | undefined) => {
  onUnauthorized = fn;
};

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const token = getToken();
  const res = await fetch(url, {
    method,
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token && url !== "/auth/login" && url !== "/me/password") onUnauthorized?.();
    throw new Error((data as { error?: string }).error ?? `erro ${res.status}`);
  }
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

/** Envia um anexo com progresso (fetch não informa o progresso do envio). */
function uploadAttachment(channelId: string, file: File, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/channels/${channelId}/attachments`);
    const token = getToken();
    if (token) xhr.setRequestHeader("authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data: { error?: string } = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        // resposta sem corpo
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as Attachment);
      else reject(new Error(data.error ?? `erro ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("falha de rede"));
    xhr.onabort = () => reject(new Error("cancelado"));
    signal?.addEventListener("abort", () => xhr.abort());
    const form = new FormData();
    form.append("file", file, file.name);
    xhr.send(form);
  });
}

async function uploadIcon(serverId: string, file: Blob): Promise<{ icon: string }> {
  const form = new FormData();
  form.append("file", file, "icon.png");
  const token = getToken();
  const res = await fetch(`/servers/${serverId}/icon`, { method: "PUT", headers: token ? { authorization: `Bearer ${token}` } : {}, body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `erro ${res.status}`);
  return data as { icon: string };
}

export const api = {
  setStatus: (status: UserStatus) => req<User>("PATCH", "/me", { status }),
  unread: () => req<Unread[]>("GET", "/unread"),
  markRead: (channelId: string) => req<{ ok: true }>("POST", `/channels/${channelId}/read`, {}),
  react: (id: string, emoji: string, add: boolean) => req<Message>(add ? "PUT" : "DELETE", `/messages/${id}/reactions/${encodeURIComponent(emoji)}`),
  searchChannel: (channelId: string, q: string) => req<Message[]>("GET", `/channels/${channelId}/search?q=${encodeURIComponent(q)}`),
  storage: () => req<{ used: number; quota: number }>("GET", "/me/storage"),
  editMessage: (id: string, content: string) => req<Message>("PATCH", `/messages/${id}`, { content }),
  deleteMessage: (id: string) => req<{ ok: true }>("DELETE", `/messages/${id}`),
  uploadAttachment,
  renameChannel: (id: string, name: string) => req<Channel>("PATCH", `/channels/${id}`, { name }),
  deleteChannel: (id: string) => req<{ ok: true }>("DELETE", `/channels/${id}`),
  uploadServerIcon: uploadIcon,
  removeServerIcon: (serverId: string) => req<{ icon: null }>("DELETE", `/servers/${serverId}/icon`),
  updateProfile: (p: { displayName?: string | null; bio?: string | null }) => req<User>("PATCH", "/me", p),
  uploadImage: upload,
  removeImage: (kind: "avatar" | "banner") => req<User>("DELETE", `/me/${kind}`),
  profile: (id: string) => req<ProfileView>("GET", `/users/${id}`),
  login: (username: string, password: string) => req<{ token: string; user: User }>("POST", "/auth/login", { username, password }),
  register: (inviteCode: string, username: string, password: string) =>
    req<{ token: string; user: User }>("POST", "/auth/register", { inviteCode, username, password }),
  logout: () => req<{ ok: true }>("POST", "/auth/logout", {}),
  sessions: () => req<SessionInfo[]>("GET", "/me/sessions"),
  revokeSession: (id: string) => req<{ ok: true }>("DELETE", `/me/sessions/${encodeURIComponent(id)}`),
  revokeAllSessions: () => req<{ ok: true }>("DELETE", "/me/sessions"),
  changePassword: (currentPassword: string, newPassword: string) =>
    req<{ ok: true }>("POST", "/me/password", { currentPassword, newPassword }),
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
  bans: (serverId: string) => req<{ userId: string; username: string; displayName: string | null; reason: string | null; createdAt: string }[]>("GET", `/servers/${serverId}/bans`),
  banMember: (serverId: string, userId: string) => req<{ ok: true }>("POST", `/servers/${serverId}/bans/${userId}`, {}),
  unban: (serverId: string, userId: string) => req<{ ok: true }>("DELETE", `/servers/${serverId}/bans/${userId}`),
  accounts: () => req<Account[]>("GET", "/admin/users"),
  setInviter: (userId: string, canInvite: boolean) => req<{ ok: true }>("PATCH", `/admin/users/${userId}`, { canInvite }),
  setAccountDisabled: (userId: string, disabled: boolean) => req<{ ok: true }>("PATCH", `/admin/users/${userId}`, { disabled }),
  createAccountInvite: () => req<{ code: string }>("POST", "/invites", {}),
  createInvite: (serverId: string, days = 7) => req<{ code: string; expiresAt: string | null }>("POST", `/servers/${serverId}/invites`, { days }),
  invitePreview: (code: string) => req<InvitePreview>("GET", `/invites/${encodeURIComponent(code)}`),
  joinInvite: (code: string) => req<Server>("POST", `/invites/${encodeURIComponent(code)}/join`, {}),
  voiceToken: (channelId: string) => req<VoiceToken>("POST", `/voice/${channelId}/token`, {}),
  friends: () => req<Friend[]>("GET", "/friends"),
  addFriend: (userId: string) => req<{ status: "friend" | "outgoing" }>("POST", `/friends/${userId}`),
  addFriendByName: (username: string) => req<{ status: "friend" | "outgoing" }>("POST", "/friends", { username }),
  removeFriend: (userId: string) => req<{ ok: true }>("DELETE", `/friends/${userId}`),
  dms: () => req<Dm[]>("GET", "/dms"),
  openDm: (userId: string) => req<Dm>("POST", `/dms/${userId}`),
  createGroup: (userIds: string[], name?: string) => req<Dm>("POST", "/dms", { userIds, name: name || undefined }),
  addToGroup: (channelId: string, userId: string) => req<Dm>("POST", `/dms/${channelId}/members`, { userId }),
  leaveGroup: (channelId: string) => req<{ ok: true }>("DELETE", `/dms/${channelId}/members/me`),
  blocks: () => req<Person[]>("GET", "/blocks"),
  block: (userId: string) => req<{ ok: true }>("POST", `/blocks/${userId}`),
  unblock: (userId: string) => req<{ ok: true }>("DELETE", `/blocks/${userId}`),
  messages: (channelId: string, before?: string) =>
    req<Message[]>("GET", `/channels/${channelId}/messages${before ? `?before=${encodeURIComponent(before)}` : ""}`),
};
