import { useEffect, useRef, useState } from "react";
import { micConstraints, needsAudioProcessor, type AudioPrefs, type NoiseMode } from "./prefs";
import { createRnnoiseGraph, type RnnoiseGraph, monoMixer } from "./rnnoise";
import type { VoiceClient } from "./client";
import { desktop, loadShortcuts, loadShowGame, saveShortcuts, saveShowGame, toAccelerator, type Shortcuts } from "../desktop";

const noiseLabels: Record<NoiseMode, string> = {
  gtcrn: "GTCRN (recomendado · rede neural)",
  rnnoise: "RNNoise (leve · voz contínua)",
  speex: "Speex (clássico · ventilador)",
  browser: "Do navegador (WebRTC)",
  off: "Desligada",
};

const noiseHints: Record<NoiseMode, string> = {
  gtcrn: "Rede neural moderna (~190 KB): corta teclado, cliques e ruído de fundo mantendo a voz natural.",
  rnnoise: "Modelo leve (~150 KB): mais suave, mas deixa passar ruídos curtos se a porta de ruído estiver desligada.",
  speex: "Filtro espectral clássico (~55 KB): bom para chiado constante e ventilador, uso mínimo de CPU.",
  browser: "Processamento nativo do navegador/sistema operacional.",
  off: "Sem supressão de ruído (apenas cancelamento de eco e ganho automático do navegador).",
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

const calcDb = (buf: Float32Array) => {
  let sum = 0;
  for (const v of buf) sum += v * v;
  return 20 * Math.log10(Math.sqrt(sum / buf.length) || 1e-8);
};

const dbToPct = (db: number) => Math.max(0, Math.min(1, (db + 60) / 60)) * 100;

/** Atalhos globais de mudo e ensurdecer (só no app desktop): clique no campo e aperte a combinação. */
/** Privacidade: mostrar aos outros o jogo aberto (só jogos da lista; desligado, o detector nem roda). */
function ShowGameSetting() {
  const [on, setOn] = useState(loadShowGame);
  return (
    <label className="check-row">
      <input type="checkbox" checked={on} onChange={(e) => (setOn(e.target.checked), saveShowGame(e.target.checked))} />
      Mostrar o jogo que estou jogando
    </label>
  );
}

function ShortcutSettings() {
  const [keys, setKeys] = useState<Shortcuts>(loadShortcuts);
  const [rec, setRec] = useState<keyof Shortcuts | null>(null);
  const [warn, setWarn] = useState("");
  const set = (which: keyof Shortcuts, value: string) => {
    if (value && keys[which === "mute" ? "deafen" : "mute"] === value) return setWarn("Essa combinação já está em uso pelo outro atalho.");
    setWarn("");
    const next = { ...keys, [which]: value };
    setKeys(next);
    saveShortcuts(next);
  };
  const field = (which: keyof Shortcuts, label: string) => (
    <div className="shortcut-row">
      <span>{label}</span>
      <button
        type="button"
        aria-label={`Atalho de ${label.toLowerCase()}`}
        onClick={() => setRec(which)}
        onBlur={() => setRec(null)}
        onKeyDown={(e) => {
          if (rec !== which) return;
          e.preventDefault();
          if (e.key === "Escape") return setRec(null);
          if (e.key === "Backspace" || e.key === "Delete") { setRec(null); return set(which, ""); }
          const acc = toAccelerator(e.nativeEvent);
          if (acc) { setRec(null); set(which, acc); }
        }}
      >
        {rec === which ? "Aperte a combinação…" : keys[which] || "Sem atalho"}
      </button>
    </div>
  );
  return (
    <div className="voice-field">
      <h4>Atalhos globais</h4>
      {field("mute", "Mutar")}
      {field("deafen", "Ensurdecer")}
      <p className="dim">Funcionam até com o jogo em tela cheia. Backspace limpa o atalho. Aperte-para-falar ainda não está disponível.</p>
      {warn && <p role="alert" className="dim">{warn}</p>}
    </div>
  );
}

/** Teste de microfone: medidor de nível (entrada vs filtrado) e, opcionalmente, ouvir a si mesmo com o filtro escolhido. */
function MicTest({ prefs }: { prefs: AudioPrefs }) {
  const [on, setOn] = useState(false);
  const [loopback, setLoopback] = useState(false);
  const [rawDb, setRawDb] = useState(-60);
  const [outDb, setOutDb] = useState(-60);
  const [error, setError] = useState("");
  const audio = useRef<HTMLAudioElement>(null);
  const graphRef = useRef<RnnoiseGraph | undefined>(undefined);

  useEffect(() => {
    graphRef.current?.setGain(prefs.inputGain);
  }, [prefs.inputGain]);

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
        let rawNode: AudioNode;
        let output: AudioNode;
        if (needsAudioProcessor(prefs)) {
          graph = await createRnnoiseGraph(track, prefs);
          graphRef.current = graph;
          ctx = graph.context;
          rawNode = graph.source;
          output = graph.output;
        } else {
          ctx = new AudioContext({ sampleRate: 48000 });
          rawNode = ctx.createMediaStreamSource(stream);
          output = monoMixer(ctx);
          rawNode.connect(output);
        }
        if (stopped) return;
        const rawAnalyser = ctx.createAnalyser();
        rawAnalyser.fftSize = 1024;
        rawNode.connect(rawAnalyser);

        const outAnalyser = ctx.createAnalyser();
        outAnalyser.fftSize = 1024;
        output.connect(outAnalyser);

        const dest = ctx.createMediaStreamDestination();
        output.connect(dest);
        if (audio.current) {
          audio.current.srcObject = dest.stream;
          if (prefs.outputId !== "default" && "setSinkId" in audio.current)
            await (audio.current as HTMLAudioElement & { setSinkId(id: string): Promise<void> }).setSinkId(prefs.outputId).catch(() => {});
        }
        const rawBuf = new Float32Array(rawAnalyser.fftSize);
        const outBuf = new Float32Array(outAnalyser.fftSize);
        const tick = () => {
          rawAnalyser.getFloatTimeDomainData(rawBuf);
          outAnalyser.getFloatTimeDomainData(outBuf);
          setRawDb(calcDb(rawBuf));
          setOutDb(calcDb(outBuf));
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
      graphRef.current = undefined;
      if (graph) graph.destroy();
      else void ctx?.close();
      if (audio.current) audio.current.srcObject = null;
      setRawDb(-60);
      setOutDb(-60);
    };
  }, [on, prefs.inputId, prefs.outputId, prefs.noise, prefs.noiseGate, prefs.gateThreshold]);

  const gatePct = dbToPct(prefs.gateThreshold);

  return (
    <div className="mictest">
      <div className="meter-group">
        <div className="meter-head">
          <span>Entrada vs. saída filtrada</span>
          {on && <span className="t-muted">{Math.max(-60, Math.round(outDb))} dB</span>}
        </div>
        <div className="meter" title="Barra clara: áudio enviado · Barra escura ao fundo: ruído captado antes do filtro">
          <div className="meter-raw" style={{ width: `${dbToPct(rawDb)}%` }} />
          <div className="meter-out" style={{ width: `${dbToPct(outDb)}%` }} />
          {prefs.noiseGate && <span className="meter-gate" style={{ left: `${gatePct}%` }} title={`Porta de ruído: ${prefs.gateThreshold} dB`} />}
        </div>
      </div>
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

/** Configurações > Voz: dispositivos, supressão de ruído, ganho e teste do microfone. */
export function VoiceSettings({ voice, prefs }: { voice: VoiceClient; prefs: AudioPrefs }) {
  const [devices, setDevices] = useState<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] }>({ inputs: [], outputs: [] });

  useEffect(() => {
    const load = () => listDevices().then(setDevices);
    void load();
    navigator.mediaDevices.addEventListener("devicechange", load);
    return () => navigator.mediaDevices.removeEventListener("devicechange", load);
  }, []);

  const name = (d: MediaDeviceInfo, i: number) => d.label || (d.kind === "audioinput" ? `Microfone ${i + 1}` : `Saída ${i + 1}`);
  const gainPct = Math.round(prefs.inputGain * 100);

  return (
    <div className="settings-voice">
      <div className="panel">
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
          <span className="field-note">{noiseHints[prefs.noise]}</span>
        </label>
        <div className="voice-gate-box">
          <label className="check">
            <input type="checkbox" checked={prefs.noiseGate} onChange={(e) => void voice.setNoiseGate(e.target.checked)} />
            Porta de ruído (corta som abaixo de {prefs.gateThreshold} dB)
          </label>
          {prefs.noiseGate && (
            <input
              className="voice-slider"
              type="range"
              min={-70}
              max={-20}
              step={2}
              aria-label="Limiar da porta de ruído em dB"
              value={prefs.gateThreshold}
              onChange={(e) => void voice.setGateThreshold(Number(e.target.value))}
            />
          )}
        </div>
        <label>
          <span>Ganho do microfone ({gainPct}%)</span>
          <input
            className="voice-slider"
            type="range"
            min={0.25}
            max={2.5}
            step={0.05}
            aria-label="Ganho do microfone"
            value={prefs.inputGain}
            onChange={(e) => void voice.setInputGain(Number(e.target.value))}
          />
        </label>
        <MicTest prefs={prefs} />
        {desktop()?.setShortcuts && <ShortcutSettings />}
        {desktop()?.setActivityEnabled && <ShowGameSetting />}
        <p className="dim">Cancelamento de eco e ganho automático ficam sempre ligados. Áudio Opus 48 kHz, 64 kb/s.</p>
      </div>
    </div>
  );
}
