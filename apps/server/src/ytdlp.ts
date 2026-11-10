import { execFile } from "node:child_process";
import { setPriority } from "node:os";
import { JUKEBOX_MAX_MS } from "@turtle/protocol";

/**
 * yt-dlp para a discoteca: só links de faixa do YouTube, SoundCloud e Bandcamp (nada de playlist, ao vivo
 * ou site qualquer). Baixa o áudio como ele vem (opus/m4a/mp3), sem converter: quase não gasta CPU.
 */

export type LinkSource = "youtube" | "soundcloud" | "bandcamp";

/** Link aceito e já normalizado (sem playlist, sem rastreio). null = não é um link de faixa suportado. */
export function mediaLink(raw: string): { source: LinkSource; url: string; key: string } | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password || (u.port && u.port !== "443" && u.port !== "80")) return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, "");
  const yt = (id: string | null | undefined) =>
    id && /^[A-Za-z0-9_-]{11}$/.test(id) ? { source: "youtube" as const, url: `https://www.youtube.com/watch?v=${id}`, key: `yt-${id}` } : null;
  if (host === "youtu.be") return yt(u.pathname.split("/")[1]);
  if (host === "youtube.com" || host === "music.youtube.com") {
    if (u.pathname === "/watch") return yt(u.searchParams.get("v"));
    const m = /^\/(?:shorts|live|embed)\/([^/]+)/.exec(u.pathname);
    return m ? yt(m[1]) : null;
  }
  if (host === "soundcloud.com") {
    // soundcloud.com/<artista>/<faixa> (sem /sets/, que é playlist)
    const m = /^\/([a-z0-9_-]{1,80})\/([a-z0-9_-]{1,120})\/?$/i.exec(u.pathname);
    if (!m || ["sets", "likes", "tracks", "albums", "reposts", "followers", "following"].includes(m[2]!.toLowerCase()) || m[1] === "discover") return null;
    return { source: "soundcloud", url: `https://soundcloud.com/${m[1]}/${m[2]}`, key: `sc-${m[1]!.toLowerCase()}-${m[2]!.toLowerCase()}` };
  }
  const bc = /^([a-z0-9-]{1,63})\.bandcamp\.com$/.exec(host);
  if (bc) {
    const m = /^\/track\/([a-z0-9-]{1,120})\/?$/i.exec(u.pathname);
    return m ? { source: "bandcamp", url: `https://${bc[1]}.bandcamp.com/track/${m[1]}`, key: `bc-${bc[1]}-${m[1]!.toLowerCase()}` } : null;
  }
  return null;
}

/** Hosts das miniaturas que podemos baixar para virar capa. */
export const thumbHost = (host: string) =>
  /(^|\.)ytimg\.com$/i.test(host) || /(^|\.)sndcdn\.com$/i.test(host) || /(^|\.)bcbits\.com$/i.test(host);

export interface MediaInfo {
  id: string;
  title: string;
  artist: string | null;
  durationMs: number;
  thumbnail: string | null;
  url: string;
}

/** Roda o yt-dlp e devolve a saída padrão (trocado nos testes). */
export type YtdlpRun = (args: string[], timeoutMs: number) => Promise<string>;

/** Argumentos fixos: sem config do sistema, sem playlist, só os extratores que usamos. */
const BASE_ARGS = [
  "--ignore-config", "--no-playlist", "--no-warnings", "--no-progress", "--no-color",
  "--use-extractors", "youtube,youtube:search,soundcloud,bandcamp",
  "--socket-timeout", "20", "--retries", "2",
];

export function ytdlpRunner(bin: string, extra: string[] = []): YtdlpRun {
  return (args, timeoutMs) =>
    new Promise((resolve, reject) => {
      const child = execFile(bin, [...BASE_ARGS, ...extra, ...args], { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, killSignal: "SIGKILL" }, (err, stdout, stderr) => {
        if (err) return reject(new Error(String(stderr || err.message).trim().split("\n").pop()?.slice(0, 300) ?? "yt-dlp falhou"));
        resolve(stdout);
      });
      // Prioridade baixa: baixar música nunca pode atrasar a API nem o chat.
      try {
        if (child.pid) setPriority(child.pid, 15);
      } catch {
        // sem permissão para mudar a prioridade: segue normal
      }
    });
}

interface RawInfo {
  id?: string; title?: string; track?: string; artist?: string; uploader?: string; channel?: string; creator?: string;
  duration?: number; thumbnail?: string; thumbnails?: { url?: string; width?: number }[]; webpage_url?: string; is_live?: boolean; live_status?: string;
  entries?: RawInfo[]; url?: string;
}

const toInfo = (j: RawInfo, fallbackUrl: string): MediaInfo | null => {
  if (!j.id || !(j.title || j.track)) return null;
  // Miniatura média (não precisa da maior: vira 320x320).
  const thumbs = (j.thumbnails ?? []).filter((t) => t.url && (!t.width || t.width <= 1280));
  const thumb = thumbs.sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? j.thumbnail ?? null;
  return {
    id: j.id,
    title: String(j.track ?? j.title).slice(0, 200),
    artist: (j.artist ?? j.creator ?? j.uploader ?? j.channel)?.replace(/ - Topic$/, "").slice(0, 200) ?? null,
    durationMs: Math.round((j.duration ?? 0) * 1000),
    thumbnail: thumb,
    url: j.webpage_url ?? fallbackUrl,
  };
};

export function ytdlp(run: YtdlpRun, log: (msg: string) => void = () => {}) {
  /** Metadados de um link (sem baixar). Recusa ao vivo e longos demais. */
  async function info(url: string): Promise<MediaInfo | { error: string }> {
    let j: RawInfo;
    try {
      j = JSON.parse(await run(["-J", "--", url], 45_000)) as RawInfo;
    } catch (e) {
      log(`yt-dlp info: ${(e as Error).message}`);
      return { error: "não deu para abrir esse link" };
    }
    if (j.is_live || j.live_status === "is_live" || j.live_status === "is_upcoming") return { error: "transmissões ao vivo não tocam na discoteca" };
    const out = toInfo(j, url);
    if (!out || !out.durationMs) return { error: "não deu para abrir esse link" };
    if (out.durationMs > JUKEBOX_MAX_MS) return { error: `música longa demais (máximo ${JUKEBOX_MAX_MS / 60_000} min)` };
    return out;
  }

  /**
   * Acha no YouTube a mesma faixa de uma busca do Deezer: entre os 5 primeiros resultados, o de duração mais
   * próxima (até 20 s de diferença), para não tocar clipe com introdução longa nem versão ao vivo.
   */
  async function find(artist: string | null, title: string, durationMs: number | null): Promise<MediaInfo | null> {
    const q = [artist, title].filter(Boolean).join(" - ").replace(/[\r\n]/g, " ").slice(0, 200);
    let j: RawInfo;
    try {
      j = JSON.parse(await run(["-J", "--flat-playlist", "--", `ytsearch5:${q}`], 45_000)) as RawInfo;
    } catch (e) {
      log(`yt-dlp busca: ${(e as Error).message}`);
      return null;
    }
    const hits = (j.entries ?? []).filter((e) => e.id && /^[A-Za-z0-9_-]{11}$/.test(e.id) && e.duration && e.duration * 1000 <= JUKEBOX_MAX_MS && e.live_status !== "is_live");
    const best = durationMs
      ? hits.map((e) => ({ e, d: Math.abs(e.duration! * 1000 - durationMs) })).filter((x) => x.d <= 20_000).sort((a, b) => a.d - b.d)[0]?.e
      : hits[0];
    return best ? toInfo({ ...best, webpage_url: `https://www.youtube.com/watch?v=${best.id}` }, "") : null;
  }

  /** Baixa só o áudio para `outBase` + extensão; devolve o caminho do arquivo. */
  async function download(url: string, outBase: string): Promise<string> {
    const out = await run([
      "-f", "bestaudio[acodec=opus][abr<=170]/bestaudio[ext=m4a]/bestaudio[acodec=opus]/bestaudio[ext=mp3]/bestaudio",
      "--max-filesize", "40M", "--match-filter", `!is_live & duration <= ${JUKEBOX_MAX_MS / 1000}`,
      "--no-part", "--no-mtime", "--no-write-thumbnail", "--no-embed-metadata",
      "-o", `${outBase}.%(ext)s`, "--print", "after_move:filepath", "--no-simulate", "--", url,
    ], 180_000);
    const path = out.trim().split("\n").pop()?.trim();
    if (!path || !path.startsWith(outBase)) throw new Error("download sem arquivo");
    return path;
  }

  return { info, find, download };
}
