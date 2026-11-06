import { lookup as dnsLookup } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, BlockList } from "node:net";

export interface LinkPreview {
  url: string;
  host: string;
  title: string | null;
  description: string | null;
}

const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 5000;

/** Faixas que nunca podem ser alcançadas a partir do servidor (rede interna, metadados de nuvem, etc.). */
const blocked = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["2001:db8::", 32], ["64:ff9b::", 96]] as const) blocked.addSubnet(net, bits, "ipv6");

/** Endereço público e roteável? IPv4 mapeado em IPv6 (::ffff:a.b.c.d) é conferido como IPv4. */
export function isPublicIp(ip: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return isPublicIp(mapped[1]!);
  const kind = isIP(ip);
  if (!kind) return false;
  return !blocked.check(ip, kind === 4 ? "ipv4" : "ipv6");
}

const decode = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Math.min(parseInt(n, 16), 0x10ffff)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim();

/** Título e descrição da página (Open Graph, Twitter ou <title>/<meta description>). */
export function parseMeta(html: string): { title: string | null; description: string | null } {
  const head = html.slice(0, MAX_BYTES);
  const metas = new Map<string, string>();
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const attr = (name: string) => {
      const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
      return m?.[1] ?? m?.[2] ?? m?.[3];
    };
    const key = (attr("property") ?? attr("name"))?.toLowerCase();
    const content = attr("content");
    if (key && content && !metas.has(key)) metas.set(key, content);
  }
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
  const title = metas.get("og:title") ?? metas.get("twitter:title") ?? titleTag ?? null;
  const description = metas.get("og:description") ?? metas.get("twitter:description") ?? metas.get("description") ?? null;
  const clean = (v: string | null, max: number) => {
    const t = v ? decode(v) : "";
    return t ? t.slice(0, max) : null;
  };
  return { title: clean(title, 120), description: clean(description, 220) };
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | { address: string; family: number }[], family?: number) => void;

/** `lookup` do socket: resolve e recusa endereço interno NA HORA da conexão (fecha a brecha do DNS rebinding). */
const safeLookup = (hostname: string, options: { all?: boolean; family?: number }, cb: LookupCb) => {
  dnsLookup(hostname, { all: true, family: options.family ?? 0 }, (err, addrs) => {
    if (err) return cb(err, "", 4);
    const ok = addrs.filter((a) => isPublicIp(a.address));
    if (!ok.length) return cb(Object.assign(new Error("endereço não permitido"), { code: "EBLOCKED" }), "", 4);
    if (options.all) return cb(null, ok);
    cb(null, ok[0]!.address, ok[0]!.family);
  });
};

/** Só http/https, sem usuário/senha, nas portas comuns. */
export function checkUrl(raw: string, anyPort = false): URL | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  if (u.port && !anyPort && !["80", "443", "8080", "8443"].includes(u.port)) return null;
  return u;
}

interface Opts { allowPrivate?: boolean }

function getOnce(u: URL, opts: Opts): Promise<{ status: number; location?: string; body: string }> {
  return new Promise((resolve, reject) => {
    // IP direto na URL não passa pelo lookup: confere aqui.
    const literal = u.hostname.replace(/^\[|\]$/g, "");
    if (!opts.allowPrivate && isIP(literal) && !isPublicIp(literal)) return reject(new Error("endereço não permitido"));
    const req = (u.protocol === "https:" ? httpsRequest : httpRequest)(
      u,
      {
        method: "GET",
        timeout: TIMEOUT_MS,
        headers: { "user-agent": "TurtleLinkPreview/1.0", accept: "text/html,application/xhtml+xml", "accept-language": "pt-BR,pt;q=0.9,en;q=0.5" },
        ...(opts.allowPrivate ? {} : { lookup: safeLookup as never }),
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ status, location: res.headers.location, body: "" });
        }
        if (status !== 200 || !/^(text\/html|application\/xhtml)/i.test(String(res.headers["content-type"] ?? ""))) {
          res.resume();
          return resolve({ status: 415, body: "" });
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          chunks.push(c);
          if (size >= MAX_BYTES) { res.destroy(); resolve({ status, body: Buffer.concat(chunks).toString("utf8") }); }
        });
        res.on("end", () => resolve({ status, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", () => resolve({ status, body: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("timeout", () => req.destroy(new Error("tempo esgotado")));
    req.on("error", reject);
    req.end();
  });
}

/** Busca a prévia de um link; null se não der (inválido, interno, sem HTML, lento demais). */
export async function fetchLinkPreview(raw: string, opts: Opts = {}): Promise<LinkPreview | null> {
  let u = checkUrl(raw, opts.allowPrivate);
  try {
    for (let hop = 0; u && hop <= MAX_REDIRECTS; hop++) {
      const res = await getOnce(u, opts);
      if (res.status >= 300 && res.status < 400) {
        u = res.location ? checkUrl(new URL(res.location, u).toString(), opts.allowPrivate) : null;
        continue;
      }
      if (res.status !== 200) return null;
      const meta = parseMeta(res.body);
      if (!meta.title && !meta.description) return null;
      return { url: u.toString(), host: u.hostname, ...meta };
    }
  } catch {
    return null;
  }
  return null;
}
