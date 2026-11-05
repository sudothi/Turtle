/**
 * Sons do app, gerados na hora com Web Audio (sem arquivos): bolhas e ondas do mar, curtos e baixinhos.
 * - mensagem: uma gota caindo na água ("ploc" com uma bolhinha depois)
 * - mutar / desmutar: bolha que desce / que sobe
 * - ensurdecer: duas bolhas descendo; voltar o som: duas subindo
 * - transmissão: uma onda chegando (e indo embora, ao parar)
 */
export type SoundName = "message" | "mute" | "unmute" | "deafen" | "undeafen" | "screenOn" | "screenOff";

const KEY = "turtle.sounds";
export interface SoundPrefs {
  enabled: boolean;
  /** 0 a 1. */
  volume: number;
  /** Avisar de toda mensagem nos servidores (por padrão, só menções e conversas diretas). */
  allServerMessages: boolean;
}
const defaults: SoundPrefs = { enabled: true, volume: 0.6, allServerMessages: false };

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

export function playSound(name: SoundName) {
  const prefs = loadSoundPrefs();
  if (!prefs.enabled || prefs.volume <= 0) return;
  let c: AudioContext;
  try {
    c = audio();
  } catch {
    return; // sem Web Audio
  }
  if (sinkId) setSoundOutput(sinkId);
  const out = c.createGain();
  out.gain.value = prefs.volume * 0.5;
  out.connect(c.destination);
  const t = c.currentTime + 0.01;
  switch (name) {
    case "message":
      bubble(c, out, t, 520, 1300, 0.11, 0.55);
      bubble(c, out, t + 0.09, 900, 1700, 0.07, 0.25);
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
  }
  // Solta os nós quando o som acaba.
  setTimeout(() => out.disconnect(), 1500);
}
