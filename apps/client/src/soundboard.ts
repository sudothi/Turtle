/**
 * Soundboard: lista de sons por servidor, preferências de quem ouve e o toque local.
 * Tocar um som é um evento do WebSocket: o servidor confere (chamada, cooldown) e repassa para quem está
 * na chamada; cada cliente baixa o WAV uma vez (cache) e toca aqui, com o volume do soundboard de quem ouve.
 */
import type { ServerEvent, Sound } from "@turtle/protocol";
import { api, fileUrl } from "./api";
import { sharedAudio } from "./sounds";

const KEY = "turtle.soundboard";
export interface SoundboardPrefs {
  /** 0 a 2 (200%). */
  volume: number;
  /** Silenciar o soundboard inteiro (não ouvir sons de ninguém). */
  muted: boolean;
  /** Pessoas cujo soundboard eu não quero ouvir. */
  mutedUsers: Record<string, boolean>;
}
const defaults: SoundboardPrefs = { volume: 1, muted: false, mutedUsers: {} };

function loadPrefs(): SoundboardPrefs {
  try {
    return { ...defaults, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<SoundboardPrefs>) };
  } catch {
    return defaults;
  }
}

/** Alguém tocou um som agora (o cartão da pessoa pisca com o ícone). */
export interface SoundFlash { userId: string; sound: Sound; until: number }

export interface SoundboardState {
  prefs: SoundboardPrefs;
  sounds: Record<string, Sound[]>;
  flashes: Record<string, SoundFlash>;
  /** Último aviso do servidor ao tocar (cooldown etc.). */
  notice: { text: string; at: number } | null;
}

let state: SoundboardState = { prefs: loadPrefs(), sounds: {}, flashes: {}, notice: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<SoundboardState>) => {
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
};
let sender: ((evt: { t: "soundboardPlay"; soundId: string }) => boolean) | undefined;
let lastRequest = 0;
const buffers = new Map<string, Promise<AudioBuffer>>();
const playing = new Set<AudioBufferSourceNode>();

function savePrefs(p: SoundboardPrefs) {
  set({ prefs: p });
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // sem storage: vale só nesta sessão
  }
}

async function decode(key: string): Promise<AudioBuffer> {
  let hit = buffers.get(key);
  if (!hit) {
    hit = fetch(fileUrl(key)!)
      .then((r) => {
        if (!r.ok) throw new Error("som não encontrado");
        return r.arrayBuffer();
      })
      .then((data) => sharedAudio().decodeAudioData(data));
    hit.catch(() => buffers.delete(key));
    buffers.set(key, hit);
  }
  return hit;
}

/** Toca um buffer com um ganho (até 2x, com limitador para não estourar). */
function playBuffer(buf: AudioBuffer, gain: number, offset = 0, duration?: number) {
  const c = sharedAudio();
  const src = c.createBufferSource();
  src.buffer = buf;
  const g = c.createGain();
  g.gain.value = gain;
  const limiter = c.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.1;
  src.connect(g).connect(limiter).connect(c.destination);
  playing.add(src);
  src.onended = () => {
    playing.delete(src);
    limiter.disconnect();
  };
  src.start(0, offset, duration);
}

export const soundboard = {
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  getState: () => state,

  /** Workspace liga o envio pelo WebSocket. Devolve false se a conexão não está aberta. */
  setSender(fn: typeof sender) {
    sender = fn;
  },

  async load(serverId: string) {
    try {
      const list = await api.sounds(serverId);
      set({ sounds: { ...state.sounds, [serverId]: list } });
      // Baixa os arquivos antes de alguém tocar (são poucos e pequenos).
      for (const s of list) void decode(s.key).catch(() => {});
    } catch {
      // sem acesso ao servidor (saiu dele, por exemplo)
    }
  },

  /** Pede ao servidor para tocar na chamada (todos ouvem, inclusive eu, quando o evento volta). */
  play(soundId: string) {
    lastRequest = Date.now();
    if (!sender?.({ t: "soundboardPlay", soundId })) set({ notice: { text: "sem conexão com o servidor", at: Date.now() } });
  },

  /** Ouvir só para mim (antes de enviar ou para conferir um som). */
  async preview(sound: Pick<Sound, "key" | "volume">) {
    const buf = await decode(sound.key);
    playBuffer(buf, sound.volume * state.prefs.volume);
  },
  previewBuffer(buf: AudioBuffer, volume: number, start = 0, end = buf.duration) {
    soundboard.stopAll();
    playBuffer(buf, volume * state.prefs.volume, start, Math.max(0.05, end - start));
  },

  /** Evento do servidor. `deafened`: estou ensurdecido (não toca nada). */
  async onEvent(evt: Extract<ServerEvent, { t: "soundboardPlay" }>, deafened: boolean) {
    const until = Date.now() + Math.max(evt.sound.durationMs, 1200);
    set({ flashes: { ...state.flashes, [evt.userId]: { userId: evt.userId, sound: evt.sound, until } } });
    setTimeout(() => {
      const f = state.flashes[evt.userId];
      if (f && f.until <= Date.now()) {
        const { [evt.userId]: _gone, ...rest } = state.flashes;
        set({ flashes: rest });
      }
    }, until - Date.now() + 20);
    const p = state.prefs;
    if (deafened || p.muted || p.mutedUsers[evt.userId] || p.volume <= 0) return;
    try {
      playBuffer(await decode(evt.sound.key), evt.sound.volume * p.volume);
    } catch {
      // arquivo sumiu (som apagado no meio do caminho)
    }
  },

  /** Erro do WebSocket sem nonce: se veio logo depois de eu tocar um som, é sobre o soundboard. */
  onError(text: string) {
    if (Date.now() - lastRequest < 3000) set({ notice: { text, at: Date.now() } });
  },
  clearNotice() {
    set({ notice: null });
  },

  /** Parar o que está tocando aqui (ao ensurdecer ou sair da chamada). */
  stopAll() {
    for (const s of playing) {
      try {
        s.stop();
      } catch {
        // já parou
      }
    }
    playing.clear();
  },

  setVolume(volume: number) {
    savePrefs({ ...state.prefs, volume: Math.max(0, Math.min(2, volume)) });
  },
  setMuted(muted: boolean) {
    savePrefs({ ...state.prefs, muted });
    if (muted) soundboard.stopAll();
  },
  setUserMuted(userId: string, muted: boolean) {
    const mutedUsers = { ...state.prefs.mutedUsers };
    if (muted) mutedUsers[userId] = true;
    else delete mutedUsers[userId];
    savePrefs({ ...state.prefs, mutedUsers });
  },
};

/** Converte um trecho de áudio (até 5 s) para WAV mono 48 kHz 16 bits, o formato que o servidor aceita. */
export async function encodeWav(buf: AudioBuffer, startSec: number, endSec: number): Promise<Blob> {
  const rate = 48000;
  const dur = Math.max(0.05, endSec - startSec);
  const frames = Math.round(dur * rate);
  const off = new OfflineAudioContext(1, frames, rate);
  const src = off.createBufferSource();
  src.buffer = buf;
  src.connect(off.destination);
  src.start(0, startSec, dur);
  const out = await off.startRendering();
  const pcm = out.getChannelData(0);
  const view = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const str = (o: number, s: string) => [...s].forEach((ch, i) => view.setUint8(o + i, ch.charCodeAt(0)));
  str(0, "RIFF");
  view.setUint32(4, 36 + pcm.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, pcm[i]!)) * 32767), true);
  return new Blob([view.buffer], { type: "audio/wav" });
}

/** Lê um arquivo de áudio qualquer que o navegador entende (mp3, ogg, wav, webm, m4a…). */
export async function decodeFile(file: File): Promise<AudioBuffer> {
  return sharedAudio().decodeAudioData(await file.arrayBuffer());
}
