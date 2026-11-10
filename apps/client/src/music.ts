import { useSyncExternalStore } from "react";
import { authedBlobUrl } from "./api";

/** Prévia de música tocando no chat: uma de cada vez, com o mesmo <audio> para o app todo. */
export interface MusicPlayback {
  /** Cartão que está tocando (a mesma faixa pode aparecer em várias mensagens). */
  owner: string | null;
  playing: boolean;
  loading: boolean;
  /** Segundos. */
  position: number;
  duration: number;
  error: string | null;
}

let state: MusicPlayback = { owner: null, playing: false, loading: false, position: 0, duration: 0, error: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<MusicPlayback>) => {
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
};

let audio: HTMLAudioElement | null = null;
function el(): HTMLAudioElement {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = "auto";
  audio.volume = 0.8;
  audio.addEventListener("timeupdate", () => set({ position: audio!.currentTime }));
  audio.addEventListener("loadedmetadata", () => set({ duration: Number.isFinite(audio!.duration) ? audio!.duration : 30 }));
  audio.addEventListener("play", () => set({ playing: true }));
  audio.addEventListener("pause", () => set({ playing: false }));
  audio.addEventListener("ended", () => set({ playing: false, position: 0 }));
  return audio;
}

/** Áudio já baixado de cada faixa (blob:), para tocar de novo sem buscar. */
const blobs = new Map<string, Promise<string>>();
const previewUrl = (id: string) => {
  let job = blobs.get(id);
  if (!job) {
    job = authedBlobUrl(`/music/${id}/preview`);
    job.catch(() => blobs.delete(id));
    blobs.set(id, job);
  }
  return job;
};

/** Toca ou pausa a prévia da faixa `id` no cartão `owner`; tocar em outro cartão para o anterior. */
export async function toggleMusic(owner: string, id: string) {
  const a = el();
  if (state.owner === owner && state.loading) return;
  if (state.owner === owner && !state.error) {
    if (a.paused) await a.play().catch(() => set({ error: "não deu para tocar" }));
    else a.pause();
    return;
  }
  a.pause();
  set({ owner, loading: true, playing: false, position: 0, duration: 0, error: null });
  try {
    const src = await previewUrl(id);
    if (state.owner !== owner) return; // trocou de cartão enquanto baixava
    a.src = src;
    a.currentTime = 0;
    await a.play();
    set({ loading: false });
  } catch {
    if (state.owner === owner) set({ loading: false, playing: false, error: "prévia indisponível" });
  }
}

/** Capa da faixa (blob:), baixada uma vez. */
const covers = new Map<string, Promise<string | null>>();
export function musicCover(id: string) {
  let job = covers.get(id);
  if (!job) { job = authedBlobUrl(`/music/${id}/cover`).catch(() => null); covers.set(id, job); }
  return job;
}

/** Link que a busca envia no chat. */
export const deezerLink = (id: string) => `https://www.deezer.com/track/${id.replace(/^dz/, "")}`;

/** Para a faixa (quando o cartão some da tela, por exemplo ao trocar de canal). `prefixo*` para qualquer dono com o prefixo. */
export function stopMusic(owner: string) {
  if (state.owner !== owner && !(owner.endsWith("*") && state.owner?.startsWith(owner.slice(0, -1)))) return;
  audio?.pause();
  set({ owner: null, playing: false, loading: false, position: 0 });
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export const useMusicPlayback = () => useSyncExternalStore(subscribe, () => state);

const SPOTIFY = /^https?:\/\/(?:(?:www\.)?deezer\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?track\/\d{1,15}(?:[/?#]|$)|open\.spotify\.com\/(?:intl-[a-z]{2}(?:-[a-z]{2})?\/)?(?:embed\/)?track\/[A-Za-z0-9]{22}(?:[/?#]|$)|spotify\.link\/[A-Za-z0-9]{4,40}$)/i;
/** Link de faixa do Spotify ou do Deezer (a busca de música envia o do Deezer): vira cartão de música. */
export const isMusicLink = (url: string) => SPOTIFY.test(url);
/** Mensagem que é só um link de música (aparece só o cartão, sem o texto do link). */
export const isSoloMusicLink = (content: string) => !/\s/.test(content.trim()) && SPOTIFY.test(content.trim());

/** "1:05" */
export const clock = (secs: number) => {
  const s = Math.max(0, Math.floor(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Cor que mais marca a capa (matiz mais frequente entre os pixels com cor), para tingir o vinil. */
export interface CoverTint { disc: string; groove: string }
const tints = new Map<string, Promise<CoverTint | null>>();
export function coverTint(src: string): Promise<CoverTint | null> {
  let job = tints.get(src);
  if (!job) {
    job = new Promise<CoverTint | null>((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const N = 32;
          const c = document.createElement("canvas");
          c.width = c.height = N;
          const ctx = c.getContext("2d", { willReadFrequently: true });
          if (!ctx) return resolve(null);
          ctx.drawImage(img, 0, 0, N, N);
          const px = ctx.getImageData(0, 0, N, N).data;
          // 24 faixas de matiz; cada pixel vale pela saturação (cinza quase não conta).
          const bins = Array.from({ length: 24 }, () => ({ w: 0, s: 0 }));
          for (let i = 0; i < px.length; i += 4) {
            const r = px[i]! / 255, g = px[i + 1]! / 255, b = px[i + 2]! / 255;
            const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
            if (d < 0.08 || l < 0.1 || l > 0.92) continue;
            const s = d / (1 - Math.abs(2 * l - 1));
            let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
            h = (h * 60 + 360) % 360;
            const bin = bins[Math.floor(h / 15)]!;
            bin.w += s;
            bin.s += s * s;
          }
          let best = -1;
          for (let i = 0; i < 24; i++) if (best < 0 || bins[i]!.w > bins[best]!.w) best = i;
          const top = bins[best]!;
          if (!top || top.w < 20) return resolve(null); // capa praticamente sem cor: vinil preto
          const hue = best * 15 + 7.5;
          const sat = Math.round(Math.min(90, Math.max(45, (top.s / top.w) * 100)));
          resolve({ disc: `hsl(${hue} ${Math.min(sat, 60)}% 13%)`, groove: `hsl(${hue} ${sat}% 62%)` });
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = src;
    });
    tints.set(src, job);
  }
  return job;
}
