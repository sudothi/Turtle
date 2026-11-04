import { useEffect, useMemo, useRef, type FormEvent } from "react";
import type { Channel, Message } from "@turtle/protocol";
import { Avatar, Icon, IconButton } from "@turtle/ui";
import { shortTime, stamp, toRows } from "../format";

/** Tamanho da página de histórico do servidor: se veio menos, estamos no começo do canal. */
const PAGE = 50;

export function ChannelHeader({ icon, name, children }: { icon: "hash" | "speaker"; name: string; children?: React.ReactNode }) {
  return (
    <header className="chat-head">
      <Icon name={icon} size={22} className="chat-head-icon" />
      <h1 className="chat-head-name">{name}</h1>
      <div className="chat-head-actions">{children}</div>
    </header>
  );
}

export function ChatView({
  channel,
  messages,
  onSend,
  membersOpen,
  onToggleMembers,
  canInvite,
  onInvite,
}: {
  channel?: Channel;
  messages: Message[];
  onSend: (content: string) => void;
  membersOpen: boolean;
  onToggleMembers: () => void;
  canInvite: boolean;
  onInvite: () => void;
}) {
  const bottom = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => toRows(messages), [messages]);
  useEffect(() => {
    bottom.current?.scrollIntoView();
  }, [messages]);

  const send = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem("text") as HTMLInputElement;
    if (!input.value.trim()) return;
    onSend(input.value);
    input.value = "";
  };

  if (!channel) return <section className="chat" />;
  return (
    <section className="chat">
      <ChannelHeader icon="hash" name={channel.name}>
        {canInvite && (
          <IconButton label="Convidar pessoas" onClick={onInvite}>
            <Icon name="user-plus" />
          </IconButton>
        )}
        <IconButton label={membersOpen ? "Ocultar lista de membros" : "Mostrar lista de membros"} active={membersOpen} onClick={onToggleMembers}>
          <Icon name="users" />
        </IconButton>
      </ChannelHeader>

      <div className="messages" role="log" aria-label={`Mensagens em #${channel.name}`}>
        {messages.length < PAGE && (
          <div className="channel-welcome">
            <div className="channel-welcome-icon lino lino-lg">
              <Icon name="hash" size={44} />
            </div>
            <h2 className="t-display">Bem-vindo(a) a #{channel.name}!</h2>
            <p className="t-muted">Este é o começo do canal #{channel.name}.</p>
          </div>
        )}
        {rows.map((r) =>
          r.kind === "day" ? (
            <div key={r.key} className="day-divider" role="separator">
              <span>{r.label}</span>
            </div>
          ) : r.head ? (
            <article key={r.key} className="msg head">
              <Avatar name={r.message.username} size={40} />
              <div className="msg-body">
                <div className="msg-meta">
                  <b className="msg-author">{r.message.username}</b>
                  <time dateTime={r.message.createdAt}>{stamp(r.message.createdAt)}</time>
                </div>
                <div className="msg-text">{r.message.content}</div>
              </div>
            </article>
          ) : (
            <article key={r.key} className="msg">
              <time className="msg-gutter" dateTime={r.message.createdAt}>
                {shortTime(r.message.createdAt)}
              </time>
              <div className="msg-body">
                <div className="msg-text">{r.message.content}</div>
              </div>
            </article>
          ),
        )}
        <div ref={bottom} className="messages-end" />
      </div>

      <form className="composer" onSubmit={send}>
        <div className="composer-box lino">
          <input name="text" placeholder={`Conversar em #${channel.name}`} autoComplete="off" aria-label={`Mensagem para #${channel.name}`} maxLength={4000} />
          <button type="submit" className="composer-send" title="Enviar" aria-label="Enviar">
            <Icon name="send" size={20} />
          </button>
        </div>
      </form>
    </section>
  );
}
