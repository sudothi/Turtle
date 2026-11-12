import { canInviteAccounts, type User } from "@turtle/protocol";
import { Modal } from "@turtle/ui";
import type { VoiceClient } from "../voice/client";
import { ShortcutSettings, ShowGameSetting, StartupSetting, VoiceSettings } from "../voice/VoiceSettings";
import { desktop } from "../desktop";
import { AppInvitePanel, InvitersPanel } from "./modals";
import { ProfileSettings } from "./ProfileSettings";
import { AccountSettings } from "./AccountSettings";
import { NotificationSettings } from "./NotificationSettings";
import { DesktopDownload } from "./DesktopDownload";
import { GameAutomationsSetting, hasAutomations } from "./GameAutomations";

export type SettingsTab = "profile" | "account" | "admin" | "voice" | "notifications" | "shortcuts" | "activity" | "games" | "desktop";

interface Tab { id: SettingsTab; label: string; subtitle: string; group: string; show?: () => boolean }

const USER = "Configurações do usuário";
const APP = "Configurações do aplicativo";
const tabs: Tab[] = [
  { id: "profile", label: "Perfil", subtitle: "Como as pessoas veem você", group: USER },
  { id: "account", label: "Conta", subtitle: "Senha e sessões conectadas", group: USER },
  { id: "admin", label: "Administração", subtitle: "Convites para criar conta no Turtle", group: USER },
  { id: "voice", label: "Voz e áudio", subtitle: "Microfone, saída e ruído", group: APP },
  { id: "notifications", label: "Notificações", subtitle: "Sons do app e avisos de mensagem", group: APP },
  { id: "shortcuts", label: "Atalhos", subtitle: "Mutar e ensurdecer de qualquer lugar", group: APP, show: () => !!desktop()?.setShortcuts },
  { id: "activity", label: "Atividade", subtitle: "O que os outros veem que você está fazendo", group: APP, show: () => !!desktop()?.setActivityEnabled },
  { id: "games", label: "Game Automations", subtitle: "Aceitar partida, pick e ban no League of Legends", group: APP, show: hasAutomations },
  { id: "desktop", label: "App desktop", subtitle: "Início com o Windows e download do Turtle", group: APP },
];

/** Configurações em barra lateral, como no Discord. A seção Voz mantém o nome "Configurações de voz" (usado nos testes e2e). */
export function SettingsModal({ user, voice, prefs, tab, onTab, onChanged, onLogout, onClose }: {
  user: User;
  voice: VoiceClient;
  prefs: Parameters<typeof VoiceSettings>[0]["prefs"];
  tab: SettingsTab;
  onTab: (t: SettingsTab) => void;
  onChanged: (u: User) => void;
  onLogout: () => void;
  onClose: () => void;
}) {
  // Quem só tem o cargo Convidador vê a seção como "Convites".
  const visible = tabs
    .filter((t) => (t.id !== "admin" || canInviteAccounts(user)) && (t.show?.() ?? true))
    .map((t) => (t.id === "admin" && !user.isAdmin ? { ...t, label: "Convites" } : t));
  const current = visible.find((t) => t.id === tab) ?? visible[0]!;
  const groups = [...new Set(visible.map((t) => t.group))];
  return (
    <Modal wide title="Configurações" subtitle={current.subtitle} label={current.id === "voice" ? "Configurações de voz" : `Configurações: ${current.label}`} onClose={onClose}>
      <div className="settings-layout">
        <nav className="settings-nav" role="tablist" aria-orientation="vertical" aria-label="Seções das configurações">
          {groups.map((g) => (
            <div key={g} className="settings-group">
              <span className="settings-group-label">{g}</span>
              {visible.filter((t) => t.group === g).map((t) => (
                <button key={t.id} role="tab" type="button" aria-selected={t.id === current.id} className={`settings-tab${t.id === current.id ? " active" : ""}`} onClick={() => onTab(t.id)}>
                  {t.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div role="tabpanel" className="settings-panel">
          {current.id === "profile" && <ProfileSettings user={user} onChanged={onChanged} />}
          {current.id === "account" && <AccountSettings onLogout={onLogout} />}
          {current.id === "voice" && <VoiceSettings voice={voice} prefs={prefs} />}
          {current.id === "notifications" && <NotificationSettings />}
          {current.id === "shortcuts" && <ShortcutSettings />}
          {current.id === "activity" && <ShowGameSetting />}
          {current.id === "games" && <GameAutomationsSetting />}
          {current.id === "desktop" && (
            <>
              <StartupSetting />
              <DesktopDownload />
            </>
          )}
          {current.id === "admin" && (
            <>
              <AppInvitePanel />
              {user.isAdmin && <InvitersPanel me={user.id} />}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
