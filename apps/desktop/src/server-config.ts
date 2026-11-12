import { app } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Servidor padrão do instalador oficial; quem hospeda por conta própria troca pelo link de convite. */
export const DEFAULT_SERVER = "https://turtlechat.tech";

export interface ServerLink {
  server?: string;
  code?: string;
}

/** Aceita "app.exemplo.com" ou "https://app.exemplo.com/"; só HTTPS (http só em localhost). */
export function normalizeServer(text: string): string | undefined {
  let t = text.trim().replace(/\/+$/, "");
  if (!t) return undefined;
  if (!t.includes("://")) t = `https://${t}`;
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return undefined;
  }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return undefined;
  if (!local && !u.hostname.includes(".")) return undefined;
  return u.origin;
}

/** Lê `turtle://convite?server=https://app.exemplo.com&code=abc`. */
export function parseLink(link: string): ServerLink | undefined {
  let u: URL;
  try {
    u = new URL(link);
  } catch {
    return undefined;
  }
  if (u.protocol !== "turtle:" || u.hostname !== "convite") return undefined;
  const server = normalizeServer(u.searchParams.get("server") ?? "");
  const code = u.searchParams.get("code")?.trim() || undefined;
  return server || code ? { server, code } : undefined;
}

const file = () => join(app.getPath("userData"), "server.json");

/** Servidor guardado pela pessoa (link de convite); sem nada guardado, o padrão. */
export function savedServer(): string {
  try {
    const s = (JSON.parse(readFileSync(file(), "utf8")) as { server?: unknown }).server;
    return (typeof s === "string" && normalizeServer(s)) || DEFAULT_SERVER;
  } catch {
    return DEFAULT_SERVER;
  }
}

export function saveServer(server: string) {
  writeFileSync(file(), JSON.stringify({ server }), "utf8");
}
