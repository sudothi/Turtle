/** Preferências de áudio deste computador (ficam no navegador/app, não no servidor). */
export type NoiseMode = "rnnoise" | "browser" | "off";

export interface AudioPrefs {
  inputId: string;
  outputId: string;
  noise: NoiseMode;
  /** Volume por pessoa (userId -> 0..1). */
  volumes: Record<string, number>;
}

const KEY = "turtle.audio";
const defaults: AudioPrefs = { inputId: "default", outputId: "default", noise: "rnnoise", volumes: {} };

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
