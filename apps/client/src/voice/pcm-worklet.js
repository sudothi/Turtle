// Toca no grafo de áudio o PCM que chega do app desktop (16 bits, estéreo intercalado, 48 kHz).
// Fila curta: junta ~40 ms antes de começar, e se acumular mais de 200 ms descarta o atraso.
const CAP = 48000; // 1 s por canal
const START = 1920; // 40 ms
const MAX = 9600; // 200 ms
const KEEP = 2400; // volta para 50 ms quando atrasa

class TurtlePcm extends AudioWorkletProcessor {
  constructor() {
    super();
    this.l = new Float32Array(CAP);
    this.r = new Float32Array(CAP);
    this.w = 0;
    this.rd = 0;
    this.n = 0;
    this.playing = false;
    this.port.onmessage = (e) => this.push(new Int16Array(e.data));
  }

  push(s) {
    const frames = s.length >> 1;
    for (let i = 0; i < frames; i++) {
      this.l[this.w] = s[2 * i] / 32768;
      this.r[this.w] = s[2 * i + 1] / 32768;
      this.w = (this.w + 1) % CAP;
    }
    this.n += frames;
    if (this.n > CAP) this.n = CAP;
    if (this.n > MAX) {
      this.rd = (this.w - KEEP + CAP) % CAP;
      this.n = KEEP;
    }
  }

  process(_inputs, outputs) {
    const [ol, or] = outputs[0];
    const len = ol.length;
    if (!this.playing && this.n >= START) this.playing = true;
    if (!this.playing || this.n < len) {
      // Faltou áudio (silêncio no PC ou atraso): espera encher de novo.
      this.playing = false;
      return true;
    }
    for (let i = 0; i < len; i++) {
      ol[i] = this.l[this.rd];
      if (or) or[i] = this.r[this.rd];
      this.rd = (this.rd + 1) % CAP;
    }
    this.n -= len;
    return true;
  }
}

registerProcessor("turtle-pcm", TurtlePcm);
