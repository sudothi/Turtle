/** Preferências de áudio deste computador (ficam no navegador/app, não no servidor). */
export type NoiseMode = "rnnoise" | "browser" | "off";

export interface AudioPrefs {
  inputId: string;
  outputId: string;
  noise: NoiseMode;
  /** Volume da voz por pessoa (userId -> 0..1). */
  volumes: Record<string, number>;
  /** Volume do áudio das transmissões de tela por pessoa (userId -> 0..1). */
  streamVolumes: Record<string, number>;
  cameraId: string;
  screenProfile: ScreenProfileId;
  /** Incluir o áudio do computador ao transmitir. Começa desligado para evitar eco da chamada. */
  screenAudio: boolean;
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
const defaults: AudioPrefs = {
  inputId: "default", outputId: "default", noise: "rnnoise", volumes: {},
  streamVolumes: {}, cameraId: "default", screenProfile: "1080p30", screenAudio: false,
};

export function loadPrefs(): AudioPrefs {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
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

/**
 * Restrições do microfone. Cancelamento de eco e ganho automático sempre ligados;
 * a supressão do navegador só quando o RNNoise está desligado (os dois juntos deixam a voz metálica).
 */
export const micConstraints = (p: Pick<AudioPrefs, "inputId" | "noise">) => ({
  deviceId: p.inputId === "default" ? undefined : { exact: p.inputId },
  echoCancellation: true,
  autoGainControl: true,
  noiseSuppression: p.noise === "browser",
  channelCount: 1,
  sampleRate: 48000,
});
