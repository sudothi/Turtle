import { useRef, useState } from "react";
import { shownName, type Channel, type VoiceState } from "@turtle/protocol";
import { fileUrl } from "../api";
import { Avatar, Button, Icon, IconButton } from "@turtle/ui";
import type { CallParticipant, ShareStats, VideoTile, VoiceClient, VoiceSnapshot } from "../voice/client";
import { ChannelHeader } from "./ChatView";
import { ShareModal } from "./ShareModal";
import { VideoView } from "./VideoView";

const qualityLabel: Record<CallParticipant["quality"], string> = {
  excellent: "conexão ótima", good: "conexão boa", poor: "conexão ruim", lost: "sem conexão", unknown: "",
};

function toggleFullscreen(el: HTMLElement | null) {
  if (!el) return;
  if (document.fullscreenElement) void document.exitFullscreen();
  else void el.requestFullscreen?.().catch(() => {});
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
function PersonTile({ p, profile, camera, voice, snap, onFocus, onProfile, strip }: { p: CallParticipant; onProfile?: (userId: string) => void; profile?: VoiceState; camera?: VideoTile; voice: VoiceClient; snap: VoiceSnapshot; onFocus: () => void; strip?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const speaking = p.speaking && !p.muted;
  return (
    <div ref={ref} className={`tile lino lino-lg ${speaking ? "speaking" : ""} ${camera?.track ? "has-video" : ""}`} onDoubleClick={() => (camera ? toggleFullscreen(ref.current) : onFocus())}>
      {camera?.track ? <VideoView track={camera.track} className={p.isLocal ? "mirror" : ""} /> : <Avatar name={profile ? shownName(profile) : p.name} src={fileUrl(profile?.avatar)} size={strip ? 48 : 88} speaking={speaking} />}
      <div className="tile-name">
        {p.muted && <Icon name="mic-off" size={16} />}
        <button className="tile-name-btn" title="Ver perfil" onClick={() => onProfile?.(p.id)} onDoubleClick={(e) => e.stopPropagation()}>
          {profile ? shownName(profile) : p.name}
          {p.isLocal && " (você)"}
        </button>
      </div>
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
          type="range" min={0} max={1} step={0.05} aria-label={`Volume de ${p.name}`}
          value={snap.prefs.volumes[p.id] ?? 1}
          onChange={(e) => voice.setVolume(p.id, Number(e.target.value))}
        />
      )}
    </div>
  );
}

/** Cartão de uma transmissão de tela. Quem está transmitindo só chega a você depois de clicar em Assistir. */
function ScreenTile({ v, voice, snap, focused, onFocus, strip }: { v: VideoTile; voice: VoiceClient; snap: VoiceSnapshot; focused?: boolean; onFocus: () => void; strip?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const title = v.isLocal ? "Sua transmissão" : `Transmissão de ${v.name}`;
  return (
    <div ref={ref} className={`tile screen-tile lino lino-lg ${focused ? "focused" : ""} ${v.track ? "has-video" : ""}`} onDoubleClick={() => v.track && toggleFullscreen(ref.current)}>
      {v.track ? (
        <VideoView track={v.track} contain />
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
          <IconButton label={focused ? "Voltar para a grade" : "Focar nesta transmissão"} onClick={onFocus}>
            <Icon name={focused ? "minimize" : "maximize"} size={18} />
          </IconButton>
          <IconButton label="Tela cheia" onClick={() => toggleFullscreen(ref.current)}>
            <Icon name="screen" size={18} />
          </IconButton>
          {!v.isLocal && (
            <IconButton label="Parar de assistir" onClick={() => voice.unwatch(v.userId)}>
              <Icon name="close" size={18} />
            </IconButton>
          )}
        </div>
      )}
      {v.track && !strip && !v.isLocal && (
        <input
          className="tile-volume visible"
          type="range" min={0} max={1} step={0.05} aria-label={`Volume da transmissão de ${v.name}`}
          value={snap.prefs.streamVolumes[v.userId] ?? 1}
          onChange={(e) => voice.setStreamVolume(v.userId, Number(e.target.value))}
        />
      )}
    </div>
  );
}

/** Palco da chamada, no estilo do Discord: grade de cartões e barra de controles embaixo. */
export function CallView({ channel, snap, voice, members = [], onProfile }: { channel?: Channel; snap: VoiceSnapshot; voice: VoiceClient; members?: VoiceState[]; onProfile?: (userId: string) => void }) {
  const [focus, setFocus] = useState<string>();
  const [sharing, setSharing] = useState(false);
  if (!channel) return null;
  const inThis = snap.channelId === channel.id && snap.status !== "idle";
  const here = members.filter((m) => m.channelId === channel.id);

  const cameras = new Map(snap.videos.filter((v) => v.source === "camera").map((v) => [v.userId, v]));
  const screens = snap.videos.filter((v) => v.source === "screen");
  const focusedScreen = screens.find((v) => v.key === focus && v.track);

  const person = (p: CallParticipant, strip?: boolean) => (
    <PersonTile key={p.id} p={p} profile={members.find((m) => m.userId === p.id)} camera={cameras.get(p.id)} voice={voice} snap={snap} strip={strip} onFocus={() => {}} onProfile={onProfile} />
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
            {here.length ? here.map((m) => <button key={m.userId} className="lobby-face" title={`Perfil de ${shownName(m)}`} onClick={() => onProfile?.(m.userId)}><Avatar name={shownName(m)} src={fileUrl(m.avatar)} size={72} /></button>) : <Icon name="speaker" size={56} />}
          </div>
          <h2 className="t-display">{channel.name}</h2>
          <p className="t-muted">{here.length ? `${here.map((m) => shownName(m)).join(", ")} ${here.length > 1 ? "estão" : "está"} na chamada.` : "Ninguém na chamada ainda."}</p>
          <Button size="lg" onClick={() => void voice.join(channel.id)}>
            Entrar na chamada
          </Button>
        </div>
      ) : (
        <>
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
            <IconButton
              label={snap.screen ? "Parar transmissão" : "Compartilhar tela"}
              aria-pressed={snap.screen}
              className={`big ${snap.screen ? "is-on" : ""}`}
              onClick={() => (snap.screen ? void voice.stopScreen() : setSharing(true))}
            >
              <Icon name={snap.screen ? "screen-off" : "screen"} size={24} />
            </IconButton>
            <IconButton label="Sair da chamada" className="big hangup" onClick={() => void voice.leave()}>
              <Icon name="phone-off" size={26} />
            </IconButton>
          </div>
          {sharing && <ShareModal snap={snap} voice={voice} onClose={() => setSharing(false)} />}
        </>
      )}
    </section>
  );
}
