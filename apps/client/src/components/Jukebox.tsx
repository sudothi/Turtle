import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { JUKEBOX_MAX_MS, JUKEBOX_MAX_QUEUE, type JukeboxItem, type JukeboxState, type MusicTrack, type VoiceState } from "@turtle/protocol";
import { Avatar, Icon, IconButton } from "@turtle/ui";
import { api, fileUrl } from "../api";
import { jukebox, looksLikeLink, useJukebox, useJukeboxPosition, withScheme } from "../jukebox";
import { clock, coverTint, musicCover } from "../music";
import { Vinyl } from "./MusicCard";

/** Nome de quem colocou a música (apelido no servidor, se tiver). */
export type NameOf = (userId: string) => string;

const sourceLabel: Record<JukeboxItem["source"], string> = { youtube: "YouTube", soundcloud: "SoundCloud", bandcamp: "Bandcamp", deezer: "Deezer" };

function useTint(cover: string | null) {
  const [tint, setTint] = useState<{ disc: string; groove: string } | null>(null);
  useEffect(() => {
    setTint(null);
    if (!cover) return;
    let alive = true;
    void coverTint(cover).then((t) => alive && setTint(t));
    return () => { alive = false; };
  }, [cover]);
  return tint ? ({ "--disc": tint.disc, "--groove": tint.groove } as CSSProperties) : undefined;
}

function Cover({ src, size }: { src: string | null; size: number }) {
  return src ? <img className="jb-thumb" src={src} alt="" width={size} height={size} draggable={false} /> : <span className="jb-thumb" style={{ width: size, height: size }}><Icon name="music" size={Math.round(size / 2.6)} /></span>;
}

/**
 * Cartão do canto inferior esquerdo da chamada: capa com o vinil saindo por trás (girando enquanto toca),
 * nome da música e quem colocou. Mesmo visual do cartão de música do chat, em tamanho menor.
 */
export function JukeboxNowPlaying({ channelId, nameOf }: { channelId: string; nameOf: NameOf }) {
  const { states, blocked } = useJukebox();
  const s = states[channelId];
  const pos = useJukeboxPosition(channelId);
  const style = useTint(s?.current?.cover ?? null);
  const cur = s?.current;
  if (!cur) return null;
  const playing = s.startedAt !== null && s.pausedAt === null;
  const state = cur.status === "loading" ? "carregando…" : s.pausedAt !== null ? "pausada" : null;
  return (
    <div className={`jb-now${playing ? " is-playing" : ""}`} role="status" aria-label={`Tocando na discoteca: ${cur.title}${cur.artist ? ` de ${cur.artist}` : ""}, colocada por ${nameOf(cur.addedBy)}`}>
      <div className="jb-now-art">
        <div className="jb-now-vinyl music-vinyl" style={style}><Vinyl cover={cur.cover} /></div>
        <div className="jb-now-cover lino"><Cover src={cur.cover} size={72} /></div>
      </div>
      <div className="jb-now-text">
        <b title={cur.title}>{cur.title}</b>
        {cur.artist && <span className="jb-now-artist">{cur.artist}</span>}
        <span className="jb-now-by">colocada por {nameOf(cur.addedBy)}{state ? ` · ${state}` : cur.preview ? " · prévia" : ""}</span>
        <span className="jb-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, (pos / cur.durationMs) * 100)}%` }} /></span>
      </div>
      {blocked && (
        <button className="jb-unlock" onClick={() => jukebox.unlock()}>
          <Icon name="speaker" size={14} /> Ativar som
        </button>
      )}
    </div>
  );
}

/** O que o convite no chat precisa da tela: quem está nas chamadas, como entrar e como enviar o convite. */
export interface DiscoActions {
  voiceStates: VoiceState[];
  meId: string;
  nameOf: NameOf;
  /** Mexe em qualquer faixa da discoteca desse servidor (admin do app ou dono/admin do servidor). */
  canManage: (serverId: string) => boolean;
  /** Entra na chamada (e abre ela). */
  join: (channelId: string) => void;
  /** Manda o convite da discoteca dessa chamada para o chat de texto do servidor. */
  invite: (channelId: string) => void;
}
export const DiscoContext = createContext<DiscoActions | null>(null);

/**
 * Convite no chat: "@fulano está te convidando para uma discoteca!", com a música que toca agora e quem está na
 * chamada (só a foto; o nome aparece ao passar o mouse). Atualiza ao vivo.
 */
export function DiscoInviteCard({ channelId, author }: { channelId: string; author: string }) {
  const ctx = useContext(DiscoContext);
  const s = useJukebox().states[channelId];
  const pos = useJukeboxPosition(channelId);
  const cur = s?.current;
  const style = useTint(cur?.cover ?? null);
  const people = ctx?.voiceStates.filter((v) => v.channelId === channelId) ?? [];
  const inCall = !!ctx && people.some((v) => v.userId === ctx.meId);
  const playing = !!s && s.startedAt !== null && s.pausedAt === null;
  const over = !cur && people.length === 0;
  const nameOf = ctx?.nameOf ?? (() => "alguém");
  return (
    <div className={`jb-invite lino${playing ? " is-playing" : ""}`}>
      <div className="jb-invite-head">
        <Icon name="disco" size={18} />
        <span><span className="jb-invite-who">@{author}</span> está te convidando para uma discoteca!</span>
      </div>
      {cur ? (
        <div className="jb-now">
          <div className="jb-now-art">
            <div className="jb-now-vinyl music-vinyl" style={style}><Vinyl cover={cur.cover} /></div>
            <div className="jb-now-cover"><Cover src={cur.cover} size={72} /></div>
          </div>
          <div className="jb-now-text">
            <b title={cur.title}>{cur.title}</b>
            {cur.artist && <span className="jb-now-artist">{cur.artist}</span>}
            <span className="jb-now-by">colocada por {nameOf(cur.addedBy)}{s.pausedAt !== null ? " · pausada" : ""}</span>
            <span className="jb-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, (pos / cur.durationMs) * 100)}%` }} /></span>
          </div>
        </div>
      ) : (
        <div className="jb-invite-empty t-muted">{over ? "A discoteca acabou." : "Nada tocando agora."}</div>
      )}
      {!over && (
        <div className="jb-invite-foot">
          <div className="jb-faces" role="list" aria-label="Quem está na chamada">
            {people.map((v) => {
              const name = v.displayName ?? v.username;
              return (
                <span key={v.userId} className="jb-face" role="listitem" tabIndex={0} data-name={name} aria-label={name}>
                  <Avatar name={name} src={fileUrl(v.avatar)} size={28} />
                </span>
              );
            })}
            {people.length === 0 && <span className="t-muted jb-invite-empty">Ninguém na chamada</span>}
          </div>
          {ctx && !inCall && <button type="button" className="jb-invite-join" onClick={() => ctx.join(channelId)}>Entrar</button>}
        </div>
      )}
    </div>
  );
}

/**
 * Disco no canto do canal de voz da barra lateral (para quem está fora da chamada ver que tem música).
 * Passar o mouse (ou focar) abre um cartão ao lado com o que está tocando.
 */
export function JukeboxChannelBadge({ state, nameOf, shift }: { state: JukeboxState | undefined; nameOf: NameOf; /** Abre espaço para a engrenagem de editar o canal. */ shift?: boolean }) {
  const [at, setAt] = useState<{ left: number; top: number }>();
  const ref = useRef<HTMLSpanElement>(null);
  const hide = useRef<ReturnType<typeof setTimeout>>(undefined);
  const cur = state?.current;
  useEffect(() => () => clearTimeout(hide.current), []);
  if (!cur || !state) return null;
  const playing = state.startedAt !== null && state.pausedAt === null;
  const show = () => {
    clearTimeout(hide.current);
    const r = ref.current?.getBoundingClientRect();
    if (r) setAt({ left: Math.min(r.right + 14, innerWidth - 300), top: r.top + r.height / 2 });
  };
  const leave = () => {
    clearTimeout(hide.current);
    hide.current = setTimeout(() => setAt(undefined), 120);
  };
  const label = `Tocando na discoteca: ${cur.title}${cur.artist ? ` de ${cur.artist}` : ""}${playing ? "" : " (pausada)"}`;
  return (
    <span
      ref={ref} className={`jb-badge${playing ? " is-playing" : ""}${shift ? " shift" : ""}`} tabIndex={0} role="img" aria-label={label}
      onMouseEnter={show} onMouseLeave={leave} onFocus={show} onBlur={leave}
    >
      <Vinyl cover={cur.cover} />
      {at && createPortal(<JukeboxPopout state={state} nameOf={nameOf} at={at} />, document.body)}
    </span>
  );
}

function JukeboxPopout({ state, nameOf, at }: { state: JukeboxState; nameOf: NameOf; at: { left: number; top: number } }) {
  const cur = state.current!;
  const pos = useJukeboxPosition(state.channelId);
  const style = useTint(cur.cover);
  const playing = state.startedAt !== null && state.pausedAt === null;
  return (
    <div className={`jb-pop lino${playing ? " is-playing" : ""}`} role="tooltip" style={{ left: at.left, top: at.top }}>
      <div className="jb-pop-head t-muted"><Icon name="disco" size={14} /> Tocando na discoteca{playing ? "" : " · pausada"}</div>
      <div className="jb-now">
        <div className="jb-now-art">
          <div className="jb-now-vinyl music-vinyl" style={style}><Vinyl cover={cur.cover} /></div>
          <div className="jb-now-cover"><Cover src={cur.cover} size={72} /></div>
        </div>
        <div className="jb-now-text">
          <b title={cur.title}>{cur.title}</b>
          {cur.artist && <span className="jb-now-artist">{cur.artist}</span>}
          <span className="jb-now-by">colocada por {nameOf(cur.addedBy)}</span>
          <span className="jb-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, (pos / cur.durationMs) * 100)}%` }} /></span>
        </div>
      </div>
      {state.queue.length > 0 && <div className="jb-pop-next t-muted">A seguir: {state.queue[0]!.title}{state.queue.length > 1 ? ` e mais ${state.queue.length - 1}` : ""}</div>}
    </div>
  );
}

/** Volume da discoteca (só para mim). */
function JukeboxVolume() {
  const { prefs } = useJukebox();
  return (
    <div className="sb-volume compact">
      <IconButton label={prefs.muted ? "Ativar som da discoteca" : "Silenciar discoteca"} aria-pressed={prefs.muted} onClick={() => jukebox.setPrefs({ muted: !prefs.muted })}>
        <Icon name={prefs.muted ? "speaker-off" : "speaker"} size={18} />
      </IconButton>
      <input
        type="range" min={0} max={1} step={0.05} aria-label="Volume da discoteca (só para você)"
        value={prefs.muted ? 0 : prefs.volume}
        onChange={(e) => jukebox.setPrefs({ volume: Number(e.target.value), muted: false })}
      />
      <span className="sb-volume-pct">{prefs.muted ? "mudo" : `${Math.round(prefs.volume * 100)}%`}</span>
    </div>
  );
}

function SearchThumb({ track }: { track: MusicTrack }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!track.hasCover) return;
    let alive = true;
    void musicCover(track.id).then((c) => alive && setSrc(c));
    return () => { alive = false; };
  }, [track]);
  return <Cover src={src} size={40} />;
}

/** Botão da discoteca nos controles da chamada (ao lado do soundboard). */
export function JukeboxButton({ channelId, nameOf, deafened, compact }: { channelId: string; nameOf: NameOf; deafened: boolean; /** Versão pequena do painel "Voz conectada" (o painel abre para cima, alinhado à esquerda). */ compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ left: number; bottom: number }>();
  const box = useRef<HTMLDivElement>(null);
  const live = !!useJukebox().states[channelId]?.current;
  const toggle = () => {
    if (open) return setOpen(false);
    const r = box.current?.getBoundingClientRect();
    if (r) {
      const w = Math.min(420, innerWidth - 32);
      const want = compact ? r.left : r.left + r.width / 2 - w / 2;
      setPlace({ left: Math.max(16, Math.min(want, innerWidth - w - 16)), bottom: innerHeight - r.top + 10 });
    }
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!box.current?.contains(t) && !t.closest?.(".jb-panel")) setOpen(false);
    };
    const esc = (e: KeyboardEvent | globalThis.KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className={`sb-anchor ${compact ? "side" : ""}`} ref={box}>
      <IconButton label="Discoteca" aria-expanded={open} aria-pressed={open} className={`${compact ? "" : "big"} ${open ? "is-on" : ""} ${live ? "jb-live" : ""}`} onClick={toggle}>
        <Icon name="disco" size={compact ? 20 : 24} />
      </IconButton>
      {open && createPortal(<JukeboxPanel channelId={channelId} nameOf={nameOf} deafened={deafened} place={place} />, document.body)}
    </div>
  );
}

function JukeboxPanel({ channelId, nameOf, deafened, place }: { channelId: string; nameOf: NameOf; deafened: boolean; place?: { left: number; bottom: number } }) {
  const s = useJukebox().states[channelId];
  const pos = useJukeboxPosition(channelId);
  const disco = useContext(DiscoContext);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<MusicTrack[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const isLink = looksLikeLink(q);

  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2 || looksLikeLink(term)) { setResults(null); setSearching(false); return; }
    let alive = true;
    setSearching(true);
    const t = setTimeout(() => {
      api.musicSearch(term)
        .then((r) => alive && setResults(r))
        .catch((e: Error) => alive && setError(e.message))
        .finally(() => alive && setSearching(false));
    }, 350);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);
  useEffect(() => {
    if (!added) return;
    const t = setTimeout(() => setAdded(null), 2500);
    return () => clearTimeout(t);
  }, [added]);

  const add = async (key: string, body: { url: string } | { trackId: string }) => {
    if (adding) return;
    setAdding(key);
    setError(null);
    const typed = q;
    try {
      const item = await api.jukeboxAdd(channelId, body);
      setAdded(`“${item.title}” entrou na fila`);
      // Só limpa o campo se a pessoa não começou a digitar outra coisa enquanto o link abria.
      setQ((now) => (now === typed ? "" : now));
      input.current?.focus();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAdding(null);
    }
  };
  const act = (a: "pause" | "resume" | "skip") => void api.jukeboxAct(channelId, a, a === "skip" ? s?.current?.id : undefined).catch((e: Error) => setError(e.message));
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (isLink) void add("link", { url: withScheme(q) });
    else if (results?.[0]) void add(results[0].id, { trackId: results[0].id });
  };

  const cur = s?.current;
  const paused = !!cur && s.pausedAt !== null;
  const manager = !!s && !!disco?.canManage(s.serverId);
  const mine = (i: JukeboxItem) => manager || i.addedBy === disco?.meId;
  const voted = !!s && !!disco && s.skipVotes.includes(disco.meId);
  const votes = s?.skipVotes.length ?? 0;
  const skipLabel = cur && mine(cur) ? "Pular" : voted ? `Tirar voto para pular (${votes}/${s!.skipNeeded})` : `Votar para pular (${votes}/${s?.skipNeeded ?? 0})`;
  const notice = error ?? s?.notice ?? added;

  return (
    <div className="sb-panel jb-panel lino lino-lg" role="dialog" aria-label="Discoteca" style={place}>
      <div className="sb-head">
        <b className="t-display">Discoteca</b>
        {disco && (
          <IconButton label="Convidar no chat" className="jb-invite-btn" onClick={() => { disco.invite(channelId); setAdded("Convite enviado no chat"); }}>
            <Icon name="user-plus" size={18} />
          </IconButton>
        )}
        <JukeboxVolume />
      </div>

      {cur ? (
        <div className="jb-current">
          <Cover src={cur.cover} size={56} />
          <div className="jb-current-text">
            <b title={cur.title}>{cur.title}</b>
            <span className="t-muted">{[cur.artist, `por ${nameOf(cur.addedBy)}`].filter(Boolean).join(" · ")}</span>
            <span className="jb-current-time t-muted">
              {cur.status === "loading" ? "carregando…" : `${clock(pos / 1000)} / ${clock(cur.durationMs / 1000)}`}
              {cur.preview && " · prévia de 30 s"}
            </span>
            <span className="jb-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, (pos / cur.durationMs) * 100)}%` }} /></span>
          </div>
          <div className="jb-current-ctl">
            {mine(cur) && (
              <IconButton label={paused ? "Continuar" : "Pausar"} onClick={() => act(paused ? "resume" : "pause")}>
                <Icon name={paused ? "play" : "pause"} size={18} />
              </IconButton>
            )}
            <span className="jb-skip">
              <IconButton label={skipLabel} active={voted} onClick={() => act("skip")}>
                <Icon name="skip" size={18} />
              </IconButton>
              {votes > 0 && <span className="jb-skip-count" aria-hidden="true">{votes}/{s.skipNeeded}</span>}
            </span>
          </div>
        </div>
      ) : (
        <p className="jb-empty t-muted">Nada tocando. Busque uma música ou cole um link do YouTube, SoundCloud, Bandcamp, Spotify ou Deezer.</p>
      )}
      {deafened && <p className="sb-note t-muted">Você está ensurdecido: a música volta quando tirar.</p>}

      <div className="jb-search">
        <Icon name={isLink ? "paperclip" : "search"} size={16} />
        <input
          ref={input} type="search" value={q} onChange={(e) => { setQ(e.target.value); setError(null); }} onKeyDown={onKey}
          placeholder="Buscar música ou colar link" aria-label="Buscar música ou colar link" maxLength={500}
        />
      </div>

      {isLink && (
        <button className="jb-row jb-add-link" disabled={!!adding} onClick={() => void add("link", { url: withScheme(q) })}>
          <span className="jb-thumb"><Icon name={adding ? "music" : "plus"} size={18} /></span>
          <span className="jb-row-text"><b>{adding ? "Abrindo link…" : "Colocar este link na fila"}</b><span className="t-muted">{q.trim()}</span></span>
        </button>
      )}
      {!isLink && q.trim().length >= 2 && (
        <ul className="jb-list jb-results" aria-label="Resultados da busca" aria-busy={searching || undefined}>
          {searching && !results && <li className="jb-note t-muted">Buscando…</li>}
          {results && !results.length && <li className="jb-note t-muted">Nada encontrado.</li>}
          {results?.map((t) => (
            <li key={t.id}>
              <button className="jb-row" disabled={!!adding} onClick={() => void add(t.id, { trackId: t.id })} title="Colocar na fila">
                <SearchThumb track={t} />
                <span className="jb-row-text"><b>{t.title}</b>{t.artist && <span className="t-muted">{t.artist}</span>}</span>
                <span className="jb-row-act">{adding === t.id ? <span className="jb-dots" aria-label="adicionando" /> : <Icon name="plus" size={18} />}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {!!s?.queue.length && (
        <>
          <div className="jb-sub t-muted">A seguir · {s.queue.length}</div>
          <ol className="jb-list jb-queue">
            {s.queue.map((i, n) => (
              <li key={i.id} className="jb-row">
                <span className="jb-num t-muted">{n + 1}</span>
                <Cover src={i.cover} size={36} />
                <span className="jb-row-text">
                  <b title={i.title}>{i.title}</b>
                  <span className="t-muted">{[i.artist, `por ${nameOf(i.addedBy)}`].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="jb-dur t-muted">{clock(i.durationMs / 1000)}</span>
                {mine(i) && (
                  <IconButton label={`Tirar ${i.title} da fila`} className="jb-remove" onClick={() => void api.jukeboxRemove(channelId, i.id).catch((e: Error) => setError(e.message))}>
                    <Icon name="close" size={14} />
                  </IconButton>
                )}
              </li>
            ))}
          </ol>
        </>
      )}

      <div className="sb-foot t-muted">
        {notice ? <span role="status" className="sb-notice">{notice}</span> : (
          <span>{s?.queue.length ?? 0} de {JUKEBOX_MAX_QUEUE} na fila · até {JUKEBOX_MAX_MS / 60_000} min por música{cur && cur.source !== "deezer" ? ` · via ${sourceLabel[cur.source]}` : ""}</span>
        )}
      </div>
    </div>
  );
}
