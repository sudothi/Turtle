import { SOUND_MAX_MS } from "@turtle/protocol";

/**
 * Confere um WAV do soundboard pelos bytes: PCM 16 bits, 1 ou 2 canais, 8 a 48 kHz, até SOUND_MAX_MS.
 * Devolve o arquivo regravado só com o cabeçalho e os dados (sem metadados nem blocos extras).
 */
export function processSound(input: Buffer): { data: Buffer; durationMs: number } | { error: string } {
  const bad = { error: "envie um áudio WAV PCM de 16 bits (o app converte sozinho)" };
  if (input.length < 44 || input.toString("ascii", 0, 4) !== "RIFF" || input.toString("ascii", 8, 12) !== "WAVE") return bad;
  let fmt: { channels: number; rate: number; bits: number } | undefined;
  let data: Buffer | undefined;
  for (let off = 12; off + 8 <= input.length; ) {
    const id = input.toString("ascii", off, off + 4);
    const size = input.readUInt32LE(off + 4);
    const body = input.subarray(off + 8, Math.min(input.length, off + 8 + size));
    if (id === "fmt ") {
      if (body.length < 16) return bad;
      let format = body.readUInt16LE(0);
      // WAVE_FORMAT_EXTENSIBLE: o formato de verdade está no subformato (os 2 primeiros bytes do GUID).
      if (format === 0xfffe && body.length >= 26) format = body.readUInt16LE(24);
      if (format !== 1) return bad;
      fmt = { channels: body.readUInt16LE(2), rate: body.readUInt32LE(4), bits: body.readUInt16LE(14) };
    } else if (id === "data") {
      data = body;
      break;
    }
    off += 8 + size + (size % 2);
  }
  if (!fmt || !data) return bad;
  if (fmt.bits !== 16 || fmt.channels < 1 || fmt.channels > 2 || fmt.rate < 8000 || fmt.rate > 48000) return bad;
  const block = fmt.channels * 2;
  const pcm = data.subarray(0, data.length - (data.length % block));
  if (!pcm.length) return { error: "áudio vazio" };
  const durationMs = Math.round((pcm.length / block / fmt.rate) * 1000);
  // Uma pequena folga para arredondamentos de quem gravou.
  if (durationMs > SOUND_MAX_MS + 50) return { error: `áudio longo demais (máximo ${SOUND_MAX_MS / 1000} s)` };
  const head = Buffer.alloc(44);
  head.write("RIFF", 0, "ascii");
  head.writeUInt32LE(36 + pcm.length, 4);
  head.write("WAVE", 8, "ascii");
  head.write("fmt ", 12, "ascii");
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(fmt.channels, 22);
  head.writeUInt32LE(fmt.rate, 24);
  head.writeUInt32LE(fmt.rate * block, 28);
  head.writeUInt16LE(block, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36, "ascii");
  head.writeUInt32LE(pcm.length, 40);
  return { data: Buffer.concat([head, pcm]), durationMs };
}
