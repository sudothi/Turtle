import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { MusicTrack } from "@turtle/protocol";
import { Icon } from "@turtle/ui";
import { api } from "../api";
import { musicCover, stopMusic, toggleMusic, useMusicPlayback } from "../music";

function Thumb({ id }: { id: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void musicCover(id).then((c) => alive && setSrc(c));
    return () => { alive = false; };
  }, [id]);
  return src ? <img className="music-pick-thumb" src={src} alt="" /> : <span className="music-pick-thumb"><Icon name="music" size={18} /></span>;
}

/** Busca de música para enviar no chat: digita, ouve a prévia se quiser e clica para enviar o cartão. */
export function MusicPicker({ onPick, onClose }: { onPick: (track: MusicTrack) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<MusicTrack[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const playback = useMusicPlayback();
  const box = useRef<HTMLInputElement>(null);

  useEffect(() => { box.current?.focus(); }, []);
  // Fechou a busca: para a prévia que estava tocando nela.
  useEffect(() => () => stopMusic("busca:*"), []);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults(null); setError(null); return; }
    let alive = true;
    setBusy(true);
    const t = setTimeout(() => {
      api.musicSearch(term)
        .then((r) => { if (alive) { setResults(r); setActive(0); setError(null); } })
        .catch((e: Error) => alive && setError(e.message))
        .finally(() => alive && setBusy(false));
    }, 350);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (!results?.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a + (e.key === "ArrowDown" ? 1 : results.length - 1)) % results.length);
    }
    if (e.key === "Enter") { e.preventDefault(); onPick(results[active]!); }
  };

  return (
    <div className="music-picker lino" role="dialog" aria-label="Enviar música">
      <div className="music-picker-head">
        <Icon name="search" size={16} />
        <input ref={box} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Buscar música ou artista" aria-label="Buscar música" maxLength={100} />
        <button type="button" className="plain-btn" onClick={onClose} aria-label="Fechar busca de música" title="Fechar (Esc)"><Icon name="close" size={16} /></button>
      </div>
      <ul className="music-picker-list" role="listbox" aria-label="Resultados" aria-busy={busy || undefined}>
        {q.trim().length < 2 && <li className="music-picker-note t-muted">Digite o nome da música ou do artista.</li>}
        {error && <li className="music-picker-note t-muted">{error}</li>}
        {results?.length === 0 && !busy && <li className="music-picker-note t-muted">Nada encontrado.</li>}
        {results?.map((t, i) => {
          const owner = `busca:${t.id}`;
          const playing = playback.owner === owner && playback.playing;
          return (
            <li key={t.id} role="option" aria-selected={i === active} className={`music-pick${i === active ? " active" : ""}`} onMouseEnter={() => setActive(i)}>
              <button type="button" className="music-pick-send" onClick={() => onPick(t)} title="Enviar no chat">
                <Thumb id={t.id} />
                <span className="music-pick-names">
                  <b>{t.title}</b>
                  <span className="t-muted">{t.artist}</span>
                </span>
              </button>
              {t.previewSource && (
                <button type="button" className="music-pick-play" onClick={() => void toggleMusic(owner, t.id)}
                  aria-label={playing ? `Pausar ${t.title}` : `Ouvir prévia de ${t.title}`} title={playing ? "Pausar" : "Ouvir prévia"}>
                  <Icon name={playing ? "pause" : "play"} size={14} />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="music-picker-foot t-muted">Prévias de 30 s via Deezer</p>
    </div>
  );
}
