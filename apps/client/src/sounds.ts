/**
 * Sons do app, gerados na hora com Web Audio (sem arquivos): bolhas e ondas do mar, curtos e baixinhos.
 * - mensagem de servidor: uma gota caindo na água ("ploc" com uma bolhinha depois)
 * - mensagem direta (DM/grupo): duas gotas mais graves e cheias, "plon-plin", para distinguir sem olhar
 * - mutar / desmutar: bolha que desce / que sobe
 * - ensurdecer: duas bolhas descendo; voltar o som: duas subindo
 * - transmissão: uma onda chegando (e indo embora, ao parar)
 * - entrar na chamada: mergulho (onda subindo e bolhas); sair: a onda indo embora com uma bolha afundando
 * - alguém entra na chamada: duas bolhinhas agudas subindo; alguém sai: as mesmas descendo
 */
export type SoundName =
  | "message" | "dmMessage" | "mute" | "unmute" | "deafen" | "undeafen" | "screenOn" | "screenOff" | "ring"
  | "callJoin" | "callLeave" | "userJoin" | "userLeave";

const KEY = "turtle.sounds";
export interface SoundPrefs {
  enabled: boolean;
  /** 0 a 1. */
  volume: number;
  /** Avisar de toda mensagem nos servidores não silenciados (desligado: só menções e conversas diretas). */
  allServerMessages: boolean;
  /** Sons de mensagem nova (servidor e conversas diretas). */
  messages: boolean;
  /** 0 a 1, multiplica o volume geral só para os sons de mensagem. */
  messageVolume: number;
  /** Sons de entrar e sair da chamada (você e os outros). */
  callPresence: boolean;
}
const defaults: SoundPrefs = { enabled: true, volume: 0.6, allServerMessages: true, messages: true, messageVolume: 1, callPresence: true };

export function loadSoundPrefs(): SoundPrefs {
  try {
    return { ...defaults, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<SoundPrefs>) };
  } catch {
    return defaults;
  }
}
export function saveSoundPrefs(p: SoundPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // sem storage: vale só nesta sessão
  }
}

let ctx: AudioContext | undefined;
let noise: AudioBuffer | undefined;
let sinkId = "";

function audio() {
  if (!ctx) {
    ctx = new AudioContext();
    // Ruído branco reaproveitado para as ondas.
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  return ctx;
}

/** O mesmo AudioContext dos sons do app (já na saída escolhida), para o soundboard. */
export function sharedAudio(): AudioContext {
  const c = audio();
  if (sinkId) setSoundOutput(sinkId);
  return c;
}

/** Toca pelo mesmo fone/caixa escolhido nas configurações de voz (quando o navegador deixa). */
export function setSoundOutput(deviceId: string) {
  sinkId = deviceId;
  const c = ctx as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | undefined;
  if (c?.setSinkId) void c.setSinkId(deviceId === "default" ? "" : deviceId).catch(() => {});
}

/** Uma bolha: seno com o tom deslizando e um envelope rápido, como "bloop". */
function bubble(c: AudioContext, out: AudioNode, at: number, from: number, to: number, dur: number, level: number) {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(from, at);
  osc.frequency.exponentialRampToValueAtTime(to, at + dur);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(level, at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(out);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

/** Uma onda: ruído filtrado que cresce e some, com o filtro varrendo do grave ao agudo (ou o contrário). */
function wave(c: AudioContext, out: AudioNode, at: number, from: number, to: number, dur: number, level: number) {
  const src = c.createBufferSource();
  src.buffer = noise!;
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 0.9;
  bp.frequency.setValueAtTime(from, at);
  bp.frequency.exponentialRampToValueAtTime(to, at + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(level, at + dur * 0.45);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(bp).connect(g).connect(out);
  src.start(at);
  src.stop(at + dur + 0.05);
}

const MESSAGE_SOUNDS: SoundName[] = ["message", "dmMessage"];
const MESSAGE_COOLDOWN_MS = 800;
const lastMessage: Partial<Record<SoundName, number>> = {};

/** Para o botão "ouvir" das configurações: ignora o cooldown. */
export function previewSound(name: SoundName) {
  delete lastMessage[name];
  playSound(name);
}

export function playSound(name: SoundName) {
  const prefs = loadSoundPrefs();
  const isMessage = MESSAGE_SOUNDS.includes(name);
  if (!prefs.enabled || prefs.volume <= 0) return;
  if (isMessage) {
    // Rajada de mensagens (ou alguém digitando rápido) toca um som só; os botões de teste usam `force`.
    if (!prefs.messages || prefs.messageVolume <= 0) return;
    const now = Date.now();
    if (now - (lastMessage[name] ?? 0) < MESSAGE_COOLDOWN_MS) return;
    lastMessage[name] = now;
  }
  let c: AudioContext;
  try {
    c = audio();
  } catch {
    return; // sem Web Audio
  }
  if (sinkId) setSoundOutput(sinkId);
  const out = c.createGain();
  out.gain.value = prefs.volume * (isMessage ? prefs.messageVolume : 1) * 0.5;
  out.connect(c.destination);
  const t = c.currentTime + 0.01;
  switch (name) {
    case "message":
      bubble(c, out, t, 520, 1300, 0.11, 0.55);
      bubble(c, out, t + 0.09, 900, 1700, 0.07, 0.25);
      break;
    case "dmMessage":
      bubble(c, out, t, 380, 760, 0.13, 0.6);
      bubble(c, out, t + 0.12, 560, 1100, 0.16, 0.5);
      break;
    case "mute":
      bubble(c, out, t, 820, 360, 0.15, 0.5);
      break;
    case "unmute":
      bubble(c, out, t, 360, 820, 0.15, 0.5);
      break;
    case "deafen":
      bubble(c, out, t, 760, 420, 0.11, 0.45);
      bubble(c, out, t + 0.1, 560, 260, 0.13, 0.45);
      break;
    case "undeafen":
      bubble(c, out, t, 260, 560, 0.11, 0.45);
      bubble(c, out, t + 0.1, 420, 760, 0.13, 0.45);
      break;
    case "screenOn":
      wave(c, out, t, 350, 2200, 0.75, 0.5);
      bubble(c, out, t + 0.55, 600, 1400, 0.1, 0.35);
      break;
    case "screenOff":
      wave(c, out, t, 2000, 300, 0.55, 0.4);
      break;
    case "ring": // toque de chamada: três bolhas subindo (repetido pelo app enquanto toca)
      bubble(c, out, t, 500, 900, 0.14, 0.6);
      bubble(c, out, t + 0.18, 600, 1100, 0.14, 0.6);
      bubble(c, out, t + 0.36, 700, 1300, 0.18, 0.6);
      break;
    case "callJoin": // você entrou: mergulho curto e duas bolhas subindo
      wave(c, out, t, 260, 1500, 0.4, 0.35);
      bubble(c, out, t + 0.22, 440, 880, 0.12, 0.5);
      bubble(c, out, t + 0.34, 660, 1320, 0.14, 0.45);
      break;
    case "callLeave": // você saiu: a onda vai embora e uma bolha afunda
      wave(c, out, t, 1500, 260, 0.4, 0.3);
      bubble(c, out, t + 0.05, 880, 440, 0.13, 0.45);
      bubble(c, out, t + 0.18, 660, 300, 0.16, 0.45);
      break;
    case "userJoin": // alguém entrou: "plip-plip" agudo subindo
      bubble(c, out, t, 900, 1500, 0.07, 0.4);
      bubble(c, out, t + 0.08, 1200, 2000, 0.08, 0.35);
      break;
    case "userLeave": // alguém saiu: o mesmo descendo
      bubble(c, out, t, 2000, 1200, 0.08, 0.35);
      bubble(c, out, t + 0.08, 1500, 900, 0.09, 0.4);
      break;
  }
  // Solta os nós quando o som acaba.
  setTimeout(() => out.disconnect(), 1500);
}
