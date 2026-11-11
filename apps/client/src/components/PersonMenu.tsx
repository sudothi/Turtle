import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { NICKNAME_MAX, memberName, type Channel, type Member, type Server, type VoiceState } from "@turtle/protocol";
import { Button, Icon, Modal, TextField, type IconName } from "@turtle/ui";
import { api } from "../api";
import { MAX_VOLUME } from "../voice/prefs";
import type { VoiceClient, VoiceSnapshot } from "../voice/client";
import { useSoundboard } from "./Soundboard";
import { soundboard } from "../soundboard";

/** Onde o menu abre: a pessoa e o ponto do clique. */
export interface PersonMenuTarget {
  userId: string;
  x: number;
  y: number;
}

/** Abre o menu no ponto do clique direito (ou do toque longo, que o navegador do celular também manda como contextmenu). */
export const openAt = (userId: string, e: { clientX: number; clientY: number; preventDefault: () => void }): PersonMenuTarget => {
  e.preventDefault();
  return { userId, x: e.clientX, y: e.clientY };
};

/** Dono modera qualquer um; admin só membro comum (as mesmas regras do servidor). */
const canModerate = (mine: Server["role"] | undefined, theirs: Member["role"] | undefined) =>
  mine === "owner" || (mine === "admin" && theirs === "member");

/**
 * Menu do clique direito numa pessoa, como no Discord: perfil, mensagem, volume e silenciar para mim
 * (se ela está na sua chamada), apelido, mover/desconectar da chamada, expulsar e banir.
 * Só aparece o que você tem permissão para fazer.
 */
export function PersonMenu({
  target, meId, server, members, voiceStates, voiceChannels, snap, voice, fallbackName, onProfile, onMessage, onClose,
}: {
  target: PersonMenuTarget;
  meId: string;
  /** Servidor aberto (sem ele, só as ações pessoais). */
  server?: Server;
  members: Member[];
  voiceStates: VoiceState[];
  /** Canais de voz do servidor aberto (destinos de "Mover para"). */
  voiceChannels: Channel[];
  snap: VoiceSnapshot;
  voice: VoiceClient;
  /** Nome a mostrar se a pessoa não estiver na lista de membros (conversa direta). */
  fallbackName?: string;
  onProfile: (userId: string) => void;
  onMessage: (userId: string) => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: target.x, top: target.y });
  const [moving, setMoving] = useState(false);
  const [nicking, setNicking] = useState(false);
  const { userId } = target;
  const self = userId === meId;
  const m = members.find((x) => x.userId === userId);
  const name = m ? memberName(m) : fallbackName ?? "Pessoa";
  const mod = !!server && !!m && !self && canModerate(server.role, m.role);
  const call = server ? voiceStates.find((v) => v.userId === userId && v.serverId === server.id) : undefined;
  const inMyCall = !self && snap.status !== "idle" && snap.participants.some((p) => p.id === userId && !p.isLocal);
  const volume = snap.prefs.volumes[userId] ?? 1;
  const mutedForMe = !!snap.prefs.localMutes[userId];
  const sb = useSoundboard();
  const soundsMuted = !!sb.prefs.mutedUsers[userId];
  const destinations = voiceChannels.filter((c) => c.id !== call?.channelId);

  // Mantém o menu dentro da janela (abre para cima/esquerda perto da borda).
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 8;
    setPos({
      left: Math.max(pad, Math.min(target.x, window.innerWidth - r.width - pad)),
      top: Math.max(pad, Math.min(target.y, window.innerHeight - r.height - pad)),
    });
  }, [target.x, target.y, moving]);

  // Foco no primeiro item; fecha com clique fora, Esc, rolagem ou redimensionamento.
  useEffect(() => {
    box.current?.querySelector<HTMLElement>("[role=menuitem], input")?.focus();
  }, [moving]);
  useEffect(() => {
    if (nicking) return;
    const off = (e: Event) => !box.current?.contains(e.target as Node) && onClose();
    const esc = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", off);
    window.addEventListener("touchstart", off);
    window.addEventListener("keydown", esc);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", off);
      window.removeEventListener("touchstart", off);
      window.removeEventListener("keydown", esc);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose, nicking]);

  // Setas para cima/baixo andam entre os itens.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = [...(box.current?.querySelectorAll<HTMLElement>("[role=menuitem], [role=menuitemcheckbox], input") ?? [])];
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  };

  const run = (fn: () => Promise<unknown>) => {
    onClose();
    fn().catch((err: Error) => window.alert(err.message));
  };
  const item = (label: ReactNode, fn: () => void, icon?: IconName, danger = false) => (
    <button role="menuitem" className={`menu-item ${danger ? "danger" : ""}`} onClick={fn}>
      <span>{label}</span>
      {icon && <Icon name={icon} size={16} />}
    </button>
  );

  if (nicking && server && m)
    return <NicknameModal server={server} member={m} self={self} onClose={onClose} />;

  return (
    <div
      ref={box}
      className="menu person-menu lino"
      role="menu"
      aria-label={`Ações para ${name}`}
      style={{ left: pos.left, top: pos.top }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {moving ? (
        <>
          {item("Voltar", () => setMoving(false), "chevron-left")}
          <hr className="t-divider" />
          <p className="person-menu-title t-eyebrow">Mover {name} para</p>
          {destinations.map((c) => item(c.name, () => run(() => api.moveVoice(server!.id, userId, c.id)), "speaker"))}
        </>
      ) : (
        <>
          {item("Perfil", () => { onClose(); onProfile(userId); }, "profile")}
          {!self && item("Mensagem", () => { onClose(); onMessage(userId); }, "chat")}
          {inMyCall && (
            <>
              <hr className="t-divider" />
              <label className="person-menu-volume">
                <span>Volume do usuário <b>{Math.round(mutedForMe ? 0 : volume * 100)}%</b></span>
                <input
                  type="range" min={0} max={MAX_VOLUME} step={0.01}
                  aria-label={`Volume de ${name}`}
                  value={mutedForMe ? 0 : volume}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (mutedForMe && v > 0) voice.setLocalMute(userId, false);
                    voice.setVolume(userId, v);
                  }}
                />
              </label>
              <button role="menuitemcheckbox" aria-checked={mutedForMe} className="menu-item" onClick={() => voice.setLocalMute(userId, !mutedForMe)}>
                <span>Silenciar para mim</span>
                <span className={`person-menu-check ${mutedForMe ? "on" : ""}`} aria-hidden>{mutedForMe && <Icon name="check" size={14} />}</span>
              </button>
              <button role="menuitemcheckbox" aria-checked={soundsMuted} className="menu-item" onClick={() => soundboard.setUserMuted(userId, !soundsMuted)}>
                <span>Silenciar soundboard</span>
                <span className={`person-menu-check ${soundsMuted ? "on" : ""}`} aria-hidden>{soundsMuted && <Icon name="check" size={14} />}</span>
              </button>
            </>
          )}
          {server && m && (self || mod) && (
            <>
              <hr className="t-divider" />
              {item(self ? "Alterar meu apelido" : "Alterar apelido", () => setNicking(true), "pencil")}
            </>
          )}
          {mod && call && (
            <>
              <hr className="t-divider" />
              {destinations.length > 0 && item("Mover para…", () => setMoving(true), "chevron-right")}
              {item("Desconectar da chamada", () => run(() => api.disconnectVoice(server!.id, userId)), "phone-off", true)}
            </>
          )}
          {mod && (
            <>
              <hr className="t-divider" />
              {item(`Expulsar ${name}`, () => {
                if (window.confirm(`Expulsar ${name} de ${server!.name}? A pessoa pode voltar com um convite.`)) run(() => api.removeMember(server!.id, userId));
                else onClose();
              }, "logout", true)}
              {item(`Banir ${name}`, () => {
                if (window.confirm(`Banir ${name} de ${server!.name}? A pessoa sai e não consegue voltar, nem com convite.`)) run(() => api.banMember(server!.id, userId));
                else onClose();
              }, "lock", true)}
            </>
          )}
        </>
      )}
    </div>
  );
}

/** Trocar o apelido de alguém (ou o seu) neste servidor. Vazio volta ao nome da conta. */
function NicknameModal({ server, member, self, onClose }: { server: Server; member: Member; self: boolean; onClose: () => void }) {
  const [value, setValue] = useState(member.nickname ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (nickname: string | null) => {
    setBusy(true);
    try {
      await api.setNickname(server.id, member.userId, nickname);
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal
      title={self ? "Alterar meu apelido" : "Alterar apelido"}
      subtitle={`Só vale em ${server.name}. Deixe vazio para usar ${member.displayName || member.username}.`}
      onClose={onClose}
      footer={
        <>
          {member.nickname && <Button variant="ghost" disabled={busy} onClick={() => void save(null)}>Tirar apelido</Button>}
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button disabled={busy} onClick={() => void save(value.trim() || null)}>Salvar</Button>
        </>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); void save(value.trim() || null); }}>
        <TextField
          label="Apelido"
          value={value}
          maxLength={NICKNAME_MAX}
          placeholder={member.displayName || member.username}
          autoFocus
          error={error || undefined}
          onChange={(e) => { setValue(e.target.value); setError(""); }}
        />
      </form>
    </Modal>
  );
}
