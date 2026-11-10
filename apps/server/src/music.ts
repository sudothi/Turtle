import type { MusicTrack } from "@turtle/protocol";
import sharp from "sharp";
import { decode, metaTags } from "./linkpreview.js";

/**
 * Cartão de música: o link do Spotify vira título, artista e capa (página pública, sem login),
 * e a prévia de 30 s vem do Deezer (a API do Spotify não entrega mais `preview_url` para apps novos).
 * Só fala com hosts fixos do Spotify e do Deezer; o cliente nunca toca neles.
 */

/** Busca HTTP usada aqui (trocada nos testes). */
export type Fetcher = (url: string, init?: { redirect?: "follow" | "manual"; accept?: string }) => Promise<Response>;

const TIMEOUT_MS = 6000;
const PAGE_MAX = 1024 * 1024;
const IMAGE_MAX = 4 * 1024 * 1024;
const AUDIO_MAX = 3 * 1024 * 1024;

/** Hosts que o módulo pode alcançar (inclusive depois de redirecionar). */
export function allowedHost(host: string): boolean {
  host = host.toLowerCase();
  return (
    host === "open.spotify.com" || host === "spotify.link" || host.endsWith(".scdn.co") || host.endsWith(".spotifycdn.com") ||
    host === "api.deezer.com" || host.endsWith(".dzcdn.net")
  );
}

const defaultFetch: Fetcher = (url, init = {}) =>
  fetch(url, {
    redirect: init.redirect ?? "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "user-agent": "Mozilla/5.0 (compatible; TurtleLinkPreview/1.0)", "accept-language": "pt-BR,pt;q=0.9,en;q=0.5", ...(init.accept ? { accept: init.accept } : {}) },
  });

const SPOTIFY_TRACK = /^https?:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}(?:-[a-z]{2})?\/)?(?:embed\/)?track\/([A-Za-z0-9]{22})(?:[/?#]|$)/i;
const SPOTIFY_SHORT = /^https?:\/\/spotify\.link\/[A-Za-z0-9]{4,40}$/i;

/** Id da faixa num link `open.spotify.com/track/...` (com ou sem `intl-xx` e `?si=`). */
export function spotifyTrackId(raw: string): string | null {
  return SPOTIFY_TRACK.exec(raw.trim())?.[1] ?? null;
}

/** Link que pode ser uma faixa do Spotify (direto ou encurtado). */
export const isSpotifyLink = (raw: string) => !!spotifyTrackId(raw) || SPOTIFY_SHORT.test(raw.trim());

async function readCapped(res: Response, max: number): Promise<Buffer | null> {
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > max || !res.body) return null;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of res.body as unknown as AsyncIterable<Uint8Array>) {
    size += c.length;
    if (size > max) return null;
    chunks.push(Buffer.from(c));
  }
  return Buffer.concat(chunks);
}

async function get(fetcher: Fetcher, url: string, max: number, accept?: string): Promise<{ body: Buffer; type: string } | null> {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== "https:" || !allowedHost(u.hostname)) return null;
  try {
    const res = await fetcher(u.toString(), { accept });
    // Depois de seguir redirecionamentos, a resposta tem de continuar num host permitido.
    if (!res.ok || (res.url && !allowedHost(new URL(res.url).hostname))) return null;
    const body = await readCapped(res, max);
    return body ? { body, type: res.headers.get("content-type") ?? "" } : null;
  } catch {
    return null;
  }
}

/** Abre um `spotify.link/...` só até descobrir para qual faixa ele aponta. */
async function expandShortLink(fetcher: Fetcher, raw: string): Promise<string | null> {
  try {
    const res = await fetcher(raw.trim(), { redirect: "manual" });
    const loc = res.headers.get("location");
    return loc ? spotifyTrackId(new URL(loc, raw).toString()) : null;
  } catch {
    return null;
  }
}

export interface SpotifyMeta { title: string; artist: string | null; album: string | null; durationMs: number | null; image: string | null }

/**
 * Lê a página pública da faixa. O Spotify põe:
 * og:title = música, og:description = "Artista · Álbum · Song · 2020", music:musician_description = artista, music:duration = segundos.
 */
export function parseSpotifyPage(html: string): SpotifyMeta | null {
  const m = metaTags(html);
  const val = (k: string) => { const v = m.get(k); return v ? decode(v) || null : null; };
  const title = val("og:title") ?? val("twitter:title");
  if (!title) return null;
  const parts = (val("og:description") ?? "").split(" · ").map((s) => s.trim()).filter(Boolean);
  const artist = val("music:musician_description") ?? (parts.length >= 2 ? parts[0]! : null);
  const album = parts.length >= 3 ? parts[1]! : null;
  const secs = Number(val("music:duration"));
  return {
    title: title.slice(0, 200),
    artist: artist?.slice(0, 200) ?? null,
    album: album?.slice(0, 200) ?? null,
    durationMs: Number.isFinite(secs) && secs > 0 ? Math.round(secs * 1000) : null,
    image: val("og:image") ?? val("twitter:image"),
  };
}

/** Normaliza para comparar nomes: sem acento, sem "(feat. ...)", "- Remastered" e pontuação. */
export function normalizeName(s: string): string {
  return s
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s*[([].*?[)\]]/g, " ")
    .replace(/\s+-\s+.*$/, " ")
    .replace(/&/g, " e ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

interface DeezerHit { id: number; title: string; duration?: number; preview?: string; artist?: { name?: string } }

/** Escolhe no resultado do Deezer a mesma faixa: título igual, mesmo artista ou duração parecida (±4 s). */
export function pickDeezer(hits: DeezerHit[], want: SpotifyMeta): DeezerHit | null {
  const t = normalizeName(want.title);
  const a = want.artist ? normalizeName(want.artist) : "";
  const secs = want.durationMs ? want.durationMs / 1000 : null;
  let best: { hit: DeezerHit; score: number } | null = null;
  for (const hit of hits) {
    if (!hit.preview || normalizeName(hit.title) !== t) continue;
    const ha = normalizeName(hit.artist?.name ?? "");
    const sameArtist = !!a && !!ha && (ha === a || ha.includes(a) || a.includes(ha));
    const closeTime = secs !== null && hit.duration !== undefined && Math.abs(hit.duration - secs) <= 4;
    if (!sameArtist && !closeTime) continue;
    const score = (sameArtist ? 2 : 0) + (closeTime ? 1 : 0);
    if (!best || score > best.score) best = { hit, score };
  }
  return best?.hit ?? null;
}

async function findOnDeezer(fetcher: Fetcher, meta: SpotifyMeta): Promise<number | null> {
  const clean = (s: string) => s.replace(/"/g, "");
  const queries = meta.artist ? [`artist:"${clean(meta.artist)}" track:"${clean(meta.title)}"`, `${meta.artist} ${meta.title}`] : [meta.title];
  for (const q of queries) {
    const res = await get(fetcher, `https://api.deezer.com/search?limit=10&q=${encodeURIComponent(q)}`, PAGE_MAX, "application/json");
    if (!res) continue;
    let hits: DeezerHit[] = [];
    try { hits = (JSON.parse(res.body.toString("utf8")) as { data?: DeezerHit[] }).data ?? []; } catch { continue; }
    const hit = pickDeezer(hits, meta);
    if (hit) return hit.id;
  }
  return null;
}

interface Entry { at: number; track: MusicTrack | null; image: string | null; deezerId: number | null }

/** LRU simples em memória (Map mantém a ordem de inserção). */
class Lru<V> {
  private map = new Map<string, V>();
  constructor(private max: number) {}
  get(k: string) {
    const v = this.map.get(k);
    if (v !== undefined) { this.map.delete(k); this.map.set(k, v); }
    return v;
  }
  set(k: string, v: V) {
    this.map.delete(k);
    this.map.set(k, v);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value!);
  }
}

const DAY = 24 * 3_600_000;

/** Resolve links do Spotify e serve capa e prévia, com cache em memória. */
export function musicService(fetcher: Fetcher = defaultFetch) {
  const tracks = new Lru<Entry>(500);
  const covers = new Lru<Promise<Buffer | null>>(150);
  const previews = new Lru<{ at: number; job: Promise<Buffer | null> }>(40);
  const pending = new Map<string, Promise<Entry>>();

  async function load(id: string): Promise<Entry> {
    const page = await get(fetcher, `https://open.spotify.com/track/${id}`, PAGE_MAX, "text/html");
    const meta = page && /html/i.test(page.type) ? parseSpotifyPage(page.body.toString("utf8")) : null;
    if (!meta) return { at: Date.now(), track: null, image: null, deezerId: null };
    const deezerId = await findOnDeezer(fetcher, meta);
    return {
      at: Date.now(),
      image: meta.image,
      deezerId,
      track: {
        id, url: `https://open.spotify.com/track/${id}`,
        title: meta.title, artist: meta.artist, album: meta.album, durationMs: meta.durationMs,
        hasCover: !!meta.image, previewSource: deezerId ? "deezer" : null,
      },
    };
  }

  async function entry(id: string): Promise<Entry> {
    const hit = tracks.get(id);
    // Faixa achada vale um dia; falha é tentada de novo depois de 10 min.
    if (hit && Date.now() - hit.at < (hit.track ? DAY : 600_000)) return hit;
    let job = pending.get(id);
    if (!job) {
      job = load(id).finally(() => pending.delete(id));
      pending.set(id, job);
    }
    const e = await job;
    tracks.set(id, e);
    return e;
  }

  return {
    /** Dados da faixa de um link do Spotify; null se o link não for de faixa ou a página não responder. */
    async resolve(raw: string): Promise<MusicTrack | null> {
      const id = spotifyTrackId(raw) ?? (SPOTIFY_SHORT.test(raw.trim()) ? await expandShortLink(fetcher, raw) : null);
      return id ? (await entry(id)).track : null;
    },
    /** Capa em WebP 320x320 (só de faixa já resolvida). */
    async cover(id: string): Promise<Buffer | null> {
      const e = tracks.get(id);
      if (!e?.image) return null;
      let job = covers.get(id);
      if (!job) {
        job = get(fetcher, e.image, IMAGE_MAX, "image/*")
          .then((r) => (r ? sharp(r.body, { limitInputPixels: 4096 * 4096 }).resize(320, 320, { fit: "cover" }).webp({ quality: 80 }).toBuffer() : null))
          .catch(() => null);
        covers.set(id, job);
      }
      const out = await job;
      if (!out) covers.set(id, Promise.resolve(null));
      return out;
    },
    /** Prévia de 30 s em MP3 (só de faixa já resolvida). O link do Deezer expira, então pede um novo a cada busca. */
    async preview(id: string): Promise<Buffer | null> {
      const e = tracks.get(id);
      if (!e?.deezerId) return null;
      const hit = previews.get(id);
      if (hit && Date.now() - hit.at < DAY) return hit.job;
      const job = (async () => {
        const info = await get(fetcher, `https://api.deezer.com/track/${e.deezerId}`, PAGE_MAX, "application/json");
        let url: string | undefined;
        try { url = info ? (JSON.parse(info.body.toString("utf8")) as { preview?: string }).preview : undefined; } catch { /* resposta inválida */ }
        if (!url) return null;
        const audio = await get(fetcher, url, AUDIO_MAX, "audio/mpeg");
        // MP3 começa com "ID3" ou com o sincronismo de quadro (0xFFEx).
        const b = audio?.body;
        if (!b || b.length < 4 || !(b.subarray(0, 3).toString("latin1") === "ID3" || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0))) return null;
        return b;
      })().catch(() => null);
      previews.set(id, { at: Date.now(), job });
      const out = await job;
      if (!out) previews.set(id, { at: 0, job: Promise.resolve(null) });
      return out;
    },
  };
}
