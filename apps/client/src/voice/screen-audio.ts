import { desktop } from "../desktop";
// no-inline: arquivo próprio (não data:), para valer com a CSP script-src 'self'.
import workletUrl from "./pcm-worklet.js?url&no-inline";

/**
 * Áudio da transmissão vindo do app desktop (captura por processo no Windows):
 * tela inteira = PC todo menos o Turtle; janela = só aquele programa.
 * Vira uma MediaStreamTrack para publicar como ScreenShareAudio.
 */
export class DesktopShareAudio {
  private off?: () => void;
  private constructor(
    private readonly ctx: AudioContext,
    readonly track: MediaStreamTrack,
    readonly mode: "screen" | "window",
  ) {}

  /** Crie o AudioContext ainda no clique (autoplay); `start` termina depois que a fonte foi escolhida. */
  static context() {
    return new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
  }

  static async start(ctx: AudioContext): Promise<DesktopShareAudio | { reason: string }> {
    const bridge = desktop()?.shareAudio;
    if (!bridge) return { reason: "unsupported" };
    await ctx.audioWorklet.addModule(workletUrl);
    const node = new AudioWorkletNode(ctx, "turtle-pcm", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    const dest = ctx.createMediaStreamDestination();
    dest.channelCount = 2;
    node.connect(dest);
    const off = bridge.onData((chunk) => {
      // Cópia alinhada (Int16Array exige offset par); transferida sem copiar de novo.
      const buf = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer;
      node.port.postMessage(buf, [buf]);
    });
    const res = await bridge.start();
    if (!res.ok || !res.mode) {
      off();
      void ctx.close().catch(() => {});
      return { reason: res.reason ?? "failed" };
    }
    await ctx.resume().catch(() => {});
    const a = new DesktopShareAudio(ctx, dest.stream.getAudioTracks()[0]!, res.mode);
    a.off = off;
    return a;
  }

  stop() {
    this.off?.();
    this.off = undefined;
    desktop()?.shareAudio?.stop();
    this.track.stop();
    void this.ctx.close().catch(() => {});
  }
}

/** Este app desktop captura o áudio por processo (instalador novo, Windows 10 2004+). */
export async function desktopShareAudioSupported() {
  try {
    return (await desktop()?.shareAudio?.supported()) === true;
  } catch {
    return false;
  }
}
