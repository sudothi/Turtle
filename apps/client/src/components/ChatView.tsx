import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { encodeMentions, mentionedIds, shownName, splitMentions, type Channel, type Member, type Message } from "@turtle/protocol";
import { Avatar, Icon, IconButton, StaffTag } from "@turtle/ui";
import { shortTime, stamp, toRows } from "../format";
import { fileUrl } from "../api";

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

/** Texto da mensagem com as menções `<@id>` trocadas pelo nome de exibição atual. */
function MessageText({ content, names, onProfile }: { content: string; names: Map<string, string>; onProfile: (id: string) => void }) {
  return (
    <div className="msg-text">
      {splitMentions(content).map((p, i) =>
        "text" in p ? (
          p.text
        ) : (
          <button key={i} type="button" className="plain-btn mention" onClick={() => onProfile(p.userId)}>
            @{names.get(p.userId) ?? "alguém"}
          </button>
        ),
      )}
    </div>
  );
}

/** `@algo` logo antes do cursor: o que está sendo digitado para mencionar. */
const mentionQuery = (value: string, caret: number) => /(?:^|\s)@([^\s@]{0,32})$/u.exec(value.slice(0, caret))?.[1];

export function ChatView({
  channel,
  messages,
  members,
  meId,
  onSend,
  membersOpen,
  onToggleMembers,
  canInvite,
  onInvite,
  onProfile,
}: {
  channel?: Channel;
  messages: Message[];
  members: Member[];
  meId: string;
  onSend: (content: string) => void;
  membersOpen: boolean;
  onToggleMembers: () => void;
  canInvite: boolean;
  onInvite: () => void;
  onProfile: (userId: string) => void;
}) {
  const bottom = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => toRows(messages), [messages]);
  useEffect(() => {
    bottom.current?.scrollIntoView();
  }, [messages]);

  const names = useMemo(() => new Map(members.map((m) => [m.userId, shownName(m)])), [members]);
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [query, setQuery] = useState<string>();
  const [pick, setPick] = useState(0);
  // Onde pôr o cursor depois de escolher uma menção (aplicado logo após o render).
  const caretAfter = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (caretAfter.current === null || !input.current) return;
    input.current.focus();
    input.current.setSelectionRange(caretAfter.current, caretAfter.current);
    caretAfter.current = null;
  }, [text]);
  const suggestions = useMemo(() => {
    if (query === undefined) return [];
    const q = query.toLocaleLowerCase("pt-BR");
    return members
      .filter((m) => shownName(m).toLocaleLowerCase("pt-BR").includes(q) || m.username.toLocaleLowerCase("pt-BR").includes(q))
      .sort((a, b) => shownName(a).localeCompare(shownName(b), "pt-BR"))
      .slice(0, 8);
  }, [query, members]);

  const onType = (value: string, caret: number) => {
    setText(value);
    setQuery(mentionQuery(value, caret));
    setPick(0);
  };
  const choose = (m: Member) => {
    const caret = input.current?.selectionStart ?? text.length;
    const start = text.slice(0, caret).lastIndexOf("@");
    const next = `${text.slice(0, start)}@${shownName(m)} ${text.slice(caret)}`;
    setText(next);
    setQuery(undefined);
    caretAfter.current = start + shownName(m).length + 2;
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!suggestions.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setPick((p) => (p + (e.key === "ArrowDown" ? 1 : suggestions.length - 1)) % suggestions.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      choose(suggestions[pick]!);
    } else if (e.key === "Escape") {
      setQuery(undefined);
    }
  };

  const send = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!text.trim()) return;
    onSend(encodeMentions(text, members));
    setText("");
    setQuery(undefined);
  };
  const mentionsMe = (m: Message) => mentionedIds(m.content).includes(meId);

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
            <article key={r.key} className={`msg head${mentionsMe(r.message) ? " mentioned" : ""}`}>
              <button type="button" className="plain-btn" aria-label={`Perfil de ${shownName(r.message)}`} onClick={() => onProfile(r.message.userId)}>
                <Avatar name={shownName(r.message)} src={fileUrl(r.message.avatar)} size={40} />
              </button>
              <div className="msg-body">
                <div className="msg-meta">
                  <button type="button" className="plain-btn msg-author" onClick={() => onProfile(r.message.userId)}>
                    <b>{shownName(r.message)}</b>
                  </button>
                  {r.message.staff && <StaffTag />}
                  <time dateTime={r.message.createdAt}>{stamp(r.message.createdAt)}</time>
                </div>
                <MessageText content={r.message.content} names={names} onProfile={onProfile} />
              </div>
            </article>
          ) : (
            <article key={r.key} className={`msg${mentionsMe(r.message) ? " mentioned" : ""}`}>
              <time className="msg-gutter" dateTime={r.message.createdAt}>
                {shortTime(r.message.createdAt)}
              </time>
              <div className="msg-body">
                <MessageText content={r.message.content} names={names} onProfile={onProfile} />
              </div>
            </article>
          ),
        )}
        <div ref={bottom} className="messages-end" />
      </div>

      <form className="composer" onSubmit={send}>
        {suggestions.length > 0 && (
          <div className="mention-menu lino" role="listbox" aria-label="Mencionar">
            {suggestions.map((m, i) => (
              <button
                key={m.userId}
                type="button"
                role="option"
                aria-selected={i === pick}
                className={`mention-option${i === pick ? " active" : ""}`}
                onMouseDown={(e) => { e.preventDefault(); choose(m); }}
              >
                <Avatar name={shownName(m)} src={fileUrl(m.avatar)} size={24} />
                <b>{shownName(m)}</b>
                {m.displayName && <span className="t-muted">@{m.username}</span>}
              </button>
            ))}
          </div>
        )}
        <div className="composer-box lino">
          <input
            ref={input}
            name="text"
            value={text}
            onChange={(e) => onType(e.target.value, e.target.selectionStart ?? e.target.value.length)}
            onKeyDown={onKey}
            onBlur={() => setQuery(undefined)}
            placeholder={`Conversar em #${channel.name}`}
            autoComplete="off"
            aria-label={`Mensagem para #${channel.name}`}
            maxLength={4000}
          />
          <button type="submit" className="composer-send" title="Enviar" aria-label="Enviar">
            <Icon name="send" size={20} />
          </button>
        </div>
      </form>
    </section>
  );
}
