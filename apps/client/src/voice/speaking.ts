/**
 * Quem está falando, medido aqui mesmo no áudio que chega (e no meu microfone).
 *
 * O "isSpeaking" do LiveKit vem do servidor: ele junta os níveis de áudio em janelas de ~500 ms e suaviza
 * algumas delas antes de avisar, então o anel branco acendia um ou dois segundos depois da pessoa começar.
 * Aqui o nível é lido a cada 50 ms: acende na hora e apaga depois de uma pausa curta (HOLD_MS), para não piscar
 * entre as palavras.
 */
const TICK_MS = 50;
const HOLD_MS = 350;
/** Abaixo disto (dBFS) é silêncio. Com o filtro de ruído e o DTX, o fundo fica bem abaixo de -60. */
const THRESHOLD_DB = -50;

interface Probe {
  track: MediaStreamTrack;
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  buf: Float32Array<ArrayBuffer>;
  lastLoud: number;
}

export class SpeakingDetector {
  private ctx?: AudioContext;
  private probes = new Map<string, Probe>();
  private timer?: ReturnType<typeof setInterval>;
  private speaking = new Set<string>();

  /** `tracks` devolve, a cada leitura, a track de microfone de cada pessoa (id -> track). */
  constructor(private tracks: () => Map<string, MediaStreamTrack>, private onChange: () => void) {}

  start() {
    if (this.timer) return;
    try {
      this.ctx = new AudioContext();
    } catch {
      return; // sem Web Audio: fica o indicador do servidor
    }
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    for (const id of [...this.probes.keys()]) this.drop(id);
    void this.ctx?.close().catch(() => {});
    this.ctx = undefined;
    this.speaking.clear();
  }

  /** Volta o AudioContext depois de um clique (o navegador pode criá-lo suspenso). */
  resume() {
    if (this.ctx?.state === "suspended") void this.ctx.resume().catch(() => {});
  }

  /** `undefined` quando não dá para medir esta pessoa aqui (use o indicador do servidor). */
  isSpeaking(id: string): boolean | undefined {
    if (this.ctx?.state !== "running" || !this.probes.has(id)) return undefined;
    return this.speaking.has(id);
  }

  private drop(id: string) {
    const p = this.probes.get(id);
    if (!p) return;
    p.source.disconnect();
    this.probes.delete(id);
  }

  private tick() {
    const ctx = this.ctx;
    if (!ctx) return;
    // Criado sem clique (ex.: ao voltar de uma queda): o navegador deixa retomar depois que a página já teve interação.
    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => {});
      return;
    }
    const wanted = this.tracks();
    // A track muda quando o filtro de ruído liga/desliga ou a pessoa troca de microfone: refaz a sonda.
    for (const [id, p] of this.probes) if (wanted.get(id) !== p.track || p.track.readyState === "ended") this.drop(id);
    for (const [id, track] of wanted) {
      if (this.probes.has(id) || track.readyState === "ended") continue;
      try {
        const source = ctx.createMediaStreamSource(new MediaStream([track]));
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        this.probes.set(id, { track, source, analyser, buf: new Float32Array(analyser.fftSize), lastLoud: -Infinity });
      } catch {
        /* track sem áudio ainda: tenta na próxima */
      }
    }

    const now = performance.now();
    let changed = false;
    for (const [id, p] of this.probes) {
      p.analyser.getFloatTimeDomainData(p.buf);
      let sum = 0;
      for (const v of p.buf) sum += v * v;
      const db = 10 * Math.log10(sum / p.buf.length || 1e-12);
      if (db > THRESHOLD_DB && p.track.enabled && !p.track.muted) p.lastLoud = now;
      const on = now - p.lastLoud < HOLD_MS;
      if (on !== this.speaking.has(id)) {
        changed = true;
        if (on) this.speaking.add(id);
        else this.speaking.delete(id);
      }
    }
    for (const id of [...this.speaking]) {
      if (!this.probes.has(id)) {
        this.speaking.delete(id);
        changed = true;
      }
    }
    if (changed) this.onChange();
  }
}
