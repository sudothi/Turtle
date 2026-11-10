import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readdirSync } from "node:fs";
import { readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import sharp from "sharp";
import {
  JUKEBOX_MAX_PER_USER, JUKEBOX_MAX_QUEUE, type JukeboxItem, type JukeboxSource, type JukeboxState, type MusicTrack,
} from "@turtle/protocol";
import { deezerTrackId, isSpotifyLink } from "./music.js";
import { mediaLink, thumbHost, type ytdlp } from "./ytdlp.js";

/**
 * Discoteca: uma fila por chamada de servidor. O servidor só guarda a fila e o relógio (`startedAt`);
 * cada aparelho baixa o áudio daqui e toca sozinho, com o volume da pessoa. O áudio fica num cache em disco
 * (um arquivo por faixa, apagando o mais antigo quando passa do limite), então a mesma música não é baixada de novo.
 */

/** Faixa já resolvida (metadados + de onde vem o áudio). */
interface Track {
  /** Nome do arquivo no cache (sem extensão). */
  key: string;
  title: string;
  artist: string | null;
  durationMs: number;
  source: JukeboxSource;
  preview: boolean;
  link: string;
  /** Link para o yt-dlp baixar; sem ele, é a prévia de 30 s do Deezer (`musicId`). */
  fetchUrl: string | null;
  /** Id do cartão de música (Spotify ou `dz...`): capa e prévia vêm do serviço de música. */
  musicId: string | null;
  thumbnail: string | null;
  /** Outros vídeos do YouTube da mesma música, para quando o primeiro for barrado. */
  alts?: { key: string; url: string; durationMs: number }[];
}
interface Item extends Track { id: string; addedBy: string; status: "loading" | "ready"; file: string | null }
interface Box {
  channelId: string;
  serverId: string;
  current: Item | null;
  queue: Item[];
  startedAt: number | null;
  pausedAt: number | null;
  notice: string | null;
  /** Pausada porque todo mundo saiu da chamada: volta sozinha quando alguém entra. */
  autoPaused: boolean;
  timer?: ReturnType<typeof setTimeout>;
  idle?: ReturnType<typeof setTimeout>;
  noticeTimer?: ReturnType<typeof setTimeout>;
}

type Music = {
  resolve(raw: string): Promise<MusicTrack | null>;
  cover(id: string): Promise<Buffer | null>;
  preview(id: string): Promise<Buffer | null>;
};

export interface JukeboxOptions {
  cacheDir: string;
  /** Tamanho máximo do cache de áudio (bytes). */
  cacheBytes?: number;
  /** yt-dlp (YouTube, SoundCloud, Bandcamp). Sem ele, a busca toca só a prévia de 30 s do Deezer. */
  yt?: ReturnType<typeof ytdlp>;
  music: Music;
  /** Baixa a miniatura de um link (para virar capa). */
  fetchImage?: (url: string) => Promise<Buffer | null>;
  onChange: (channelId: string, serverId: string, state: JukeboxState | null) => void;
  /** Folga entre "começou" e o segundo 0, para todos os aparelhos carregarem juntos. */
  leadMs?: number;
  /** Quanto tempo a fila espera com a chamada vazia antes de acabar. */
  idleMs?: number;
  /** Downloads ao mesmo tempo (no servidor todo). */
  maxDownloads?: number;
  now?: () => number;
  log?: (msg: string) => void;
}

export type AddResult = { item: JukeboxItem } | { error: string; code: number };

const ext = (file: string) => file.slice(file.lastIndexOf(".") + 1).toLowerCase();
export const audioType = (file: string) =>
  ({ webm: "audio/webm", weba: "audio/webm", opus: "audio/ogg", ogg: "audio/ogg", m4a: "audio/mp4", mp4: "audio/mp4", mp3: "audio/mpeg" })[ext(file)] ?? null;
const FILE = /^[A-Za-z0-9_-]{1,140}\.(webm|weba|opus|ogg|m4a|mp4|mp3|webp)$/;
const PREVIEW_MS = 30_000;

/** Baixa uma imagem de miniatura (só hosts conhecidos, até 5 MB). */
export async function fetchThumb(url: string): Promise<Buffer | null> {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || !thumbHost(u.hostname)) return null;
    const res = await fetch(u, { redirect: "follow", signal: AbortSignal.timeout(8000) });
    if (!res.ok || (res.url && !thumbHost(new URL(res.url).hostname))) return null;
    if (Number(res.headers.get("content-length") ?? 0) > 5 * 1024 * 1024) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 5 * 1024 * 1024 ? null : buf;
  } catch {
    return null;
  }
}

export function jukeboxService(opts: JukeboxOptions) {
  const { cacheDir, cacheBytes = 1024 ** 3, yt, music, onChange, leadMs = 700, idleMs = 120_000, maxDownloads = 2, now = Date.now } = opts;
  const fetchImage = opts.fetchImage ?? fetchThumb;
  const coverDir = join(cacheDir, "covers");
  mkdirSync(coverDir, { recursive: true });
  /** Assina os nomes de arquivo: o <audio> não manda o token de login, então a URL é a permissão. */
  const secret = randomBytes(32);
  const sign = (file: string) => createHmac("sha256", secret).update(file).digest("base64url").slice(0, 22);
  const signedOk = (sig: string, file: string) => {
    const want = Buffer.from(sign(file));
    const got = Buffer.from(sig);
    return got.length === want.length && timingSafeEqual(got, want);
  };

  const boxes = new Map<string, Box>();
  /** Arquivos de áudio já no disco, por chave. */
  const onDisk = new Map<string, string>();
  for (const f of readdirSync(cacheDir)) if (FILE.test(f) && audioType(f)) onDisk.set(f.slice(0, f.lastIndexOf(".")), f);
  const downloads = new Map<string, Promise<string>>();
  const covers = new Map<string, Promise<boolean>>();
  /** Capas já gravadas: só elas vão no estado (URL antes do arquivo existir viraria imagem quebrada). */
  const coverReady = new Set<string>();
  /** Metadados de links e buscas já resolvidos (não roda o yt-dlp de novo para o mesmo link). */
  const resolved = new Map<string, { at: number; track: Track }>();

  // Fila dos downloads (no máximo `maxDownloads` ao mesmo tempo).
  let running = 0;
  const waiting: (() => void)[] = [];
  const slot = async <T>(job: () => Promise<T>): Promise<T> => {
    if (running >= maxDownloads) await new Promise<void>((r) => waiting.push(r));
    running++;
    try {
      return await job();
    } finally {
      running--;
      waiting.shift()?.();
    }
  };

  const toItem = (i: Item): JukeboxItem => ({
    id: i.id, title: i.title, artist: i.artist, durationMs: i.durationMs, source: i.source, preview: i.preview, link: i.link,
    addedBy: i.addedBy, status: i.status,
    cover: coverReady.has(i.key) ? `/jukebox/cover/${sign(`${i.key}.webp`)}/${i.key}.webp` : null,
  });
  const stateOf = (b: Box): JukeboxState => ({
    channelId: b.channelId, serverId: b.serverId,
    current: b.current && toItem(b.current),
    audio: b.current?.file ? `/jukebox/audio/${sign(b.current.file)}/${b.current.file}` : null,
    startedAt: b.startedAt, pausedAt: b.pausedAt, queue: b.queue.map(toItem), notice: b.notice, now: now(),
  });
  const emit = (b: Box) => onChange(b.channelId, b.serverId, boxes.get(b.channelId) === b ? stateOf(b) : null);
  const say = (b: Box, text: string) => {
    b.notice = text;
    clearTimeout(b.noticeTimer);
    b.noticeTimer = setTimeout(() => { b.notice = null; emit(b); }, 8000);
    b.noticeTimer.unref?.();
  };

  /** Capa em WebP 320x320 no disco (do serviço de música ou da miniatura do link). */
  function ensureCover(t: Track): Promise<boolean> {
    let job = covers.get(t.key);
    if (job) return job;
    const path = join(coverDir, `${t.key}.webp`);
    job = (async () => {
      if (await stat(path).then(() => true, () => false)) return true;
      const raw = t.musicId ? await music.cover(t.musicId) : t.thumbnail ? await fetchImage(t.thumbnail) : null;
      if (!raw) return false;
      const out = t.musicId ? raw : await sharp(raw, { limitInputPixels: 4096 * 4096 }).resize(320, 320, { fit: "cover" }).webp({ quality: 80 }).toBuffer();
      await writeFile(path, out);
      return true;
    })().catch(() => false);
    covers.set(t.key, job);
    void job.then((ok) => {
      if (!ok) return void covers.delete(t.key);
      coverReady.add(t.key);
      // A capa chegou depois: avisa as chamadas que têm essa faixa.
      for (const b of boxes.values()) if ([b.current, ...b.queue].some((i) => i?.key === t.key)) emit(b);
    });
    return job;
  }

  /** Apaga os arquivos mais antigos até o cache caber no limite (menos os que estão na fila). */
  async function evict() {
    const keep = new Set<string>();
    for (const b of boxes.values()) for (const i of [b.current, ...b.queue]) if (i) keep.add(i.key);
    const files = await readdir(cacheDir).catch(() => [] as string[]);
    const list = (await Promise.all(files.filter((f) => FILE.test(f)).map(async (f) => ({ f, s: await stat(join(cacheDir, f)).catch(() => null) }))))
      .filter((x) => x.s?.isFile()) as { f: string; s: import("node:fs").Stats }[];
    let total = list.reduce((n, x) => n + x.s.size, 0);
    for (const x of list.sort((a, b) => a.s.mtimeMs - b.s.mtimeMs)) {
      if (total <= cacheBytes) break;
      const key = x.f.slice(0, x.f.lastIndexOf("."));
      if (keep.has(key)) continue;
      await rm(join(cacheDir, x.f), { force: true });
      onDisk.delete(key);
      total -= x.s.size;
    }
  }

  /** Arquivo de áudio da faixa no cache (baixa uma vez só, mesmo que várias chamadas peçam juntas). */
  function ensureAudio(t: Track): Promise<string> {
    const have = onDisk.get(t.key);
    if (have) return Promise.resolve(have);
    let job = downloads.get(t.key);
    if (job) return job;
    job = slot(async () => {
      let file: string;
      if (t.fetchUrl) {
        if (!yt) throw new Error("sem yt-dlp");
        file = basename(await yt.download(t.fetchUrl, join(cacheDir, t.key)));
        if (!FILE.test(file) || !audioType(file)) {
          await rm(join(cacheDir, file), { force: true }).catch(() => {});
          throw new Error("formato inesperado");
        }
      } else {
        const mp3 = t.musicId ? await music.preview(t.musicId) : null;
        if (!mp3) throw new Error("sem prévia");
        file = `${t.key}.mp3`;
        await writeFile(join(cacheDir, file), mp3);
      }
      onDisk.set(t.key, file);
      void evict().catch(() => {});
      return file;
    }).finally(() => downloads.delete(t.key));
    downloads.set(t.key, job);
    return job;
  }

  /** Link de faixa do Spotify/Deezer ou id da busca: metadados do cartão de música; áudio do YouTube (ou prévia). */
  async function fromMusic(raw: string): Promise<Track | { error: string }> {
    const m = await music.resolve(raw);
    if (!m) return { error: "não achei essa música" };
    const durationMs = m.durationMs ?? 0;
    const hits = yt ? await yt.findAll(m.artist, m.title, m.durationMs) : [];
    const hit = hits[0];
    if (hit) {
      return {
        alts: hits.slice(1).map((h) => ({ key: `yt-${h.id}`, url: h.url, durationMs: h.durationMs })),
        key: `yt-${hit.id}`, title: m.title, artist: m.artist, durationMs: hit.durationMs || durationMs, source: "youtube", preview: false,
        link: hit.url, fetchUrl: hit.url, musicId: m.hasCover ? m.id : null, thumbnail: m.hasCover ? null : hit.thumbnail,
      };
    }
    if (!m.previewSource) return { error: "não achei uma versão dessa música para tocar" };
    return {
      key: `dz-${m.id}-preview`, title: m.title, artist: m.artist, durationMs: PREVIEW_MS, source: "deezer", preview: true,
      link: m.url, fetchUrl: null, musicId: m.id, thumbnail: null,
    };
  }

  async function resolveInput(body: { url: string } | { trackId: string }): Promise<Track | { error: string }> {
    const raw = "trackId" in body ? `https://www.deezer.com/track/${body.trackId.slice(2)}` : body.url.trim();
    const media = "url" in body ? mediaLink(raw) : null;
    const cacheKey = media?.key ?? raw;
    const hit = resolved.get(cacheKey);
    if (hit && now() - hit.at < 6 * 3_600_000) return hit.track;
    let track: Track | { error: string };
    if (media) {
      if (!yt) return { error: "links do YouTube, SoundCloud e Bandcamp estão desligados neste servidor; use a busca" };
      const info = await yt.info(media.url);
      if ("error" in info) return info;
      track = {
        key: media.key, title: info.title, artist: info.artist, durationMs: info.durationMs, source: media.source, preview: false,
        link: media.url, fetchUrl: media.url, musicId: null, thumbnail: info.thumbnail,
      };
    } else if ("trackId" in body || deezerTrackId(raw) || isSpotifyLink(raw)) {
      track = await fromMusic(raw);
    } else {
      return { error: "link não suportado: use YouTube, SoundCloud, Bandcamp, Spotify ou Deezer" };
    }
    if (!("error" in track)) {
      if (resolved.size >= 500) resolved.delete(resolved.keys().next().value!);
      resolved.set(cacheKey, { at: now(), track });
    }
    return track;
  }

  /** Deixa o próximo da fila baixado antes da hora (troca de faixa sem espera). */
  function prefetch(b: Box) {
    const next = b.queue[0];
    if (!next || next.status === "ready") return;
    ensureAudio(next).then((file) => {
      next.file = file;
      if (next.status !== "ready") { next.status = "ready"; emit(b); }
    }, () => {});
  }

  function schedule(b: Box) {
    clearTimeout(b.timer);
    if (!b.current || b.startedAt === null) return;
    const left = b.startedAt + b.current.durationMs - now();
    b.timer = setTimeout(() => advance(b), Math.max(0, left) + 800);
    b.timer.unref?.();
  }

  /** Baixa a faixa; se o YouTube barrar, tenta os outros vídeos da mesma música. Sem prévia: ou toca inteira ou avisa. */
  async function load(b: Box, item: Item): Promise<string> {
    try {
      return await ensureAudio(item);
    } catch (e) {
      opts.log?.(`discoteca: não baixou ${item.key}: ${(e as Error).message}`);
      const alts = item.alts ?? [];
      item.alts = [];
      for (const alt of alts) {
        if (b.current !== item) break;
        Object.assign(item, { key: alt.key, fetchUrl: alt.url, link: alt.url, durationMs: alt.durationMs || item.durationMs });
        try {
          const file = await ensureAudio(item);
          emit(b);
          return file;
        } catch (e2) {
          opts.log?.(`discoteca: não baixou ${alt.key}: ${(e2 as Error).message}`);
        }
      }
      throw e;
    }
  }

  async function begin(b: Box, item: Item) {
    emit(b);
    let file: string;
    try {
      file = await load(b, item);
    } catch (e) {
      opts.log?.(`discoteca: não baixou ${item.key}: ${(e as Error).message}`);
      if (b.current !== item) return;
      const login = /sign in to confirm|not a bot|cookies/i.test((e as Error).message);
      say(b, login
        ? `O YouTube pediu login para “${item.title}” (cookies ausentes ou vencidos); pulei para a próxima.`
        : `Não deu para tocar “${item.title}”; pulei para a próxima.`);
      return advance(b);
    }
    if (b.current !== item || boxes.get(b.channelId) !== b) return;
    item.file = file;
    item.status = "ready";
    // Pausaram enquanto carregava (ou a chamada esvaziou): fica pronta, parada no começo.
    if (b.pausedAt === null) b.startedAt = now() + leadMs;
    schedule(b);
    emit(b);
  }

  function advance(b: Box) {
    clearTimeout(b.timer);
    if (boxes.get(b.channelId) !== b) return;
    b.current = b.queue.shift() ?? null;
    b.startedAt = null;
    b.pausedAt = b.autoPaused && b.current ? 0 : null;
    if (!b.current) return emit(b);
    prefetch(b);
    void begin(b, b.current);
  }

  function end(b: Box) {
    clearTimeout(b.timer);
    clearTimeout(b.idle);
    clearTimeout(b.noticeTimer);
    boxes.delete(b.channelId);
    emit(b);
  }

  const mineCount = (b: Box, userId: string) => [b.current, ...b.queue].filter((i) => i?.addedBy === userId).length;

  return {
    /** Estado da discoteca de uma chamada (null se não tem nada). */
    state: (channelId: string) => {
      const b = boxes.get(channelId);
      return b ? stateOf(b) : null;
    },
    /** Todas as discotecas dos servidores dados (para mandar a quem acabou de conectar). */
    statesFor: (serverIds: Set<string> | undefined) => [...boxes.values()].filter((b) => serverIds?.has(b.serverId)).map(stateOf),
    /** Coloca uma faixa na fila (e começa a tocar se a fila estava parada). */
    async add(channelId: string, serverId: string, userId: string, body: { url: string } | { trackId: string }): Promise<AddResult> {
      const pre = boxes.get(channelId);
      if (pre && pre.queue.length >= JUKEBOX_MAX_QUEUE) return { error: `a fila já tem ${JUKEBOX_MAX_QUEUE} músicas`, code: 409 };
      if (pre && mineCount(pre, userId) >= JUKEBOX_MAX_PER_USER) return { error: `você já tem ${JUKEBOX_MAX_PER_USER} músicas na fila`, code: 409 };
      const track = await resolveInput(body);
      if ("error" in track) return { error: track.error, code: 422 };
      let b = boxes.get(channelId);
      if (!b) {
        b = { channelId, serverId, current: null, queue: [], startedAt: null, pausedAt: null, notice: null, autoPaused: false };
        boxes.set(channelId, b);
      }
      // Confere de novo: outra pessoa pode ter enchido a fila enquanto o link era aberto.
      if (b.queue.length >= JUKEBOX_MAX_QUEUE) return { error: `a fila já tem ${JUKEBOX_MAX_QUEUE} músicas`, code: 409 };
      if (mineCount(b, userId) >= JUKEBOX_MAX_PER_USER) return { error: `você já tem ${JUKEBOX_MAX_PER_USER} músicas na fila`, code: 409 };
      const item: Item = { ...track, id: randomBytes(9).toString("base64url"), addedBy: userId, status: onDisk.has(track.key) ? "ready" : "loading", file: onDisk.get(track.key) ?? null };
      void ensureCover(track);
      b.queue.push(item);
      if (!b.current) advance(b);
      else {
        if (b.queue[0] === item) prefetch(b);
        emit(b);
      }
      return { item: toItem(item) };
    },
    pause(channelId: string) {
      const b = boxes.get(channelId);
      if (!b?.current || b.pausedAt !== null) return false;
      b.pausedAt = b.startedAt === null ? 0 : Math.max(0, now() - b.startedAt);
      b.startedAt = null;
      clearTimeout(b.timer);
      emit(b);
      return true;
    },
    resume(channelId: string) {
      const b = boxes.get(channelId);
      if (!b?.current || b.pausedAt === null) return false;
      b.autoPaused = false;
      if (b.current.status === "ready") b.startedAt = now() + leadMs - b.pausedAt;
      b.pausedAt = null;
      schedule(b);
      emit(b);
      return true;
    },
    /** Pula a faixa atual. Com `itemId`, só pula se ainda for ela (dois cliques juntos não pulam duas). */
    skip(channelId: string, itemId?: string) {
      const b = boxes.get(channelId);
      if (!b?.current || (itemId && b.current.id !== itemId)) return false;
      advance(b);
      return true;
    },
    remove(channelId: string, itemId: string) {
      const b = boxes.get(channelId);
      const i = b?.queue.findIndex((x) => x.id === itemId) ?? -1;
      if (!b || i < 0) return false;
      b.queue.splice(i, 1);
      if (i === 0) prefetch(b);
      emit(b);
      return true;
    },
    clear(channelId: string) {
      const b = boxes.get(channelId);
      if (b) end(b);
    },
    /** Quantas pessoas estão na chamada: vazia pausa (e acaba depois de `idleMs`); alguém voltou, continua. */
    occupancy(channelId: string, people: number) {
      const b = boxes.get(channelId);
      if (!b) return;
      if (people > 0) {
        if (!b.idle) return;
        clearTimeout(b.idle);
        b.idle = undefined;
        if (b.autoPaused && b.pausedAt !== null && b.current?.status === "ready") {
          b.autoPaused = false;
          b.startedAt = now() + leadMs - b.pausedAt;
          b.pausedAt = null;
          schedule(b);
          emit(b);
        }
        b.autoPaused = false;
        return;
      }
      if (b.idle) return;
      if (b.current && b.pausedAt === null) {
        b.pausedAt = b.startedAt === null ? 0 : Math.max(0, now() - b.startedAt);
        b.startedAt = null;
        b.autoPaused = true;
        clearTimeout(b.timer);
        emit(b);
      }
      b.idle = setTimeout(() => end(b), idleMs);
      b.idle.unref?.();
    },
    channels: () => [...boxes.keys()],
    /** Confere a assinatura e devolve o caminho de um arquivo do cache (áudio ou capa). */
    file(kind: "audio" | "cover", sig: string, name: string): string | null {
      if (!FILE.test(name) || !signedOk(sig, name)) return null;
      if (kind === "cover") return name.endsWith(".webp") ? join(coverDir, name) : null;
      if (!audioType(name)) return null;
      const path = join(cacheDir, name);
      // Marca como usado (o cache apaga primeiro o que ninguém ouve há mais tempo).
      const t = new Date();
      void utimes(path, t, t).catch(() => {});
      return path;
    },
    close() {
      for (const b of [...boxes.values()]) {
        clearTimeout(b.timer);
        clearTimeout(b.idle);
        clearTimeout(b.noticeTimer);
      }
      boxes.clear();
    },
  };
}

export type Jukebox = ReturnType<typeof jukeboxService>;
