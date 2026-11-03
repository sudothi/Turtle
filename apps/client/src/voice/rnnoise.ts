import type { AudioProcessorOptions, Track, TrackProcessor } from "livekit-client";
import { loadRnnoise, RnnoiseWorkletNode } from "@sapphi-red/web-noise-suppressor";
import rnnoiseWorkletUrl from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url";
import rnnoiseWasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url";
import rnnoiseSimdWasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url";

let wasm: Promise<ArrayBuffer> | undefined;
/** Baixa o RNNoise (wasm, ~100 KB) uma vez só; dá pra chamar cedo para adiantar. */
export const preloadRnnoise = () => (wasm ??= loadRnnoise({ url: rnnoiseWasmUrl, simdUrl: rnnoiseSimdWasmUrl }));

export interface RnnoiseGraph {
  context: AudioContext;
  /** Saída já limpa, para ligar em outros nós (medidor, retorno). */
  output: AudioNode;
  destroy(): void;
}

/**
 * Monta microfone -> RNNoise num AudioContext próprio de 48 kHz.
 * O RNNoise só funciona em 48 kHz, e o contexto da sala pode estar em 44,1 kHz.
 */
export async function createRnnoiseGraph(track: MediaStreamTrack): Promise<RnnoiseGraph> {
  const context = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
  try {
    const [wasmBinary] = await Promise.all([preloadRnnoise(), context.audioWorklet.addModule(rnnoiseWorkletUrl)]);
    const source = context.createMediaStreamSource(new MediaStream([track]));
    const rnnoise = new RnnoiseWorkletNode(context, { maxChannels: 1, wasmBinary });
    source.connect(rnnoise);
    if (context.state === "suspended") await context.resume();
    return {
      context,
      output: rnnoise,
      destroy() {
        source.disconnect();
        rnnoise.disconnect();
        rnnoise.destroy();
        void context.close();
      },
    };
  } catch (err) {
    void context.close();
    throw err;
  }
}

/** Processor do LiveKit: o que é publicado na sala é a saída do RNNoise. */
export class RnnoiseProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  name = "turtle-rnnoise";
  processedTrack?: MediaStreamTrack;
  private graph?: RnnoiseGraph;

  async init({ track }: AudioProcessorOptions) {
    const graph = await createRnnoiseGraph(track);
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

  async destroy() {
    this.processedTrack?.stop();
    this.processedTrack = undefined;
    this.graph?.destroy();
    this.graph = undefined;
  }
}
