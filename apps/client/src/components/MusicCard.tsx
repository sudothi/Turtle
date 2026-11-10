import { useEffect, useId, useState, type ReactNode } from "react";
import type { MusicTrack } from "@turtle/protocol";
import { Icon } from "@turtle/ui";
import { api } from "../api";
import { clock, musicCover, stopMusic, toggleMusic, useMusicPlayback } from "../music";

const tracks = new Map<string, Promise<MusicTrack | null>>();

/** Vinil entalhado: sulcos cortados em traços irregulares e a capa no selo (estrela quando não há capa). */
function Vinyl({ cover }: { cover: string | null }) {
  const clip = `music-label-${useId().replace(/:/g, "")}`;
  return (
    <svg className="music-vinyl-disc" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <circle cx="50" cy="50" r="49" fill="var(--ink-0)" />
      {[45, 41, 37, 33.5].map((r, i) => (
        <circle key={r} cx="50" cy="50" r={r} fill="none" stroke="var(--paper)" strokeOpacity={0.16 + (i % 2) * 0.08} strokeWidth="0.9"
          strokeDasharray={i % 2 ? "22 3 9 4 30 2" : "14 4 26 3 8 5"} strokeLinecap="round" />
      ))}
      {/* reflexos cortados na goiva */}
      <path d="M20 31 Q28 18 42 13" fill="none" stroke="var(--paper)" strokeOpacity="0.55" strokeWidth="2" strokeLinecap="round" />
      <path d="M80 69 Q73 81 61 86" fill="none" stroke="var(--paper)" strokeOpacity="0.35" strokeWidth="1.6" strokeLinecap="round" />
      <defs><clipPath id={clip}><circle cx="50" cy="50" r="22" /></clipPath></defs>
      <circle cx="50" cy="50" r="22" fill="var(--paper)" />
      {cover ? (
        <image href={cover} x="28" y="28" width="44" height="44" preserveAspectRatio="xMidYMid slice" clipPath={`url(#${clip})`} className="music-label-img" />
      ) : (
        <path d="M50 37l3.5 8 8.6.8-6.5 5.7 1.9 8.5-7.5-4.5-7.5 4.5 1.9-8.5-6.5-5.7 8.6-.8z" fill="var(--ink-0)" />
      )}
      <circle cx="50" cy="50" r="2.2" fill="var(--ink-0)" stroke="var(--paper)" strokeWidth="0.8" />
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
    void musicCover(track.id).then((c) => alive && setCover(c));
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
  const art = (
    <>
      {cover ? <img src={cover} alt="" draggable={false} /> : <span className="music-cover-empty"><Icon name="music" size={44} /></span>}
      <span className="music-shade" aria-hidden="true" />
      {canPlay && <span className="music-state" aria-hidden="true"><Icon name={playing ? "pause" : "play"} size={16} /></span>}
      <span className="music-names">
        <b>{track.title}</b>
        {track.artist && <span>{track.artist}</span>}
        {error && <span className="music-error">{error}</span>}
      </span>
      {mine && <span className="music-bar" aria-hidden="true"><span style={{ width: `${progress * 100}%` }} /></span>}
    </>
  );

  return (
    <div className={`music-card${playing ? " is-playing" : ""}${loading ? " is-loading" : ""}`} role="group" aria-label={`Música: ${label}`}>
      <div className="music-vinyl"><Vinyl cover={cover} /></div>
      {canPlay ? (
        <button type="button" className="music-cover lino" onClick={() => void toggleMusic(owner, track.id)}
          aria-label={playing ? `Pausar prévia de ${label}` : `Tocar prévia de ${label}`}
          title={`${playing ? "Pausar" : "Tocar"} prévia de 30 s (via Deezer)${mine && !loading ? ` · ${clock(playback.position)}` : ""}`} aria-busy={loading || undefined}>
          {art}
        </button>
      ) : (
        <a className="music-cover lino" href={track.url} target="_blank" rel="noopener noreferrer" title="Sem prévia para esta faixa · abrir no Spotify">{art}</a>
      )}
      <a className="music-open" href={track.url} target="_blank" rel="noopener noreferrer" aria-label={`Abrir ${label} no Spotify`} title="Abrir no Spotify">
        <Icon name="external" size={14} />
      </a>
    </div>
  );
}
