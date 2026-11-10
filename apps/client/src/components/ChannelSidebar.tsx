import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { shownName, type Channel, type ChannelKind, type VoiceState } from "@turtle/protocol";
import { fileUrl } from "../api";
import { Avatar, Icon, StaffTag, type IconName } from "@turtle/ui";

function Category({ title, onAdd, children }: { title: string; onAdd?: () => void; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="category">
      <div className="category-head">
        <button className="category-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon name={open ? "chevron-down" : "chevron-right"} size={12} />
          <span>{title}</span>
        </button>
        {onAdd && (
          <button className="category-add" title={`Criar canal em ${title.toLowerCase()}`} aria-label={`Criar canal em ${title.toLowerCase()}`} onClick={onAdd}>
            <Icon name="plus" size={16} />
          </button>
        )}
      </div>
      {open && <div className="category-list">{children}</div>}
    </section>
  );
}

function HeaderMenu({ name, canManage, onCreate, onInvite, onSettings, onLeave }: { name: string; canManage: boolean; onCreate: (k: ChannelKind) => void; onInvite: () => void; onSettings: () => void; onLeave?: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  const item = (icon: IconName, label: string, fn: () => void) => (
    <button role="menuitem" className="menu-item" onClick={() => { setOpen(false); fn(); }}>
      <span>{label}</span>
      <Icon name={icon} size={18} />
    </button>
  );
  return (
    <div className="server-head-wrap" ref={ref}>
      <button className={`server-head ${open ? "open" : ""}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="t-display server-name">{name}</span>
        <Icon name={open ? "close" : "chevron-down"} size={18} />
      </button>
      {open && (
        <div className="menu lino" role="menu">
          {item("user-plus", "Convidar pessoas", onInvite)}
          {canManage && (
            <>
              {item("hash", "Criar canal de texto", () => onCreate("text"))}
              {item("speaker", "Criar canal de voz", () => onCreate("voice"))}
            </>
          )}
          {item("settings", "Configurações do servidor", onSettings)}
          {onLeave && (
            <>
              <hr className="t-divider" />
              {item("logout", "Sair do servidor", onLeave)}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function ChannelSidebar({
  serverName,
  canManage,
  channels,
  view,
  current,
  voiceView,
  voiceStates,
  speaking,
  onText,
  onVoice,
  onCreate,
  onInvite,
  onSettings,
  onLeave,
  onProfile,
  onMenu,
  footer,
  unread,
  onEdit,
}: {
  /** Não lidas por canal (count = mensagens, mentions = menções a você). */
  unread: Record<string, { count: number; mentions: number }>;
  /** Abre a edição do canal (só para quem gere o servidor). */
  onEdit: (channel: Channel) => void;
  serverName: string;
  /** Dono ou admin do servidor: cria canais. */
  canManage: boolean;
  channels: Channel[];
  view: "text" | "voice";
  current?: string;
  voiceView?: string;
  voiceStates: VoiceState[];
  /** userIds falando agora (só na chamada em que estou). */
  speaking: Set<string>;
  onText: (id: string) => void;
  onVoice: (id: string) => void;
  onCreate: (kind: ChannelKind) => void;
  onInvite: () => void;
  onSettings: () => void;
  /** Sai do servidor. Ausente para o dono, que não pode sair sem passar a posse. */
  onLeave?: () => void;
  /** Abre o cartão de perfil de quem está na chamada. */
  onProfile: (userId: string) => void;
  /** Clique direito em quem está na chamada (menu da pessoa). */
  onMenu?: (userId: string, e: ReactMouseEvent) => void;
  footer: ReactNode;
}) {
  const text = channels.filter((c) => c.kind === "text");
  const voice = channels.filter((c) => c.kind === "voice");
  return (
    <aside className="sidebar" aria-label="Canais">
      <HeaderMenu name={serverName} canManage={canManage} onCreate={onCreate} onInvite={onInvite} onSettings={onSettings} onLeave={onLeave} />
      <div className="channels">
        <Category title="Canais de texto" onAdd={canManage ? () => onCreate("text") : undefined}>
          {text.map((c) => {
            const on = view === "text" && c.id === current;
            const u = !on ? unread[c.id] : undefined;
            return (
              <div key={c.id} className="channel-row">
                {u && <span className="channel-unread-pill" aria-hidden="true" />}
                <button className={`channel ${on ? "on" : ""} ${u ? "unread" : ""}`} aria-current={on ? "page" : undefined} aria-label={u ? `${c.name} (não lido)` : undefined} onClick={() => onText(c.id)}>
                  <Icon name="hash" size={20} />
                  <span className="channel-name">{c.name}</span>
                  {!!u?.mentions && <span className="dm-badge" aria-label={`${u.mentions} menções`}>{u.mentions}</span>}
                </button>
                {canManage && (
                  <button className="channel-edit" title="Editar canal" aria-label={`Editar canal ${c.name}`} onClick={() => onEdit(c)}>
                    <Icon name="settings" size={16} />
                  </button>
                )}
              </div>
            );
          })}
        </Category>
        <Category title="Canais de voz" onAdd={canManage ? () => onCreate("voice") : undefined}>
          {voice.map((c) => {
            const on = view === "voice" && c.id === voiceView;
            const members = voiceStates.filter((v) => v.channelId === c.id);
            return (
              <div key={c.id}>
                <div className="channel-row">
                  <button className={`channel ${on ? "on" : ""}`} aria-label={`Canal de voz ${c.name}`} onClick={() => onVoice(c.id)}>
                    <Icon name="speaker" size={20} />
                    <span className="channel-name">{c.name}</span>
                  </button>
                  {canManage && (
                    <button className="channel-edit" title="Editar canal" aria-label={`Editar canal ${c.name}`} onClick={() => onEdit(c)}>
                      <Icon name="settings" size={16} />
                    </button>
                  )}
                </div>
                {members.length > 0 && (
                  <ul className="voice-members">
                    {members.map((v) => (
                      <li key={v.userId}>
                        <button className="voice-member-who" title="Ver perfil" onClick={() => onProfile(v.userId)} onContextMenu={onMenu && ((e) => onMenu(v.userId, e))}>
                          <Avatar name={shownName(v)} src={fileUrl(v.avatar)} size={24} speaking={speaking.has(v.userId)} />
                          <span className="voice-member-name">{shownName(v)}</span>
                          {v.staff && <StaffTag />}
                        </button>
                        {v.screen && <span className="live-badge small">AO VIVO</span>}
                        {v.camera && (
                          <span className="vm-flag" title="Câmera ligada"><Icon name="video" size={16} /><span className="sr">câmera ligada</span></span>
                        )}
                        {v.deafened ? (
                          <span className="vm-flag" title="Surdo"><Icon name="headphones-off" size={16} /><span className="sr">surdo</span></span>
                        ) : v.muted ? (
                          <span className="vm-flag" title="Mudo"><Icon name="mic-off" size={16} /><span className="sr">mudo</span></span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </Category>
      </div>
      {footer}
    </aside>
  );
}
