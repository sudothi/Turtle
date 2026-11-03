import type { Channel, Message, User } from "@turtle/protocol";

const KEY = "turtle.token";
export const getToken = () => localStorage.getItem(KEY);
export const setToken = (t: string | null) => (t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY));

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const token = getToken();
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
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
  channels: () => req<Channel[]>("GET", "/channels"),
  createChannel: (name: string) => req<Channel>("POST", "/channels", { name }),
  createInvite: () => req<{ code: string }>("POST", "/invites", {}),
  messages: (channelId: string) => req<Message[]>("GET", `/channels/${channelId}/messages`),
};
