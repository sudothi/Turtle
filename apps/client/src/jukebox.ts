import { useEffect, useState, useSyncExternalStore } from "react";
import { jukeboxPosition, type JukeboxState, type ServerEvent } from "@turtle/protocol";

/**
 * Discoteca da chamada: guarda o estado de cada chamada do servidor (vem pelo WebSocket) e toca a faixa atual
 * da chamada em que estou num <audio> só, sincronizado com o relógio do servidor. Volume e mudo são de cada pessoa.
 */

const KEY = "turtle.jukebox";
export interface JukeboxPrefs { volume: number; muted: boolean }
function loadPrefs(): JukeboxPrefs {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<JukeboxPrefs>;
    return { volume: typeof p.volume === "number" ? Math.min(1, Math.max(0, p.volume)) : 0.5, muted: !!p.muted };
  } catch {
    return { volume: 0.5, muted: false };
  }
}

export interface JukeboxStore {
  /** Estado por canal de voz (só os que têm algo na fila). */
  states: Record<string, JukeboxState>;
  prefs: JukeboxPrefs;
  /** O navegador bloqueou o play automático: precisa de um toque. */
  blocked: boolean;
}

let store: JukeboxStore = { states: {}, prefs: loadPrefs(), blocked: false };
const listeners = new Set<() => void>();
const set = (patch: Partial<JukeboxStore>) => {
  store = { ...store, ...patch };
  for (const fn of listeners) fn();
};

/** Diferença entre o relógio do servidor e o daqui. O maior valor visto é o mais certo (atraso de rede só diminui). */
let offset: number | null = null;
const serverNow = () => Date.now() + (offset ?? 0);

let call: string | null = null;
let deafened = false;
let sink = "";
let audio: HTMLAudioElement | null = null;
let startTimer: ReturnType<typeof setTimeout> | undefined;
let drift: ReturnType<typeof setInterval> | undefined;

function el() {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = "auto";
  // Quando os metadados chegam, pula para o ponto certo da faixa.
  audio.addEventListener("loadedmetadata", () => sync());
  applyVolume();
  return audio;
}

function applyVolume() {
  if (!audio) return;
  audio.volume = store.prefs.volume;
  audio.muted = store.prefs.muted || deafened;
}

function stop() {
  clearTimeout(startTimer);
  clearInterval(drift);
  drift = undefined;
  if (!audio) return;
  audio.pause();
  if (audio.getAttribute("src")) {
    audio.removeAttribute("src");
    audio.load();
  }
}

/** Acerta o <audio> com o estado da chamada: faixa, pausa e posição (corrige se passou de 0,6 s de diferença). */
function sync() {
  clearTimeout(startTimer);
  const s = call ? store.states[call] : undefined;
  if (!s?.current || !s.audio) return stop();
  const a = el();
  if (a.getAttribute("src") !== s.audio) {
    a.src = s.audio;
    if (sink && "setSinkId" in a) void (a as HTMLAudioElement & { setSinkId(id: string): Promise<void> }).setSinkId(sink).catch(() => {});
  }
  const pos = jukeboxPosition(s, serverNow()) / 1000;
  if (s.pausedAt !== null || s.startedAt === null) {
    a.pause();
    if (a.readyState >= 1 && Math.abs(a.currentTime - pos) > 0.3) a.currentTime = pos;
    return;
  }
  const wait = s.startedAt - serverNow();
  if (wait > 0) {
    a.pause();
    if (a.readyState >= 1 && a.currentTime > 0.05) a.currentTime = 0;
    startTimer = setTimeout(sync, wait);
    return;
  }
  if (a.readyState >= 1 && Math.abs(a.currentTime - pos) > 0.6) a.currentTime = pos;
  if (a.paused && pos * 1000 < s.current.durationMs) {
    a.play().then(() => store.blocked && set({ blocked: false }), (e: DOMException) => {
      if (e?.name === "NotAllowedError") set({ blocked: true });
    });
  }
  // Confere a cada 5 s (aba em segundo plano e travadas da rede fazem o áudio escorregar).
  if (!drift) drift = setInterval(sync, 5000);
}

export const jukebox = {
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  getState: () => store,
  /** Evento `jukebox` do WebSocket. */
  onEvent(evt: Extract<ServerEvent, { t: "jukebox" }>) {
    const states = { ...store.states };
    if (evt.state) {
      const sample = evt.state.now - Date.now();
      offset = offset === null ? sample : Math.max(offset, sample);
      states[evt.channelId] = evt.state;
    } else delete states[evt.channelId];
    set({ states });
    if (evt.channelId === call) sync();
  },
  /** Reconectou: o servidor manda tudo de novo, então esquece o que havia. */
  reset() {
    set({ states: {} });
    offset = null;
    sync();
  },
  /** Chamada em que estou e se estou ensurdecido (ensurdecer cala a música também). */
  setCall(channelId: string | null, isDeafened: boolean) {
    deafened = isDeafened;
    applyVolume();
    if (call === channelId) return;
    call = channelId;
    sync();
  },
  /** Mesma saída de áudio escolhida nas configurações de voz. */
  setOutput(deviceId: string) {
    sink = deviceId === "default" ? "" : deviceId;
    if (audio && "setSinkId" in audio) void (audio as HTMLAudioElement & { setSinkId(id: string): Promise<void> }).setSinkId(sink).catch(() => {});
  },
  setPrefs(p: Partial<JukeboxPrefs>) {
    const prefs = { ...store.prefs, ...p };
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      // sem storage: vale só nesta sessão
    }
    set({ prefs });
    applyVolume();
  },
  /** Toque para liberar o som (quando o navegador bloqueou o play automático). */
  unlock() {
    set({ blocked: false });
    sync();
  },
  /** Posição atual (ms) da faixa da chamada `channelId`. */
  position(channelId: string) {
    const s = store.states[channelId];
    return s ? Math.min(s.current?.durationMs ?? 0, jukeboxPosition(s, serverNow())) : 0;
  },
};

export const useJukebox = () => useSyncExternalStore(jukebox.subscribe, jukebox.getState);

/** Posição da faixa (ms), atualizada a cada meio segundo enquanto toca. */
export function useJukeboxPosition(channelId: string | undefined) {
  const { states } = useJukebox();
  const s = channelId ? states[channelId] : undefined;
  const [pos, setPos] = useState(() => (channelId ? jukebox.position(channelId) : 0));
  const playing = !!s?.startedAt;
  useEffect(() => {
    if (!channelId) return;
    setPos(jukebox.position(channelId));
    if (!playing) return;
    const t = setInterval(() => setPos(jukebox.position(channelId)), 500);
    return () => clearInterval(t);
  }, [channelId, playing, s]);
  return pos;
}

/** Parece um link (o campo da discoteca aceita link ou texto para buscar). */
export const looksLikeLink = (q: string) => /^https?:\/\/\S+$/i.test(q.trim()) || /^(www\.)?(youtube\.com|youtu\.be|soundcloud\.com|open\.spotify\.com|deezer\.com)\//i.test(q.trim());
export const withScheme = (q: string) => (/^https?:\/\//i.test(q.trim()) ? q.trim() : `https://${q.trim()}`);

/** Convite para a discoteca no chat: a mensagem é só este endereço e o cliente mostra o cartão (ao vivo). */
export const discoInviteLink = (channelId: string) => `turtle://discoteca/${channelId}`;
export const parseDiscoInvite = (content: string, origin: string = typeof location === "undefined" ? "" : location.origin) => {
  const text = content.trim();
  // O link copiado (https://<este app>/discoteca/<id>) colado no chat também vira o cartão.
  const web = origin && text.startsWith(`${origin}/`) ? discoIdFromPath(text.slice(origin.length)) : null;
  return web ?? /^turtle:\/\/discoteca\/([\w-]{1,64})$/.exec(text)?.[1] ?? null;
};

/** Link para colar fora do chat: abre o app e mostra o convite (com o botão Entrar). */
export const discoWebLink = (channelId: string, origin: string = location.origin) => `${origin}/discoteca/${channelId}`;
/** Código da chamada num endereço /discoteca/<id> do app (ou null). */
export const discoIdFromPath = (path: string) => /^\/discoteca\/([\w-]{1,64})\/?$/.exec(path)?.[1] ?? null;
