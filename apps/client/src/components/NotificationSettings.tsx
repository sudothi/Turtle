import { useState } from "react";
import { Button } from "@turtle/ui";
import { loadSoundPrefs, playSound, saveSoundPrefs, type SoundName, type SoundPrefs } from "../sounds";

const samples: { name: SoundName; label: string }[] = [
  { name: "message", label: "Mensagem" },
  { name: "mute", label: "Mutar" },
  { name: "unmute", label: "Desmutar" },
  { name: "deafen", label: "Ensurdecer" },
  { name: "screenOn", label: "Transmitir tela" },
  { name: "screenOff", label: "Parar transmissão" },
];

const permissionText = () => {
  if (typeof Notification === "undefined") return "Este navegador não mostra notificações.";
  if (Notification.permission === "granted") return "Ligadas: aparecem quando o Turtle está minimizado ou em outra janela.";
  if (Notification.permission === "denied") return "Bloqueadas no navegador. Libere nas permissões do site para receber avisos.";
  return "Ainda não liberadas.";
};

/** Configurações > Notificações: sons do mar, volume e avisos do sistema. Fica neste computador. */
export function NotificationSettings() {
  const [prefs, setPrefs] = useState<SoundPrefs>(loadSoundPrefs);
  const [perm, setPerm] = useState(permissionText);
  const set = (p: Partial<SoundPrefs>) => {
    const next = { ...prefs, ...p };
    setPrefs(next);
    saveSoundPrefs(next);
  };
  return (
    <div className="notify-settings">
      <label className="toggle-row">
        <input type="checkbox" checked={prefs.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        <span>
          <b>Sons do app</b>
          <span className="t-muted">Bolhas e ondas ao mutar, transmitir e receber mensagem.</span>
        </span>
      </label>
      <label className="t-field-label" htmlFor="sound-volume">Volume dos sons — {Math.round(prefs.volume * 100)}%</label>
      <input id="sound-volume" type="range" min={0} max={1} step={0.05} value={prefs.volume} disabled={!prefs.enabled} onChange={(e) => set({ volume: Number(e.target.value) })} />
      <div className="sound-samples">
        {samples.map((s) => (
          <Button key={s.name} size="sm" variant="ghost" disabled={!prefs.enabled} onClick={() => playSound(s.name)}>
            ▶ {s.label}
          </Button>
        ))}
      </div>

      <hr className="t-divider" />
      <label className="toggle-row">
        <input type="checkbox" checked={prefs.allServerMessages} onChange={(e) => set({ allServerMessages: e.target.checked })} />
        <span>
          <b>Avisar de toda mensagem nos servidores</b>
          <span className="t-muted">Desligado: só conversas diretas, grupos e quando alguém menciona você.</span>
        </span>
      </label>
      <div className="notify-permission">
        <span>
          <b>Notificações do sistema</b>
          <span className="t-muted">{perm}</span>
        </span>
        {typeof Notification !== "undefined" && Notification.permission === "default" && (
          <Button size="sm" onClick={() => void Notification.requestPermission().then(() => setPerm(permissionText()))}>Ativar</Button>
        )}
      </div>
      <p className="t-muted">No status Não perturbe, mensagens não tocam som nem mostram notificação.</p>
    </div>
  );
}
