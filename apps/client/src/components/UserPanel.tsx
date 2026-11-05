import { useEffect, useRef, useState } from "react";
import type { Channel, User, UserStatus } from "@turtle/protocol";
import { canInviteAccounts, shownName } from "@turtle/protocol";
import { fileUrl } from "../api";
import { Avatar, Button, Icon, IconButton, StaffTag } from "@turtle/ui";
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
  serverName,
  onSettings,
  onProfile,
  onShare,
  onLogout,
  onStatus,
}: {
  user: User;
  snap: VoiceSnapshot;
  voice: VoiceClient;
  channels: Channel[];
  /** Nome do servidor da chamada em andamento. */
  serverName?: string;
  onSettings: () => void;
  onProfile: () => void;
  /** Abre a escolha de qualidade antes de transmitir a tela. */
  onShare: () => void;
  onLogout: () => void;
  /** Troca entre Online e Não perturbe. */
  onStatus: (s: UserStatus) => void;
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
              <span className="t-muted">{channel ? `${channel.name} / ${serverName ?? "Turtle"}` : "Turtle"}</span>
            </div>
            <IconButton label="Sair da chamada" onClick={() => void voice.leave()}>
              <Icon name="phone-off" size={20} />
            </IconButton>
          </div>
          {snap.status === "connected" && (
            <div className="voice-status-actions">
              <IconButton label={snap.camera ? "Desligar câmera" : "Ligar câmera"} aria-pressed={snap.camera} className={snap.camera ? "is-on" : ""} onClick={() => void voice.toggleCamera()}>
                <Icon name={snap.camera ? "video" : "video-off"} />
              </IconButton>
              <IconButton
                label={snap.screen ? "Parar transmissão" : "Compartilhar tela"}
                aria-pressed={snap.screen}
                className={snap.screen ? "is-on" : ""}
                onClick={() => (snap.screen ? void voice.stopScreen() : onShare())}
              >
                <Icon name={snap.screen ? "screen-off" : "screen"} />
              </IconButton>
            </div>
          )}
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
          <Avatar name={shownName(user)} src={fileUrl(user.avatar)} size={32} status={user.status === "busy" ? "busy" : "online"} statusRing="var(--bg-panel)" />
          <span className="user-chip-text">
            <b>{shownName(user)}</b>
            <span className="t-muted">{user.status === "busy" ? "Não perturbe" : canInviteAccounts(user) ? <StaffTag /> : "Online"}</span>
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
            {(["online", "busy"] as const).map((s) => (
              <button key={s} role="menuitemradio" aria-checked={user.status === s} className="menu-item status-item" onClick={() => { setMenu(false); onStatus(s); }}>
                <span className="status-item-label">
                  <span className={`t-status-inline ${s}`} aria-hidden="true" />
                  <span>
                    {s === "online" ? "Online" : "Não perturbe"}
                    {s === "busy" && <small className="t-muted">Sem sons nem notificações de mensagem</small>}
                  </span>
                </span>
                {user.status === s && <Icon name="check" size={16} />}
              </button>
            ))}
            <hr className="t-divider" />
            <button role="menuitem" className="menu-item" onClick={() => { setMenu(false); onProfile(); }}>
              <span>Configurações</span>
              <Icon name="settings" size={18} />
            </button>
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
