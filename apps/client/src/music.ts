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

/** Para a faixa (quando o cartão some da tela, por exemplo ao trocar de canal). */
export function stopMusic(owner: string) {
  if (state.owner !== owner) return;
  audio?.pause();
  set({ owner: null, playing: false, loading: false, position: 0 });
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export const useMusicPlayback = () => useSyncExternalStore(subscribe, () => state);

const SPOTIFY = /^https?:\/\/(?:open\.spotify\.com\/(?:intl-[a-z]{2}(?:-[a-z]{2})?\/)?(?:embed\/)?track\/[A-Za-z0-9]{22}(?:[/?#]|$)|spotify\.link\/[A-Za-z0-9]{4,40}$)/i;
/** Link de faixa do Spotify (vira cartão de música em vez da prévia comum). */
export const isSpotifyTrackLink = (url: string) => SPOTIFY.test(url);

/** "1:05" */
export const clock = (secs: number) => {
  const s = Math.max(0, Math.floor(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
