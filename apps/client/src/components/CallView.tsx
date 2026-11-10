import { useEffect, useRef, useState, type MouseEvent, type TouchEvent } from "react";
import { shownName, type Channel, type Server, type VoiceState } from "@turtle/protocol";
import { fileUrl } from "../api";
import { Avatar, Button, Icon, IconButton, SoundIcon, StaffTag } from "@turtle/ui";
import { SoundboardButton, useSoundboard } from "./Soundboard";
import { JukeboxButton, JukeboxNowPlaying, type NameOf } from "./Jukebox";
import { MAX_VOLUME } from "../voice/prefs";
import type { CallParticipant, ShareStats, VideoTile, VoiceClient, VoiceSnapshot } from "../voice/client";
import { ChannelHeader } from "./ChatView";
import { ShareModal } from "./ShareModal";
import { VideoView } from "./VideoView";
import { useMobile } from "../mobile";

const qualityLabel: Record<CallParticipant["quality"], string> = {
  excellent: "conexão ótima", good: "conexão boa", poor: "conexão ruim", lost: "sem conexão", unknown: "",
};

/** Navegador capaz de transmitir a tela (celulares não têm). */
export const canShareScreen = () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;

type IosVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };
type LockableOrientation = ScreenOrientation & { lock?: (o: string) => Promise<void> };

/** Tela cheia. No celular gira para paisagem; no iPhone usa o player nativo do vídeo. */
function toggleFullscreen(el: HTMLElement | null, landscape = false) {
  if (!el) return;
  if (document.fullscreenElement) return void document.exitFullscreen().catch(() => {});
  if (el.requestFullscreen) {
    void el.requestFullscreen().then(() => {
      if (landscape) void (screen.orientation as LockableOrientation | undefined)?.lock?.("landscape").catch(() => {});
    }).catch(() => {});
    return;
  }
  el.querySelector<IosVideo>("video")?.webkitEnterFullscreen?.();
}

/** Zoom com dois dedos e arrastar com um (quando ampliado); toque duplo volta ao normal. */
function usePinchZoom() {
  const [z, setZ] = useState({ scale: 1, x: 0, y: 0 });
  const g = useRef<{ dist: number; scale: number; x: number; y: number; px: number; py: number; tap: number } | undefined>(undefined);
  const lastTap = useRef(0);
  const dist = (t: TouchEvent["touches"]) => Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);
  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches;
    if (t.length === 1) {
      const now = Date.now();
      if (now - lastTap.current < 300) setZ({ scale: 1, x: 0, y: 0 });
      lastTap.current = now;
    }
    g.current = { dist: t.length === 2 ? dist(t) : 0, scale: z.scale, x: z.x, y: z.y, px: t[0]!.clientX, py: t[0]!.clientY, tap: 0 };
  };
  const onTouchMove = (e: TouchEvent) => {
    const s = g.current;
    const t = e.touches;
    if (!s) return;
    if (t.length === 2 && s.dist) {
      const scale = Math.min(5, Math.max(1, (s.scale * dist(t)) / s.dist));
      setZ((o) => (scale === 1 ? { scale: 1, x: 0, y: 0 } : { ...o, scale }));
    } else if (t.length === 1 && z.scale > 1) {
      setZ((o) => ({ ...o, x: s.x + t[0]!.clientX - s.px, y: s.y + t[0]!.clientY - s.py }));
    }
  };
  const onTouchEnd = () => { g.current = undefined; };
  const style = z.scale > 1 ? { transform: `translate(${z.x}px, ${z.y}px) scale(${z.scale})` } : undefined;
  return { style, zoomed: z.scale > 1, handlers: { onTouchStart, onTouchMove, onTouchEnd } };
}

function StatsLine({ stats }: { stats?: ShareStats }) {
  if (!stats) return null;
  if (stats.idle) {
    return (
      <div className="tile-stats t-muted" aria-label="Diagnóstico da transmissão">
        Em espera: ninguém assistindo agora, a transmissão retoma sozinha
      </div>
    );
  }
  const limit = stats.limit === "cpu" ? "limitado pela CPU" : stats.limit === "bandwidth" ? "limitado pela rede" : "";
  const kind = stats.hardware === undefined ? "" : stats.hardware ? " (hardware)" : " (software)";
  return (
    <div className="tile-stats t-muted" aria-label="Diagnóstico da transmissão">
      {stats.width}×{stats.height} · {stats.fps} fps · {stats.mbps} Mb/s · {stats.encoder}
      {kind}
      {limit && <b> · {limit}</b>}
    </div>
  );
}

/** Cartão de uma pessoa: câmera se estiver ligada, senão o avatar. */
function PersonTile({ p, profile, camera, voice, snap, onFocus, onProfile, onMenu, strip }: { p: CallParticipant; onProfile?: (userId: string) => void; onMenu?: PersonMenuHandler; profile?: VoiceState; camera?: VideoTile; voice: VoiceClient; snap: VoiceSnapshot; onFocus: () => void; strip?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const speaking = p.speaking && !p.muted;
  const flash = useSoundboard().flashes[p.id];
  return (
    <div ref={ref} className={`tile lino lino-lg ${speaking ? "speaking" : ""} ${camera?.track ? "has-video" : ""}`} onDoubleClick={() => (camera ? toggleFullscreen(ref.current) : onFocus())} onContextMenu={onMenu && ((e) => onMenu(p.id, e))}>
      {camera?.track ? <VideoView track={camera.track} className={p.isLocal && snap.facing === "user" ? "mirror" : ""} /> : <Avatar name={profile ? shownName(profile) : p.name} src={fileUrl(profile?.avatar)} size={strip ? 48 : 88} speaking={speaking} />}
      <div className="tile-name">
        {p.muted && <Icon name="mic-off" size={16} />}
        <button className="tile-name-btn" title="Ver perfil" onClick={() => onProfile?.(p.id)} onDoubleClick={(e) => e.stopPropagation()}>
          {profile ? shownName(profile) : p.name}
          {profile?.staff && <> <StaffTag /></>}
          {p.isLocal && " (você)"}
        </button>
      </div>
      {flash && (
        <div className="tile-sound lino" key={flash.until} role="status" aria-label={`${p.name} tocou ${flash.sound.name}`} title={flash.sound.name}>
          <SoundIcon name={flash.sound.icon} size={strip ? 16 : 24} />
        </div>
      )}
      {!strip && qualityLabel[p.quality] && <div className="tile-quality t-muted">{qualityLabel[p.quality]}</div>}
      {!strip && (
        <div className="tile-actions">
          {camera && (
            <IconButton label="Tela cheia" onClick={() => toggleFullscreen(ref.current)}>
              <Icon name="maximize" size={18} />
            </IconButton>
          )}
        </div>
      )}
      {!strip && !p.isLocal && (
        <input
          className="tile-volume"
          type="range" min={0} max={MAX_VOLUME} step={0.05} aria-label={`Volume de ${p.name}`}
          value={snap.prefs.volumes[p.id] ?? 1}
          onChange={(e) => voice.setVolume(p.id, Number(e.target.value))}
        />
      )}
    </div>
  );
}

/** Volume do áudio da transmissão (separado da voz da pessoa), no canto do vídeo: clique abre o controle. */
function StreamVolume({ v, voice, snap }: { v: VideoTile; voice: VoiceClient; snap: VoiceSnapshot }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const vol = snap.prefs.streamVolumes[v.userId] ?? 1;
  // Volume antes de mutar, para o botão de mudo voltar onde estava.
  const before = useRef(vol || 1);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  const set = (n: number) => {
    if (n > 0) before.current = n;
    voice.setStreamVolume(v.userId, n);
  };
  return (
    <div ref={box} className="stream-volume" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <IconButton label={`Volume da transmissão: ${Math.round(vol * 100)}%`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name={vol === 0 ? "speaker-off" : "speaker"} size={18} />
      </IconButton>
      {open && (
        <div className="stream-volume-pop lino" role="group" aria-label={`Volume da transmissão de ${v.name}`}>
          <IconButton label={vol === 0 ? "Ativar som da transmissão" : "Silenciar transmissão"} onClick={() => set(vol === 0 ? before.current : 0)}>
            <Icon name={vol === 0 ? "speaker-off" : "speaker"} size={18} />
          </IconButton>
          <input
            type="range" min={0} max={MAX_VOLUME} step={0.05} aria-label={`Volume da transmissão de ${v.name}`}
            value={vol}
            onChange={(e) => set(Number(e.target.value))}
          />
          <span className="stream-volume-pct">{Math.round(vol * 100)}%</span>
        </div>
      )}
    </div>
  );
}

/** Cartão de uma transmissão de tela. Quem está transmitindo só chega a você depois de clicar em Assistir. */
function ScreenTile({ v, voice, snap, focused, onFocus, strip }: { v: VideoTile; voice: VoiceClient; snap: VoiceSnapshot; focused?: boolean; onFocus: () => void; strip?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const mobile = useMobile();
  const zoom = usePinchZoom();
  const title = v.isLocal ? "Sua transmissão" : `Transmissão de ${v.name}`;
  // No celular: tocar numa transmissão da grade abre em destaque; em destaque, dá zoom com os dedos.
  const touchFocus = mobile && v.track && !focused;
  return (
    <div
      ref={ref}
      className={`tile screen-tile lino lino-lg ${focused ? "focused" : ""} ${v.track ? "has-video" : ""} ${zoom.zoomed ? "zoomed" : ""}`}
      onDoubleClick={() => v.track && !mobile && toggleFullscreen(ref.current)}
      onClick={touchFocus ? onFocus : undefined}
      {...(mobile && focused && v.track ? zoom.handlers : {})}
    >
      {v.track ? (
        <div className="zoom-box" style={focused ? zoom.style : undefined}><VideoView track={v.track} contain /></div>
      ) : (
        <div className="screen-wait">
          <Icon name="screen" size={strip ? 28 : 44} />
          {!strip && <b>{v.name} está transmitindo</b>}
          <Button size="sm" onClick={() => voice.watch(v.userId)}>
            <Icon name="eye" size={18} /> Assistir
          </Button>
        </div>
      )}
      <div className="tile-name">
        <span className="live-badge">AO VIVO</span>
        <span>{title}</span>
      </div>
      {v.isLocal && !strip && <StatsLine stats={snap.shareStats} />}
      {v.track && !strip && (
        <div className="tile-actions">
          <IconButton label={focused ? "Voltar para a grade" : "Focar nesta transmissão"} onClick={(e) => { e.stopPropagation(); onFocus(); }}>
            <Icon name={focused ? "minimize" : "maximize"} size={18} />
          </IconButton>
          <IconButton label="Tela cheia" onClick={(e) => { e.stopPropagation(); toggleFullscreen(ref.current, mobile); }}>
            <Icon name="screen" size={18} />
          </IconButton>
          {!v.isLocal && v.hasAudio && <StreamVolume v={v} voice={voice} snap={snap} />}
          {!v.isLocal && (
            <select
              className="watch-quality"
              aria-label="Qualidade da transmissão"
              defaultValue="auto"
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => voice.setWatchQuality(v.userId, e.target.value as "auto" | "high" | "low")}
            >
              <option value="auto">Automática</option>
              <option value="high">Alta</option>
              <option value="low">Baixa</option>
            </select>
          )}
          {!v.isLocal && (
            <IconButton label="Parar de assistir" onClick={(e) => { e.stopPropagation(); voice.unwatch(v.userId); }}>
              <Icon name="close" size={18} />
            </IconButton>
          )}
        </div>
      )}
    </div>
  );
}

/** Clique direito numa pessoa (abre o menu dela). */
export type PersonMenuHandler = (userId: string, e: MouseEvent) => void;

/** Palco da chamada, no estilo do Discord: grade de cartões e barra de controles embaixo. */
export function CallView({ channel, snap, voice, members = [], onProfile, onMenu, server, meId, nameOf }: { channel?: Channel; snap: VoiceSnapshot; voice: VoiceClient; members?: VoiceState[]; onProfile?: (userId: string) => void; onMenu?: PersonMenuHandler; /** Servidor da chamada (liga o soundboard e a discoteca). */ server?: Server; meId?: string; /** Nome de alguém do servidor (quem colocou a música). */ nameOf?: (userId: string) => string | undefined }) {
  const [focus, setFocus] = useState<string>();
  const [sharing, setSharing] = useState(false);
  const mobile = useMobile();
  const inThis = !!channel && snap.channelId === channel.id && snap.status !== "idle";
  // Mantém a tela do celular acesa enquanto está na chamada (para assistir sem apagar).
  useEffect(() => {
    if (!inThis || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | undefined;
    let gone = false;
    const take = () => {
      if (document.visibilityState !== "visible") return;
      navigator.wakeLock.request("screen").then((l) => { if (gone) void l.release(); else lock = l; }).catch(() => {});
    };
    take();
    document.addEventListener("visibilitychange", take);
    return () => { gone = true; document.removeEventListener("visibilitychange", take); void lock?.release().catch(() => {}); };
  }, [inThis]);
  if (!channel) return null;
  const here = members.filter((m) => m.channelId === channel.id);
  const whoIs: NameOf = (id) => {
    const v = members.find((m) => m.userId === id);
    return nameOf?.(id) ?? (v ? shownName(v) : "alguém");
  };

  const cameras = new Map(snap.videos.filter((v) => v.source === "camera").map((v) => [v.userId, v]));
  const screens = snap.videos.filter((v) => v.source === "screen");
  const focusedScreen = screens.find((v) => v.key === focus && v.track);

  const person = (p: CallParticipant, strip?: boolean) => (
    <PersonTile key={p.id} p={p} profile={members.find((m) => m.userId === p.id)} camera={cameras.get(p.id)} voice={voice} snap={snap} strip={strip} onFocus={() => {}} onProfile={onProfile} onMenu={onMenu} />
  );
  const screen = (v: VideoTile, strip?: boolean) => (
    <ScreenTile key={v.key} v={v} voice={voice} snap={snap} strip={strip} focused={focusedScreen?.key === v.key} onFocus={() => setFocus(focusedScreen?.key === v.key ? undefined : v.key)} />
  );

  return (
    <section className="call">
      <ChannelHeader icon="speaker" name={channel.name}>
        {inThis && snap.status !== "connected" && <span className="t-muted call-state">{snap.status === "connecting" ? "conectando…" : "reconectando…"}</span>}
      </ChannelHeader>

      {!inThis ? (
        <div className="call-lobby">
          <div className="call-lobby-faces">
            {here.length ? here.map((m) => <button key={m.userId} className="lobby-face" title={`Perfil de ${shownName(m)}`} onClick={() => onProfile?.(m.userId)} onContextMenu={onMenu && ((e) => onMenu(m.userId, e))}><Avatar name={shownName(m)} src={fileUrl(m.avatar)} size={72} /></button>) : <Icon name="speaker" size={56} />}
          </div>
          <h2 className="t-display">{channel.name}</h2>
          <p className="t-muted">{here.length ? `${here.map((m) => shownName(m)).join(", ")} ${here.length > 1 ? "estão" : "está"} na chamada.` : "Ninguém na chamada ainda."}</p>
          <Button size="lg" onClick={() => void voice.join(channel.id)}>
            Entrar na chamada
          </Button>
        </div>
      ) : (
        <>
          {snap.needsAudioUnlock && (
            <button className="call-unlock" onClick={() => void voice.unlockAudio()}>
              <Icon name="speaker" size={18} /> Toque para ativar o som
            </button>
          )}
          {focusedScreen ? (
            <div className="focus-stage">
              <div className="focus-main">{screen(focusedScreen)}</div>
              <div className="focus-strip">
                {snap.participants.map((p) => person(p, true))}
                {screens.filter((v) => v.key !== focusedScreen.key).map((v) => screen(v, true))}
              </div>
            </div>
          ) : (
            <div className="tiles" data-count={Math.min(snap.participants.length + screens.length, 6)}>
              {screens.map((v) => screen(v))}
              {snap.participants.map((p) => person(p))}
            </div>
          )}
          <div className="call-dock">
          {server && channel.serverId === server.id && <JukeboxNowPlaying channelId={channel.id} nameOf={whoIs} />}
          <div className="call-controls lino lino-lg">
            <IconButton label="Mudo" aria-pressed={snap.muted} className={`big ${snap.muted ? "is-off" : ""}`} onClick={() => void voice.toggleMute()}>
              <Icon name={snap.muted ? "mic-off" : "mic"} size={24} />
            </IconButton>
            <IconButton label="Ensurdecer" aria-pressed={snap.deafened} className={`big ${snap.deafened ? "is-off" : ""}`} onClick={() => void voice.toggleDeafen()}>
              <Icon name={snap.deafened ? "headphones-off" : "headphones"} size={24} />
            </IconButton>
            <IconButton label={snap.camera ? "Desligar câmera" : "Ligar câmera"} aria-pressed={snap.camera} className={`big ${snap.camera ? "is-on" : ""}`} onClick={() => void voice.toggleCamera()}>
              <Icon name={snap.camera ? "video" : "video-off"} size={24} />
            </IconButton>
            {mobile && snap.camera && (
              <IconButton label={snap.facing === "user" ? "Usar câmera traseira" : "Usar câmera frontal"} className="big" onClick={() => void voice.flipCamera()}>
                <Icon name="camera-flip" size={24} />
              </IconButton>
            )}
            {(snap.screen || canShareScreen()) && <IconButton
              label={snap.screen ? "Parar transmissão" : "Compartilhar tela"}
              aria-pressed={snap.screen}
              className={`big ${snap.screen ? "is-on" : ""}`}
              onClick={() => (snap.screen ? void voice.stopScreen() : setSharing(true))}
            >
              <Icon name={snap.screen ? "screen-off" : "screen"} size={24} />
            </IconButton>}
            {server && meId && channel.serverId === server.id && <SoundboardButton server={server} meId={meId} deafened={snap.deafened} />}
            {server && channel.serverId === server.id && <JukeboxButton channelId={channel.id} nameOf={whoIs} deafened={snap.deafened} />}
            <IconButton label="Sair da chamada" className="big hangup" onClick={() => void voice.leave()}>
              <Icon name="phone-off" size={26} />
            </IconButton>
          </div>
          </div>
          {sharing && <ShareModal snap={snap} voice={voice} onClose={() => setSharing(false)} />}
        </>
      )}
    </section>
  );
}
