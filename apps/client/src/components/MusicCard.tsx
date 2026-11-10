import { useEffect, useId, useState, type ReactNode } from "react";
import type { MusicTrack } from "@turtle/protocol";
import { Icon } from "@turtle/ui";
import { api, authedBlobUrl } from "../api";
import { clock, stopMusic, toggleMusic, useMusicPlayback } from "../music";

const tracks = new Map<string, Promise<MusicTrack | null>>();
const covers = new Map<string, Promise<string | null>>();

/** Vinil entalhado: sulcos cortados em traços irregulares e selo com estrela (como as outras gravuras do app). */
function Vinyl() {
  return (
    <svg className="music-vinyl-disc" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <circle cx="50" cy="50" r="48.5" fill="var(--ink-0)" stroke="var(--paper)" strokeWidth="2" />
      {[43, 38.5, 34, 29.5, 25].map((r, i) => (
        <circle key={r} cx="50" cy="50" r={r} fill="none" stroke="var(--paper)" strokeOpacity={0.22 + (i % 2) * 0.1} strokeWidth="1.1"
          strokeDasharray={i % 2 ? "22 3 9 4 30 2" : "14 4 26 3 8 5"} strokeLinecap="round" />
      ))}
      {/* reflexos cortados na goiva */}
      <path d="M22 30 Q30 19 43 15" fill="none" stroke="var(--paper)" strokeOpacity="0.7" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M78 70 Q71 80 60 84" fill="none" stroke="var(--paper)" strokeOpacity="0.45" strokeWidth="2" strokeLinecap="round" />
      <circle cx="50" cy="50" r="16" fill="var(--paper)" />
      <path d="M50 39.5l2.9 6.6 7.1.6-5.4 4.7 1.6 7-6.2-3.7-6.2 3.7 1.6-7-5.4-4.7 7.1-.6z" fill="var(--ink-0)" />
      <circle cx="50" cy="50" r="1.8" fill="var(--paper)" stroke="var(--ink-0)" strokeWidth="1" />
    </svg>
  );
}

/** Cartão de uma faixa do Spotify: capa, vinil que gira enquanto toca a prévia de 30 s, e link para o Spotify. */
export function MusicCard({ url, fallback }: { url: string; fallback: ReactNode }) {
  const [track, setTrack] = useState<MusicTrack | null | undefined>(undefined);
  const [cover, setCover] = useState<string | null>(null);
  const playback = useMusicPlayback();
  const owner = useId();

  useEffect(() => {
    let alive = true;
    let job = tracks.get(url);
    if (!job) { job = api.musicTrack(url).catch(() => null); tracks.set(url, job); }
    void job.then((t) => alive && setTrack(t));
    return () => { alive = false; };
  }, [url]);

  useEffect(() => {
    if (!track?.hasCover) return;
    let alive = true;
    let job = covers.get(track.id);
    if (!job) { job = authedBlobUrl(`/music/${track.id}/cover`).catch(() => null); covers.set(track.id, job); }
    void job.then((c) => alive && setCover(c));
    return () => { alive = false; };
  }, [track]);

  // Trocou de canal ou a mensagem sumiu: a música para junto.
  useEffect(() => () => stopMusic(owner), [owner]);

  if (track === undefined) return null;
  if (track === null) return <>{fallback}</>;

  const mine = playback.owner === owner;
  const playing = mine && playback.playing;
  const loading = mine && playback.loading;
  const error = mine ? playback.error : null;
  const duration = mine && playback.duration ? playback.duration : 30;
  const progress = mine ? Math.min(1, playback.position / duration) : 0;
  const canPlay = track.previewSource !== null;
  const label = `${track.title}${track.artist ? ` de ${track.artist}` : ""}`;

  return (
    <div className={`music-card lino${playing ? " is-playing" : ""}${mine && (playing || loading) ? " is-out" : ""}`} role="group" aria-label={`Música: ${label}`}>
      <div className="music-art">
        <div className="music-vinyl"><Vinyl /></div>
        <div className="music-cover">
          {cover ? <img src={cover} alt="" draggable={false} /> : <Icon name="music" size={30} />}
          {canPlay && (
            <button type="button" className="music-play" onClick={() => void toggleMusic(owner, track.id)}
              aria-label={playing ? `Pausar prévia de ${label}` : `Tocar prévia de ${label}`} title={playing ? "Pausar" : "Tocar prévia"} aria-busy={loading || undefined}>
              <Icon name={playing ? "pause" : "play"} size={22} />
            </button>
          )}
        </div>
      </div>
      <div className="music-info">
        <span className="music-src t-muted">Spotify{canPlay ? " · prévia via Deezer" : ""}</span>
        <b className="music-title" title={track.title}>{track.title}</b>
        {track.artist && <span className="music-artist" title={track.artist}>{track.artist}</span>}
        {canPlay ? (
          <div className="music-time">
            <span className="music-bar" aria-hidden="true"><span style={{ width: `${progress * 100}%` }} /></span>
            <span className="t-muted">{error ?? (loading ? "carregando…" : `${clock(mine ? playback.position : 0)} / ${clock(duration)}`)}</span>
          </div>
        ) : (
          <span className="music-time t-muted">sem prévia para esta faixa</span>
        )}
        <a className="music-open" href={track.url} target="_blank" rel="noopener noreferrer">Abrir no Spotify</a>
      </div>
    </div>
  );
}
