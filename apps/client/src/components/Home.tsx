import { useState, type ReactNode } from "react";
import { shownName, type Dm, type Friend, type Person } from "@turtle/protocol";
import { Avatar, Button, Icon } from "@turtle/ui";
import { api, fileUrl } from "../api";

const byName = (a: { user: Person }, b: { user: Person }) => shownName(a.user).localeCompare(shownName(b.user), "pt-BR");

/** Barra lateral do Início: botão de amigos e a lista de conversas diretas. */
export function HomeSidebar({
  dms, current, unread, online, friendsOpen, pending, onFriends, onDm, onProfile, footer,
}: {
  dms: Dm[];
  current?: string;
  unread: Set<string>;
  online: string[];
  friendsOpen: boolean;
  /** Pedidos de amizade recebidos. */
  pending: number;
  onFriends: () => void;
  onDm: (dm: Dm) => void;
  onProfile: (userId: string) => void;
  footer: ReactNode;
}) {
  return (
    <aside className="sidebar" aria-label="Mensagens diretas">
      <div className="server-head static">
        <span className="t-display server-name">Mensagens diretas</span>
      </div>
      <div className="channels">
        <button className={`channel ${friendsOpen ? "on" : ""}`} aria-current={friendsOpen ? "page" : undefined} onClick={onFriends}>
          <Icon name="users" size={20} />
          <span className="channel-name">Amigos</span>
          {pending > 0 && <span className="dm-badge" aria-label={`${pending} pedidos de amizade`}>{pending}</span>}
        </button>
        <div className="t-eyebrow dm-title">Conversas</div>
        {dms.length === 0 && <p className="t-muted dm-empty">Nenhuma conversa ainda. Abra o perfil de alguém e toque em "Mandar mensagem".</p>}
        {dms.map((d) => {
          const on = !friendsOpen && d.channelId === current;
          return (
            <button key={d.channelId} className={`channel dm ${on ? "on" : ""} ${unread.has(d.channelId) ? "unread" : ""}`} aria-current={on ? "page" : undefined} onClick={() => onDm(d)} onAuxClick={() => onProfile(d.user.id)}>
              <Avatar name={shownName(d.user)} src={fileUrl(d.user.avatar)} size={28} status={online.includes(d.user.id) ? "online" : undefined} statusRing="var(--bg-sidebar)" />
              <span className="channel-name">{shownName(d.user)}</span>
              {unread.has(d.channelId) && <span className="dm-dot" aria-label="não lida" />}
            </button>
          );
        })}
      </div>
      {footer}
    </aside>
  );
}

type Tab = "online" | "all" | "pending" | "add";

/** Aba Amigos: todos, online, pendentes e adicionar por nome de usuário. */
export function FriendsPanel({
  friends, online, onMessage, onProfile, onChanged,
}: {
  friends: Friend[];
  online: string[];
  onMessage: (userId: string) => void;
  onProfile: (userId: string) => void;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<Tab>("online");
  const [name, setName] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string }>();
  const on = new Set(online);
  const accepted = friends.filter((f) => f.status === "friend").sort(byName);
  const pending = friends.filter((f) => f.status !== "friend").sort(byName);
  const list = tab === "online" ? accepted.filter((f) => on.has(f.user.id)) : tab === "all" ? accepted : pending;
  const incoming = friends.filter((f) => f.status === "incoming").length;

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch {
      // a lista é recarregada pelo evento; falha de rede não precisa de aviso aqui
    }
    onChanged();
  };
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const username = name.trim().replace(/^@/, "");
    if (!username) return;
    try {
      const r = await api.addFriendByName(username);
      setNote({ ok: true, text: r.status === "friend" ? `Agora você e ${username} são amigos!` : `Pedido de amizade enviado para ${username}.` });
      setName("");
      onChanged();
    } catch (err) {
      setNote({ ok: false, text: (err as Error).message });
    }
  };

  const tabBtn = (id: Tab, label: string, badge?: number) => (
    <button key={id} className={`friends-tab ${tab === id ? "on" : ""}`} aria-pressed={tab === id} onClick={() => { setTab(id); setNote(undefined); }}>
      {label}
      {!!badge && <span className="dm-badge">{badge}</span>}
    </button>
  );

  return (
    <section className="chat friends" aria-label="Amigos">
      <header className="chat-head">
        <Icon name="users" size={22} className="chat-head-icon" />
        <h1 className="chat-head-name">Amigos</h1>
        <div className="friends-tabs">
          {tabBtn("online", "Online")}
          {tabBtn("all", "Todos")}
          {tabBtn("pending", "Pendentes", incoming)}
          {tabBtn("add", "Adicionar amigo")}
        </div>
      </header>
      {tab === "add" ? (
        <form className="friends-add" onSubmit={add}>
          <h2 className="t-display">Adicionar amigo</h2>
          <p className="t-muted">Digite o nome de usuário da pessoa.</p>
          <div className="friends-add-row lino">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="nome de usuário" aria-label="Nome de usuário" autoComplete="off" maxLength={33} />
            <Button type="submit" disabled={!name.trim()}>Enviar pedido</Button>
          </div>
          {note && <p className={note.ok ? "t-muted" : "friends-error"} role="status">{note.text}</p>}
        </form>
      ) : (
        <div className="friends-list">
          <div className="t-eyebrow">
            {tab === "online" ? "Online" : tab === "all" ? "Todos os amigos" : "Pendentes"} — {list.length}
          </div>
          {list.length === 0 && (
            <p className="t-muted friends-empty">
              {tab === "pending" ? "Nenhum pedido pendente." : tab === "online" ? "Ninguém online agora." : "Você ainda não tem amigos. Use \"Adicionar amigo\"."}
            </p>
          )}
          {list.map((f) => (
            <div key={f.user.id} className="friend-row">
              <button className="plain-btn friend-who" onClick={() => onProfile(f.user.id)}>
                <Avatar name={shownName(f.user)} src={fileUrl(f.user.avatar)} size={36} status={on.has(f.user.id) ? "online" : undefined} statusRing="var(--bg-chat, var(--bg-sidebar))" />
                <span>
                  <b>{shownName(f.user)}</b>
                  <span className="t-muted"> @{f.user.username}{f.status === "incoming" ? " · quer ser seu amigo" : f.status === "outgoing" ? " · pedido enviado" : ""}</span>
                </span>
              </button>
              <div className="friend-actions">
                {f.status === "friend" && <Button variant="ghost" onClick={() => onMessage(f.user.id)}>Mensagem</Button>}
                {f.status === "incoming" && <Button onClick={() => act(() => api.addFriend(f.user.id))}>Aceitar</Button>}
                <Button variant="ghost" onClick={() => act(() => api.removeFriend(f.user.id))}>
                  {f.status === "friend" ? "Desfazer" : f.status === "incoming" ? "Recusar" : "Cancelar"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
