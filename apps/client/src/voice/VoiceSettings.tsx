import { useEffect, useRef, useState } from "react";
import { micConstraints, type AudioPrefs, type NoiseMode } from "./prefs";
import { createRnnoiseGraph, type RnnoiseGraph } from "./rnnoise";
import type { VoiceClient } from "./client";

const noiseLabels: Record<NoiseMode, string> = {
  rnnoise: "RNNoise (recomendado)",
  browser: "Do navegador",
  off: "Desligada",
};

async function listDevices() {
  // Os nomes dos dispositivos só aparecem depois da permissão do microfone.
  let devices = await navigator.mediaDevices.enumerateDevices();
  if (!devices.some((d) => d.kind === "audioinput" && d.label)) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      devices = await navigator.mediaDevices.enumerateDevices();
    } catch {
      // sem permissão: lista sem nomes
    }
  }
  return {
    inputs: devices.filter((d) => d.kind === "audioinput"),
    outputs: devices.filter((d) => d.kind === "audiooutput"),
  };
}

/** Teste de microfone: medidor de nível e, opcionalmente, ouvir a si mesmo com o filtro escolhido. */
function MicTest({ prefs }: { prefs: AudioPrefs }) {
  const [on, setOn] = useState(false);
  const [loopback, setLoopback] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState("");
  const audio = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (!on) return;
    let stopped = false;
    let raf = 0;
    let stream: MediaStream | undefined;
    let graph: RnnoiseGraph | undefined;
    let ctx: AudioContext | undefined;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(prefs) });
        if (stopped) return stream.getTracks().forEach((t) => t.stop());
        const track = stream.getAudioTracks()[0]!;
        let output: AudioNode;
        if (prefs.noise === "rnnoise") {
          graph = await createRnnoiseGraph(track);
          ctx = graph.context;
          output = graph.output;
        } else {
          ctx = new AudioContext({ sampleRate: 48000 });
          output = ctx.createMediaStreamSource(stream);
        }
        if (stopped) return;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        output.connect(analyser);
        const dest = ctx.createMediaStreamDestination();
        output.connect(dest);
        if (audio.current) {
          audio.current.srcObject = dest.stream;
          if (prefs.outputId !== "default" && "setSinkId" in audio.current)
            await (audio.current as HTMLAudioElement & { setSinkId(id: string): Promise<void> }).setSinkId(prefs.outputId).catch(() => {});
        }
        const buf = new Float32Array(analyser.fftSize);
        const tick = () => {
          analyser.getFloatTimeDomainData(buf);
          let sum = 0;
          for (const v of buf) sum += v * v;
          const db = 20 * Math.log10(Math.sqrt(sum / buf.length) || 1e-8);
          setLevel(Math.max(0, Math.min(1, (db + 60) / 60)));
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch (err) {
        setError((err as Error).message);
        setOn(false);
      }
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      if (graph) graph.destroy();
      else void ctx?.close();
      if (audio.current) audio.current.srcObject = null;
      setLevel(0);
    };
  }, [on, prefs.inputId, prefs.outputId, prefs.noise]);

  return (
    <div className="mictest">
      <div className="meter"><div style={{ width: `${level * 100}%` }} /></div>
      <div className="row">
        <button type="button" onClick={() => { setError(""); setOn(!on); }}>{on ? "Parar teste" : "Testar microfone"}</button>
        <label className="check">
          <input type="checkbox" checked={loopback} onChange={(e) => setLoopback(e.target.checked)} /> ouvir minha voz
        </label>
      </div>
      {error && <div className="err">{error}</div>}
      <audio ref={audio} autoPlay muted={!loopback} />
    </div>
  );
}

export function VoiceSettings({ voice, prefs, onClose }: { voice: VoiceClient; prefs: AudioPrefs; onClose: () => void }) {
  const [devices, setDevices] = useState<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] }>({ inputs: [], outputs: [] });

  useEffect(() => {
    const load = () => listDevices().then(setDevices);
    void load();
    navigator.mediaDevices.addEventListener("devicechange", load);
    return () => navigator.mediaDevices.removeEventListener("devicechange", load);
  }, []);

  const name = (d: MediaDeviceInfo, i: number) => d.label || (d.kind === "audioinput" ? `Microfone ${i + 1}` : `Saída ${i + 1}`);

  return (
    <div className="modal" role="dialog" aria-label="Configurações de voz" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <h2>Voz</h2>
        <label>
          Microfone
          <select value={prefs.inputId} onChange={(e) => void voice.setInput(e.target.value)}>
            {!devices.inputs.some((d) => d.deviceId === "default") && <option value="default">Padrão do sistema</option>}
            {devices.inputs.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{name(d, i)}</option>)}
          </select>
        </label>
        <label>
          Saída de áudio
          <select value={prefs.outputId} onChange={(e) => void voice.setOutput(e.target.value)}>
            {!devices.outputs.some((d) => d.deviceId === "default") && <option value="default">Padrão do sistema</option>}
            {devices.outputs.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{name(d, i)}</option>)}
          </select>
        </label>
        <label>
          Supressão de ruído
          <select value={prefs.noise} onChange={(e) => void voice.setNoise(e.target.value as NoiseMode)}>
            {(Object.keys(noiseLabels) as NoiseMode[]).map((k) => <option key={k} value={k}>{noiseLabels[k]}</option>)}
          </select>
        </label>
        <MicTest prefs={prefs} />
        <p className="dim">Cancelamento de eco e ganho automático ficam sempre ligados. Áudio Opus 48 kHz, 64 kb/s.</p>
        <button type="button" onClick={onClose}>Fechar</button>
      </div>
    </div>
  );
}
