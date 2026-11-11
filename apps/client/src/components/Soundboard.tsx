import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import {
  MAX_SOUNDS_PER_SERVER, SOUND_COOLDOWN_MS, SOUND_MAX_MS, SOUND_NAME_MAX, canAddSound, canEditSound, soundIcons,
  type Server, type Sound, type SoundIcon as SoundIconId,
} from "@turtle/protocol";
import { Button, Icon, IconButton, Modal, SoundIcon, TextField } from "@turtle/ui";
import { api } from "../api";
import { decodeFile, encodeWav, soundboard, type SoundboardState } from "../soundboard";

export const useSoundboard = (): SoundboardState => useSyncExternalStore(soundboard.subscribe, soundboard.getState);

/** Nome de cada ícone (para leitor de tela e dica ao passar o mouse). */
const iconLabel: Record<SoundIconId, string> = {
  turtle: "Tartaruga", fish: "Peixe", cat: "Gato", star: "Estrela", wave: "Onda", shell: "Concha", bubble: "Bolha", horn: "Buzina",
  bell: "Sino", drum: "Tambor", skull: "Caveira", heart: "Coração", laugh: "Risada", ghost: "Fantasma", bomb: "Bomba", crown: "Coroa",
  moon: "Lua", sun: "Sol", anchor: "Âncora", duck: "Pato",
};

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Volume do soundboard (0 a 200%) e o botão de silenciar tudo. Aparece no painel e nas Configurações de voz. */
export function SoundboardVolume({ compact }: { compact?: boolean }) {
  const { prefs } = useSoundboard();
  return (
    <div className={`sb-volume ${compact ? "compact" : ""}`}>
      <IconButton label={prefs.muted ? "Ativar som do soundboard" : "Silenciar soundboard"} aria-pressed={prefs.muted} onClick={() => soundboard.setMuted(!prefs.muted)}>
        <Icon name={prefs.muted ? "speaker-off" : "speaker"} size={18} />
      </IconButton>
      <input
        type="range" min={0} max={2} step={0.01} aria-label="Volume do soundboard"
        value={prefs.muted ? 0 : prefs.volume}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (prefs.muted && v > 0) soundboard.setMuted(false);
          soundboard.setVolume(v);
        }}
      />
      <span className="sb-volume-pct">{prefs.muted ? "mudo" : pct(prefs.volume)}</span>
    </div>
  );
}

/** Botão dos controles da chamada que abre a grade de sons do servidor. */
export function SoundboardButton({ server, meId, deafened, compact }: { server: Server; meId: string; deafened: boolean; /** Versão pequena do painel "Voz conectada" (o painel abre para cima, alinhado à esquerda). */ compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ left: number; bottom: number }>();
  const box = useRef<HTMLDivElement>(null);
  /** O painel fica fixo na tela, acima do botão: centrado nele (ou alinhado à esquerda no painel de voz), sem sair da janela. */
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
    void soundboard.load(server.id);
  }, [server.id]);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      // Cliques dentro de um modal ou menu aberto pelo painel (ficam fora dele, no body) não fecham o painel.
      const t = e.target as HTMLElement;
      if (!box.current?.contains(t) && !t.closest?.(".sb-panel, .t-modal-backdrop, .sb-menu")) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector(".t-modal-backdrop") && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className={`sb-anchor ${compact ? "side" : ""}`} ref={box}>
      <IconButton label="Soundboard" aria-expanded={open} aria-pressed={open} className={`${compact ? "" : "big"} ${open ? "is-on" : ""}`} onClick={toggle}>
        <Icon name="soundboard" size={compact ? 20 : 24} />
      </IconButton>
      {/* No body: os controles têm filtro (.lino), que prenderia um elemento fixo dentro deles. */}
      {open && createPortal(<SoundboardPanel server={server} meId={meId} deafened={deafened} place={place} />, document.body)}
    </div>
  );
}

function SoundboardPanel({ server, meId, deafened, place }: { server: Server; meId: string; deafened: boolean; place?: { left: number; bottom: number } }) {
  const { sounds, notice } = useSoundboard();
  const list = sounds[server.id];
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Sound | "new">();
  const [menu, setMenu] = useState<{ sound: Sound; x: number; y: number }>();
  const [coolUntil, setCoolUntil] = useState(0);
  const [, tick] = useState(0);
  const shown = useMemo(() => {
    const term = q.trim().toLocaleLowerCase("pt-BR");
    return (list ?? []).filter((s) => !term || s.name.toLocaleLowerCase("pt-BR").includes(term));
  }, [list, q]);
  // Some o aviso depois de alguns segundos.
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => soundboard.clearNotice(), 3500);
    return () => clearTimeout(t);
  }, [notice]);
  // Redesenha quando o cooldown acaba.
  useEffect(() => {
    if (coolUntil <= Date.now()) return;
    const t = setTimeout(() => tick((n) => n + 1), coolUntil - Date.now() + 10);
    return () => clearTimeout(t);
  }, [coolUntil]);
  const cooling = coolUntil > Date.now();
  const play = (s: Sound) => {
    if (deafened || cooling) return;
    soundboard.play(s.id);
    setCoolUntil(Date.now() + SOUND_COOLDOWN_MS);
  };
  const openMenu = (s: Sound, e: MouseEvent) => {
    e.preventDefault();
    setMenu({ sound: s, x: e.clientX, y: e.clientY });
  };
  const canAdd = canAddSound(server);
  const full = (list?.length ?? 0) >= MAX_SOUNDS_PER_SERVER;

  return (
    <div className="sb-panel lino lino-lg" role="dialog" aria-label="Soundboard" style={place} onClick={() => setMenu(undefined)}>
      <div className="sb-head">
        <b className="t-display">Soundboard</b>
        <SoundboardVolume compact />
      </div>
      <input className="sb-search" type="search" placeholder="Buscar som" aria-label="Buscar som" value={q} onChange={(e) => setQ(e.target.value)} />
      {deafened && <p className="sb-note t-muted">Tire o ensurdecer para tocar sons.</p>}
      <div className={`sb-grid ${cooling ? "cooling" : ""}`} style={cooling ? { ["--sb-cool" as string]: `${SOUND_COOLDOWN_MS}ms` } : undefined}>
        {!list && <p className="t-muted sb-empty">Carregando…</p>}
        {list && !list.length && <p className="t-muted sb-empty">Nenhum som ainda.{canAdd ? " Adicione o primeiro!" : ""}</p>}
        {shown.map((s) => (
          <button
            key={s.id}
            className="sb-sound lino"
            title={`${s.name} (${(s.durationMs / 1000).toFixed(1)} s). Clique direito para mais opções`}
            disabled={deafened || cooling}
            onClick={() => play(s)}
            onContextMenu={(e) => openMenu(s, e)}
          >
            <SoundIcon name={s.icon} size={28} />
            <span>{s.name}</span>
          </button>
        ))}
        {canAdd && !full && (
          <button className="sb-sound sb-add lino" onClick={() => setEditing("new")}>
            <Icon name="plus" size={26} />
            <span>Adicionar som</span>
          </button>
        )}
      </div>
      <div className="sb-foot t-muted">
        {notice ? <span role="status" className="sb-notice">{notice.text}</span> : <span>{list?.length ?? 0} de {MAX_SOUNDS_PER_SERVER} sons</span>}
      </div>
      {menu && createPortal(
        <div className="sb-menu lino" role="menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <button role="menuitem" className="menu-item" onClick={() => { void soundboard.preview(menu.sound); setMenu(undefined); }}>
            <span>Ouvir só para mim</span><Icon name="headphones" size={16} />
          </button>
          {canEditSound(menu.sound, meId, server.role) && (
            <button role="menuitem" className="menu-item" onClick={() => { setEditing(menu.sound); setMenu(undefined); }}>
              <span>Editar som</span><Icon name="pencil" size={16} />
            </button>
          )}
        </div>,
        document.body,
      )}
      {/* No body: dentro do painel (que tem transform) o modal ficaria preso e cortado. */}
      {editing && createPortal(<SoundModal serverId={server.id} sound={editing === "new" ? undefined : editing} canDelete={editing !== "new" && canEditSound(editing, meId, server.role)} onClose={() => setEditing(undefined)} />, document.body)}
    </div>
  );
}

/** Forma de onda do áudio com o trecho escolhido em destaque. */
function Waveform({ buf, start, end, onSeek }: { buf: AudioBuffer; start: number; end: number; onSeek: (sec: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const peaks = useMemo(() => {
    const data = buf.getChannelData(0);
    const n = 160;
    const step = Math.max(1, Math.floor(data.length / n));
    return Array.from({ length: n }, (_, i) => {
      let max = 0;
      for (let j = i * step; j < Math.min(data.length, (i + 1) * step); j += 8) max = Math.max(max, Math.abs(data[j]!));
      return max;
    });
  }, [buf]);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = c.clientWidth * dpr;
    c.height = c.clientHeight * dpr;
    const g = c.getContext("2d")!;
    const w = c.width / peaks.length;
    const top = Math.max(...peaks, 0.01);
    for (let i = 0; i < peaks.length; i++) {
      const t = (i / peaks.length) * buf.duration;
      g.fillStyle = t >= start && t <= end ? "#f5f3ee" : "#55534f";
      const h = Math.max(2 * dpr, (peaks[i]! / top) * c.height * 0.9);
      g.fillRect(i * w + w * 0.15, (c.height - h) / 2, w * 0.7, h);
    }
  }, [peaks, start, end, buf.duration]);
  return (
    <canvas
      ref={ref}
      className="sb-wave lino"
      aria-hidden
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onSeek(((e.clientX - r.left) / r.width) * buf.duration);
      }}
    />
  );
}

/** Adicionar (sem `sound`) ou editar um som: arquivo com recorte de até 5 s, nome, ícone e volume. */
export function SoundModal({ serverId, sound, canDelete, onClose }: { serverId: string; sound?: Sound; canDelete?: boolean; onClose: () => void }) {
  const [buf, setBuf] = useState<AudioBuffer>();
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [name, setName] = useState(sound?.name ?? "");
  const [icon, setIcon] = useState<SoundIconId>(sound?.icon ?? "star");
  const [volume, setVolume] = useState(sound?.volume ?? 1);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const maxSec = SOUND_MAX_MS / 1000;

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    try {
      const b = await decodeFile(file);
      setBuf(b);
      setStart(0);
      setEnd(Math.min(b.duration, maxSec));
      if (!name) setName(file.name.replace(/\.[^.]+$/, "").slice(0, SOUND_NAME_MAX));
    } catch {
      setBuf(undefined);
      setError("não deu para ler esse arquivo; use mp3, ogg, wav, webm ou m4a");
    }
  };
  /** Move o início levando o trecho junto (mesmo tamanho, até o fim do arquivo). */
  const setFrom = (s: number) => {
    if (!buf) return;
    const v = Math.max(0, Math.min(s, buf.duration - 0.05));
    const len = Math.max(0.05, end - start);
    setStart(v);
    setEnd(Math.min(buf.duration, v + len));
  };
  const setTo = (s: number) => {
    if (!buf) return;
    const v = Math.max(0.05, Math.min(s, buf.duration));
    setEnd(v);
    setStart((st) => Math.max(0, Math.min(st, v - 0.05), v - maxSec));
  };

  const save = async () => {
    const n = name.trim();
    if (!n) return setError("dê um nome ao som");
    setBusy(true);
    setError("");
    try {
      if (sound) await api.updateSound(sound.id, { name: n, icon, volume });
      else {
        if (!buf) throw new Error("escolha um arquivo de áudio");
        const wav = await encodeWav(buf, start, end);
        await api.uploadSound(serverId, wav, { name: n, icon, volume });
      }
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!sound) return;
    if (!confirmDelete) return setConfirmDelete(true);
    setBusy(true);
    try {
      await api.deleteSound(sound.id);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const preview = () => (sound ? void soundboard.preview({ key: sound.key, volume }) : buf && soundboard.previewBuffer(buf, volume, start, end));

  return (
    <Modal
      title={sound ? "Editar som" : "Adicionar som"}
      subtitle={sound ? undefined : `Áudio de até ${maxSec} s. Arquivos maiores podem ser recortados aqui.`}
      onClose={onClose}
      footer={
        <>
          {sound && canDelete && (
            <Button variant="danger" disabled={busy} onClick={() => void remove()}>
              <Icon name="trash" size={16} /> {confirmDelete ? "Confirmar" : "Apagar"}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button disabled={busy || (!sound && !buf)} onClick={() => void save()}>{busy ? "Salvando…" : "Salvar"}</Button>
        </>
      }
    >
      <div className="sb-form">
        {!sound && (
          <label className="sb-file t-btn secondary lino">
            <Icon name="file" size={18} /> {buf ? "Trocar arquivo" : "Escolher arquivo de áudio"}
            <input type="file" accept="audio/*,.mp3,.ogg,.wav,.webm,.m4a,.opus" onChange={(e) => void pick(e.target.files?.[0])} />
          </label>
        )}
        {buf && (
          <div className="sb-trim">
            <Waveform buf={buf} start={start} end={end} onSeek={setFrom} />
            <div className="sb-trim-row">
              <label>
                <span className="t-field-label">Início {start.toFixed(2)} s</span>
                <input type="range" min={0} max={buf.duration} step={0.01} value={start} onChange={(e) => setFrom(Number(e.target.value))} />
              </label>
              <label>
                <span className="t-field-label">Fim {end.toFixed(2)} s</span>
                <input type="range" min={0} max={buf.duration} step={0.01} value={end} onChange={(e) => setTo(Number(e.target.value))} />
              </label>
            </div>
            <span className="t-muted">Trecho de {(end - start).toFixed(2)} s</span>
          </div>
        )}
        <TextField label="Nome" maxLength={SOUND_NAME_MAX} value={name} onChange={(e) => setName(e.target.value)} placeholder="Buzina" />
        <fieldset className="sb-icons">
          <legend className="t-field-label">Ícone</legend>
          {soundIcons.map((id) => (
            <label key={id} className={`sb-icon lino ${icon === id ? "on" : ""}`} title={iconLabel[id]}>
              <input type="radio" name="sb-icon" value={id} checked={icon === id} onChange={() => setIcon(id)} aria-label={iconLabel[id]} />
              <SoundIcon name={id} size={26} />
            </label>
          ))}
        </fieldset>
        <label className="sb-vol-field">
          <span className="t-field-label">Volume do som {pct(volume)}</span>
          <div className="sb-vol-row">
            <input type="range" min={0} max={1} step={0.01} value={volume} onChange={(e) => setVolume(Number(e.target.value))} aria-label="Volume do som" />
            <Button size="sm" variant="secondary" disabled={!sound && !buf} onClick={preview}>
              <Icon name="headphones" size={16} /> Ouvir
            </Button>
          </div>
        </label>
        {error && <p className="t-field-error" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
