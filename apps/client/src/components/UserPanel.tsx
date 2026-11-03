import { useEffect, useRef, useState } from "react";
import type { Channel, User } from "@turtle/protocol";
import { Avatar, Button, Icon, IconButton } from "@turtle/ui";
import type { VoiceClient, VoiceSnapshot } from "../voice/client";

const statusText: Record<VoiceSnapshot["status"], string> = {
  idle: "",
  connecting: "Conectando…",
  connected: "Voz conectada",
  reconnecting: "Reconectando…",
};

/** Rodapé da barra de canais: bloco "Voz conectada" (quando em chamada) + barra do usuário. */
export function UserPanel({
  user,
  snap,
  voice,
  channels,
  onSettings,
  onLogout,
}: {
  user: User;
  snap: VoiceSnapshot;
  voice: VoiceClient;
  channels: Channel[];
  onSettings: () => void;
  onLogout: () => void;
}) {
  const channel = channels.find((c) => c.id === snap.channelId);
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setMenu(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menu]);

  return (
    <div className="user-panel">
      {snap.status !== "idle" && (
        <div className={`voice-status ${snap.status}`}>
          <div className="voice-status-row">
            <div className="voice-status-text">
              <b>
                <Icon name="signal" size={14} /> {statusText[snap.status]}
              </b>
              <span className="t-muted">{channel ? `${channel.name} / Turtle` : "Turtle"}</span>
            </div>
            <IconButton label="Sair da chamada" onClick={() => void voice.leave()}>
              <Icon name="phone-off" size={20} />
            </IconButton>
          </div>
          {snap.needsAudioUnlock && (
            <Button size="sm" block onClick={() => void voice.unlockAudio()}>
              Ativar som
            </Button>
          )}
        </div>
      )}
      {snap.error && (
        <div className="voice-error" role="alert">
          {snap.error}
        </div>
      )}
      <div className="user-bar" ref={ref}>
        <button className="user-chip" onClick={() => setMenu(!menu)} aria-haspopup="menu" aria-expanded={menu}>
          <Avatar name={user.username} size={32} status="online" statusRing="var(--bg-panel)" />
          <span className="user-chip-text">
            <b>{user.username}</b>
            <span className="t-muted">{user.isAdmin ? "Admin" : "Online"}</span>
          </span>
        </button>
        <IconButton label="Mudo" aria-pressed={snap.muted} className={snap.muted ? "is-off" : ""} onClick={() => void voice.toggleMute()}>
          <Icon name={snap.muted ? "mic-off" : "mic"} />
        </IconButton>
        <IconButton label="Ensurdecer" aria-pressed={snap.deafened} className={snap.deafened ? "is-off" : ""} onClick={() => void voice.toggleDeafen()}>
          <Icon name={snap.deafened ? "headphones-off" : "headphones"} />
        </IconButton>
        <IconButton label="Configurações de voz" onClick={onSettings}>
          <Icon name="settings" />
        </IconButton>
        {menu && (
          <div className="menu user-menu lino" role="menu">
            <button role="menuitem" className="menu-item" onClick={() => { setMenu(false); void voice.leave(); onLogout(); }}>
              <span>Sair da conta</span>
              <Icon name="logout" size={18} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
