/** Preferências de áudio deste computador (ficam no navegador/app, não no servidor). */
export type NoiseMode = "gtcrn" | "rnnoise" | "speex" | "browser" | "off";

export interface AudioPrefs {
  inputId: string;
  outputId: string;
  noise: NoiseMode;
  /** Porta de ruído (noise gate): corta o som abaixo de `gateThreshold` dB. */
  noiseGate: boolean;
  /** Limiar em dB (-70 a -20) para abrir a porta de ruído. */
  gateThreshold: number;
  /** Ganho do microfone (0.25 a 2.5, onde 1 = 100%). */
  inputGain: number;
  /** Volume da voz por pessoa (userId -> 0..1). */
  volumes: Record<string, number>;
  /** Volume do áudio das transmissões de tela por pessoa (userId -> 0..1). */
  streamVolumes: Record<string, number>;
  cameraId: string;
  screenProfile: ScreenProfileId;
  /** Incluir o áudio do computador ao transmitir. Começa desligado para evitar eco da chamada. */
  screenAudio: boolean;
  /** Publicar também uma versão pequena da tela (960×540, 15 fps) para quem tem rede fraca. Custa CPU/GPU de quem transmite. */
  screenSimulcast: boolean;
}

export type ScreenProfileId = "1080p30" | "720p60" | "1080p60";

export interface ScreenProfile {
  id: ScreenProfileId;
  label: string;
  width: number;
  height: number;
  fps: number;
  /** Bitrate máximo em bits/s. */
  bitrate: number;
  /** O que sacrificar quando a rede ou a CPU apertam. */
  degradation: "maintain-resolution" | "maintain-framerate";
  hint: string;
}

export const screenProfiles: Record<ScreenProfileId, ScreenProfile> = {
  "1080p30": { id: "1080p30", label: "1080p 30 fps", width: 1920, height: 1080, fps: 30, bitrate: 6_000_000, degradation: "maintain-resolution", hint: "Mais nítido: código, filmes, jogos calmos" },
  "720p60": { id: "720p60", label: "720p 60 fps", width: 1280, height: 720, fps: 60, bitrate: 4_000_000, degradation: "maintain-framerate", hint: "Mais fluido com internet fraca" },
  "1080p60": { id: "1080p60", label: "1080p 60 fps", width: 1920, height: 1080, fps: 60, bitrate: 9_000_000, degradation: "maintain-framerate", hint: "Jogos rápidos (exige boa internet)" },
};

const KEY = "turtle.audio";
const validNoise = new Set<NoiseMode>(["gtcrn", "rnnoise", "speex", "browser", "off"]);
const defaults: AudioPrefs = {
  inputId: "default", outputId: "default", noise: "gtcrn", noiseGate: true, gateThreshold: -50, inputGain: 1,
  volumes: {}, streamVolumes: {}, cameraId: "default", screenProfile: "1080p30", screenAudio: false, screenSimulcast: false,
};

export function loadPrefs(): AudioPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<AudioPrefs>;
    const merged = { ...defaults, ...raw };
    if (!validNoise.has(merged.noise)) merged.noise = defaults.noise;
    merged.gateThreshold = Math.max(-70, Math.min(-20, Number(merged.gateThreshold) || defaults.gateThreshold));
    merged.inputGain = Math.max(0.25, Math.min(2.5, Number(merged.inputGain) || defaults.inputGain));
    return merged;
  } catch {
    return { ...defaults };
  }
}

export function savePrefs(p: AudioPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // sem armazenamento: vale só nesta sessão
  }
}

/** Se usa um filtro via AudioWorklet (WASM ou noise gate) ou ajuste de ganho. */
export const usesWasmNoise = (m: NoiseMode): m is "gtcrn" | "rnnoise" | "speex" =>
  m === "gtcrn" || m === "rnnoise" || m === "speex";

export const needsAudioProcessor = (p: Pick<AudioPrefs, "noise" | "noiseGate" | "inputGain">) =>
  usesWasmNoise(p.noise) || p.noiseGate || Math.abs(p.inputGain - 1) > 0.01;

/**
 * Restrições do microfone. Cancelamento de eco e ganho automático sempre ligados;
 * a supressão do navegador só quando o filtro em WASM está desligado (os dois juntos deixam a voz metálica).
 */
export const micConstraints = (p: Pick<AudioPrefs, "inputId" | "noise">) => ({
  deviceId: p.inputId === "default" ? undefined : { exact: p.inputId },
  echoCancellation: true,
  autoGainControl: true,
  noiseSuppression: p.noise === "browser",
  channelCount: 1,
  sampleRate: 48000,
});
