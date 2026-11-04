import { canInviteAccounts, type User } from "@turtle/protocol";
import { Modal } from "@turtle/ui";
import type { VoiceClient } from "../voice/client";
import { VoiceSettings } from "../voice/VoiceSettings";
import { AppInvitePanel, InvitersPanel } from "./modals";
import { ProfileSettings } from "./ProfileSettings";

export type SettingsTab = "profile" | "voice" | "admin";

const tabs: { id: SettingsTab; label: string; subtitle: string }[] = [
  { id: "profile", label: "Perfil", subtitle: "Como as pessoas veem você" },
  { id: "voice", label: "Voz", subtitle: "Microfone, saída e ruído" },
  { id: "admin", label: "Administração", subtitle: "Convites para criar conta no Turtle" },
];

/** Configurações do usuário em abas. A aba Voz mantém o nome "Configurações de voz" (usado nos testes e2e). */
export function SettingsModal({ user, voice, prefs, tab, onTab, onChanged, onClose }: {
  user: User;
  voice: VoiceClient;
  prefs: Parameters<typeof VoiceSettings>[0]["prefs"];
  tab: SettingsTab;
  onTab: (t: SettingsTab) => void;
  onChanged: (u: User) => void;
  onClose: () => void;
}) {
  // Quem só tem o cargo Convidador vê a aba como "Convites".
  const visible = tabs
    .filter((t) => t.id !== "admin" || canInviteAccounts(user))
    .map((t) => (t.id === "admin" && !user.isAdmin ? { ...t, label: "Convites" } : t));
  const current = visible.find((t) => t.id === tab) ?? tabs[0]!;
  return (
    <Modal wide title="Configurações" subtitle={current.subtitle} label={current.id === "voice" ? "Configurações de voz" : `Configurações: ${current.label}`} onClose={onClose}>
      <div className="settings-tabs" role="tablist">
        {visible.map((t) => (
          <button key={t.id} role="tab" type="button" aria-selected={t.id === current.id} className={`settings-tab${t.id === current.id ? " active" : ""}`} onClick={() => onTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="settings-panel">
        {current.id === "profile" && <ProfileSettings user={user} onChanged={onChanged} />}
        {current.id === "voice" && <VoiceSettings voice={voice} prefs={prefs} />}
        {current.id === "admin" && (
          <>
            <AppInvitePanel />
            {user.isAdmin && <InvitersPanel me={user.id} />}
          </>
        )}
      </div>
    </Modal>
  );
}
