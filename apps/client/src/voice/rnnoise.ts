import type { AudioProcessorOptions, LocalAudioTrack, Track, TrackProcessor } from "livekit-client";
import {
  GtcrnWorkletNode,
  loadGtcrn,
  loadRnnoise,
  loadSpeex,
  NoiseGateWorkletNode,
  RnnoiseWorkletNode,
  SpeexWorkletNode,
} from "@sapphi-red/web-noise-suppressor";
import gtcrnWorkletUrl from "@sapphi-red/web-noise-suppressor/gtcrnWorklet.js?url";
import gtcrnWasmUrl from "@sapphi-red/web-noise-suppressor/gtcrn.wasm?url";
import rnnoiseWorkletUrl from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url";
import rnnoiseWasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url";
import rnnoiseSimdWasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url";
import speexWorkletUrl from "@sapphi-red/web-noise-suppressor/speexWorklet.js?url";
import speexWasmUrl from "@sapphi-red/web-noise-suppressor/speex.wasm?url";
import noiseGateWorkletUrl from "@sapphi-red/web-noise-suppressor/noiseGateWorklet.js?url";
import type { AudioPrefs, NoiseMode } from "./prefs";

export type AudioFilterConfig = Pick<AudioPrefs, "noise" | "noiseGate" | "gateThreshold" | "inputGain">;

let rnnoiseWasm: Promise<ArrayBuffer> | undefined;
let gtcrnWasm: Promise<ArrayBuffer> | undefined;
let speexWasm: Promise<ArrayBuffer> | undefined;

/** Baixa o binário WASM do filtro escolhido uma vez só; dá pra chamar cedo para adiantar. */
export function preloadNoiseWasm(mode: NoiseMode = "gtcrn"): Promise<ArrayBuffer | undefined> {
  if (mode === "gtcrn") return (gtcrnWasm ??= loadGtcrn({ url: gtcrnWasmUrl }));
  if (mode === "rnnoise") return (rnnoiseWasm ??= loadRnnoise({ url: rnnoiseWasmUrl, simdUrl: rnnoiseSimdWasmUrl }));
  if (mode === "speex") return (speexWasm ??= loadSpeex({ url: speexWasmUrl }));
  return Promise.resolve(undefined);
}

/** Compatibilidade com chamadas existentes. */
export const preloadRnnoise = () => preloadNoiseWasm("rnnoise");

export interface RnnoiseGraph {
  context: AudioContext;
  /** Entrada bruta (antes do filtro), útil para comparar o medidor em ⚙. */
  source: AudioNode;
  /** Saída já limpa e com porta de ruído / ganho aplicados. */
  output: AudioNode;
  /** Ajusta o ganho em tempo real sem recriar o AudioContext. */
  setGain(gain: number): void;
  destroy(): void;
}

/** Nó que soma qualquer entrada em um canal só ((L+R)/2 no estéreo). */
export function monoMixer(context: BaseAudioContext): GainNode {
  return new GainNode(context, { channelCount: 1, channelCountMode: "explicit", channelInterpretation: "speakers" });
}

/**
 * A voz sai sempre em mono. O LiveKit marca a track como estéreo quando o microfone informa 2 canais e aí o
 * Opus é negociado em estéreo: com um microfone que só tem som no canal esquerdo (comum em headsets), quem
 * ouve escuta só pelo lado esquerdo. Informando 1 canal, o Opus fica mono e o navegador mistura os dois lados.
 * Chamar antes de publicar a track.
 */
export function publishAsMono(track: LocalAudioTrack) {
  const original = track.getSourceTrackSettings.bind(track);
  track.getSourceTrackSettings = () => ({ ...original(), channelCount: 1 });
}

/**
 * Monta microfone -> [GTCRN | RNNoise | Speex] -> [Noise Gate] -> Gain num AudioContext próprio de 48 kHz.
 * Os modelos WASM operam em 48 kHz, e o contexto da sala pode estar em outra taxa.
 */
export async function createRnnoiseGraph(
  track: MediaStreamTrack,
  cfg: AudioFilterConfig = { noise: "gtcrn", noiseGate: true, gateThreshold: -50, inputGain: 1 },
): Promise<RnnoiseGraph> {
  const context = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
  const destroyCallbacks: (() => void)[] = [];
  try {
    const tasks: Promise<unknown>[] = [];
    if (cfg.noise === "gtcrn") {
      tasks.push(preloadNoiseWasm("gtcrn"), context.audioWorklet.addModule(gtcrnWorkletUrl));
    } else if (cfg.noise === "rnnoise") {
      tasks.push(preloadNoiseWasm("rnnoise"), context.audioWorklet.addModule(rnnoiseWorkletUrl));
    } else if (cfg.noise === "speex") {
      tasks.push(preloadNoiseWasm("speex"), context.audioWorklet.addModule(speexWorkletUrl));
    }
    if (cfg.noiseGate) {
      tasks.push(context.audioWorklet.addModule(noiseGateWorkletUrl));
    }

    const results = await Promise.all(tasks);
    const wasmBinary = results[0] as ArrayBuffer | undefined;

    const source = context.createMediaStreamSource(new MediaStream([track]));
    // Microfone estéreo (muitos fones/placas no Windows entregam 2 canais mesmo pedindo 1, às vezes com som
    // num lado só): mistura em mono antes dos filtros, que só processam o primeiro canal.
    const mono = monoMixer(context);
    source.connect(mono);
    let current: AudioNode = mono;

    if (cfg.noise === "gtcrn" && wasmBinary) {
      const node = new GtcrnWorkletNode(context, { maxChannels: 1, wasmBinary });
      current.connect(node);
      current = node;
      destroyCallbacks.push(() => {
        node.disconnect();
        node.destroy();
      });
    } else if (cfg.noise === "rnnoise" && wasmBinary) {
      const node = new RnnoiseWorkletNode(context, { maxChannels: 1, wasmBinary });
      current.connect(node);
      current = node;
      destroyCallbacks.push(() => {
        node.disconnect();
        node.destroy();
      });
    } else if (cfg.noise === "speex" && wasmBinary) {
      const node = new SpeexWorkletNode(context, { maxChannels: 1, wasmBinary });
      current.connect(node);
      current = node;
      destroyCallbacks.push(() => {
        node.disconnect();
        node.destroy();
      });
    }

    if (cfg.noiseGate) {
      // Histerese de 6 dB entre abrir e fechar evita picotar o final das palavras.
      const openThreshold = cfg.gateThreshold;
      const closeThreshold = Math.max(-80, openThreshold - 6);
      const gate = new NoiseGateWorkletNode(context, {
        openThreshold,
        closeThreshold,
        holdMs: 180,
        maxChannels: 1,
      });
      current.connect(gate);
      current = gate;
      destroyCallbacks.push(() => gate.disconnect());
    }

    const gainNode = context.createGain();
    gainNode.gain.value = cfg.inputGain;
    current.connect(gainNode);
    current = gainNode;
    destroyCallbacks.push(() => gainNode.disconnect());

    if (context.state === "suspended") await context.resume();

    return {
      context,
      source,
      output: current,
      setGain(g: number) {
        gainNode.gain.setTargetAtTime(g, context.currentTime, 0.015);
      },
      destroy() {
        source.disconnect();
        mono.disconnect();
        for (const fn of destroyCallbacks) fn();
        void context.close();
      },
    };
  } catch (err) {
    void context.close();
    throw err;
  }
}

/** Processor do LiveKit: publica na sala a saída filtrada (GTCRN/RNNoise/Speex + Noise Gate + Ganho). */
export class RnnoiseProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  name = "turtle-audio-filter";
  processedTrack?: MediaStreamTrack;
  private graph?: RnnoiseGraph;
  private cfg: AudioFilterConfig;
  private lastOpts?: AudioProcessorOptions;

  constructor(cfg: AudioFilterConfig = { noise: "gtcrn", noiseGate: true, gateThreshold: -50, inputGain: 1 }) {
    this.cfg = { ...cfg };
  }

  async init(opts: AudioProcessorOptions) {
    this.lastOpts = opts;
    const graph = await createRnnoiseGraph(opts.track, this.cfg);
    const dest = graph.context.createMediaStreamDestination();
    dest.channelCount = 1;
    graph.output.connect(dest);
    this.graph = graph;
    this.processedTrack = dest.stream.getAudioTracks()[0];
  }

  async restart(opts: AudioProcessorOptions) {
    await this.destroy();
    await this.init(opts);
  }

  /** Atualiza ganho sem recriar o grafo quando só o ganho mudou. */
  setGain(gain: number) {
    this.cfg.inputGain = gain;
    this.graph?.setGain(gain);
  }

  async destroy() {
    this.processedTrack?.stop();
    this.processedTrack = undefined;
    this.graph?.destroy();
    this.graph = undefined;
  }
}
