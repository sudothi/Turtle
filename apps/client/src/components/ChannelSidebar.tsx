import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Channel, ChannelKind, User, VoiceState } from "@turtle/protocol";
import { Avatar, Icon, type IconName } from "@turtle/ui";

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

function HeaderMenu({ user, onCreate, onInvite, onLogout }: { user: User; onCreate: (k: ChannelKind) => void; onInvite: () => void; onLogout: () => void }) {
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
        <span className="t-display">Turtle</span>
        <Icon name={open ? "close" : "chevron-down"} size={18} />
      </button>
      {open && (
        <div className="menu lino" role="menu">
          {user.isAdmin && (
            <>
              {item("user-plus", "Convidar pessoas", onInvite)}
              {item("hash", "Criar canal de texto", () => onCreate("text"))}
              {item("speaker", "Criar canal de voz", () => onCreate("voice"))}
              <hr className="t-divider" />
            </>
          )}
          {item("logout", "Sair da conta", onLogout)}
        </div>
      )}
    </div>
  );
}

export function ChannelSidebar({
  user,
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
  onLogout,
  footer,
}: {
  user: User;
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
  onLogout: () => void;
  footer: ReactNode;
}) {
  const text = channels.filter((c) => c.kind === "text");
  const voice = channels.filter((c) => c.kind === "voice");
  return (
    <aside className="sidebar" aria-label="Canais">
      <HeaderMenu user={user} onCreate={onCreate} onInvite={onInvite} onLogout={onLogout} />
      <div className="channels">
        <Category title="Canais de texto" onAdd={user.isAdmin ? () => onCreate("text") : undefined}>
          {text.map((c) => {
            const on = view === "text" && c.id === current;
            return (
              <button key={c.id} className={`channel ${on ? "on" : ""}`} aria-current={on ? "page" : undefined} onClick={() => onText(c.id)}>
                <Icon name="hash" size={20} />
                <span className="channel-name">{c.name}</span>
              </button>
            );
          })}
        </Category>
        <Category title="Canais de voz" onAdd={user.isAdmin ? () => onCreate("voice") : undefined}>
          {voice.map((c) => {
            const on = view === "voice" && c.id === voiceView;
            const members = voiceStates.filter((v) => v.channelId === c.id);
            return (
              <div key={c.id}>
                <button className={`channel ${on ? "on" : ""}`} aria-label={`Canal de voz ${c.name}`} onClick={() => onVoice(c.id)}>
                  <Icon name="speaker" size={20} />
                  <span className="channel-name">{c.name}</span>
                </button>
                {members.length > 0 && (
                  <ul className="voice-members">
                    {members.map((v) => (
                      <li key={v.userId}>
                        <Avatar name={v.username} size={24} speaking={speaking.has(v.userId)} />
                        <span className="voice-member-name">{v.username}</span>
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
