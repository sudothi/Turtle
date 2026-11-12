// Validação do que vai para a VPS e configuração guardada no computador (sem segredos).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const REPO = "https://github.com/sudothi/turtle.git";
export const REPO_API = "https://api.github.com/repos/sudothi/turtle";

const HOST = /^(?=.{4,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const USER = /^[a-z_][a-z0-9_-]{0,31}$/;

export function validIp(/** @type {string} */ s) {
  const m = IPV4.exec(s);
  return !!m && m.slice(1).every((n) => Number(n) <= 255);
}
export const validHost = (/** @type {string} */ s) => HOST.test(s) && !validIp(s);
export const validUser = (/** @type {string} */ s) => USER.test(s);
export const validPort = (/** @type {string|number} */ s) => /^\d{1,5}$/.test(String(s)) && Number(s) >= 1 && Number(s) <= 65535;

/**
 * @typedef {{ ip: string, user: string, port: string, app: string, lk: string, key: string, firewall: boolean, dir: string }} Config
 */

/** Normaliza as opções e devolve { cfg } ou { error }. Tudo que entra num comando remoto passa por aqui. */
export function buildConfig(/** @type {Record<string, any>} */ o) {
  const domain = String(o.domain ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const ip = String(o.ip ?? "").trim();
  const user = String(o.user ?? "").trim();
  const port = String(o.port ?? 22).trim();
  const app = String(o.app ?? (domain ? `app.${domain}` : "")).trim().toLowerCase();
  const lk = String(o.lk ?? (domain ? `lk.${domain}` : "")).trim().toLowerCase();
  const key = String(o.key ?? "").trim();
  if (!validIp(ip)) return { error: "IP da VPS inválido (ex.: 203.0.113.10)." };
  if (!validHost(app) || !validHost(lk)) return { error: "Domínio inválido (ex.: seudominio.com)." };
  if (app === lk) return { error: "Os domínios do app e da voz precisam ser diferentes." };
  if (!validUser(user)) return { error: "Usuário SSH inválido (letras minúsculas, números, - e _)." };
  if (!validPort(port)) return { error: "Porta SSH inválida." };
  if (/[\0\n\r]/.test(key)) return { error: "Caminho da chave inválido." };
  /** @type {Config} */
  const cfg = { ip, user, port, app, lk, key, firewall: o.firewall !== false, dir: "turtle" };
  return { cfg };
}

function configPath() {
  const base = process.platform === "win32" ? process.env.APPDATA || join(homedir(), "AppData", "Roaming") : process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "turtle-setup", "config.json");
}

/** Última VPS usada (ip, usuário, domínios). Nunca guarda senha, chave ou .env. */
export function loadSaved() {
  try {
    return /** @type {Partial<Config>} */ (JSON.parse(readFileSync(configPath(), "utf8")));
  } catch {
    return {};
  }
}

export function save(/** @type {Config} */ cfg) {
  const p = configPath();
  const dir = join(p, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const { ip, user, port, app, lk, key, dir: d } = cfg;
  writeFileSync(p, JSON.stringify({ ip, user, port, app, lk, key, dir: d }, null, 2) + "\n");
  return p;
}
