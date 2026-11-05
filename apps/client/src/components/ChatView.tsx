import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent } from "react";
import {
  ATTACHMENT_MAX_BYTES, MAX_ATTACHMENTS, MENTION_RE, encodeMentions, isInlineImage, mentionedIds, shownName, splitMentions,
  type Attachment, type Channel, type Member, type Message,
} from "@turtle/protocol";
import { Avatar, Icon, IconButton, StaffTag } from "@turtle/ui";
import { shortTime, stamp, toRows } from "../format";
import { api, fileUrl } from "../api";
import { useMobile, useMobileBack } from "../mobile";

/** Botão "voltar" do celular (só aparece no layout de uma tela por vez). */
export function BackButton() {
  const back = useMobileBack();
  if (!back) return null;
  return (
    <IconButton label="Voltar" className="m-back" onClick={back}>
      <Icon name="chevron-left" size={24} />
    </IconButton>
  );
}

export function ChannelHeader({ icon, name, children }: { icon: "hash" | "speaker" | "users"; name: string; children?: React.ReactNode }) {
  return (
    <header className="chat-head">
      <BackButton />
      <Icon name={icon} size={22} className="chat-head-icon" />
      <h1 className="chat-head-name">{name}</h1>
      <div className="chat-head-actions">{children}</div>
    </header>
  );
}

/** Texto da mensagem com as menções `<@id>` trocadas pelo nome de exibição atual. */
function MessageText({ content, names, onProfile, edited }: { content: string; names: Map<string, string>; onProfile: (id: string) => void; edited?: string | null }) {
  if (!content && !edited) return null;
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
      {edited && <span className="msg-edited" title={`Editada: ${stamp(edited)}`}> (editado)</span>}
    </div>
  );
}

/** Volta `<@id>` para `@Nome`, para editar o texto como foi digitado. */
const decodeMentions = (content: string, names: Map<string, string>) => content.replace(MENTION_RE, (_, id: string) => `@${names.get(id) ?? "alguém"}`);

export const formatSize = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0).replace(".", ",")} MB`;

/** Imagens aparecem no chat (com o espaço já reservado, para a rolagem não pular); o resto vira cartão de download. */
function Attachments({ items, onOpen, onLoad }: { items: Attachment[]; onOpen: (a: Attachment) => void; onLoad: () => void }) {
  if (!items.length) return null;
  return (
    <div className="msg-files">
      {items.map((a) =>
        isInlineImage(a) ? (
          <button key={a.id} type="button" className="msg-image" title={a.name} onClick={() => onOpen(a)} style={imageBox(a)}>
            <img src={fileUrl(a.key)!} alt={a.name} loading="lazy" onLoad={onLoad} />
          </button>
        ) : (
          <a key={a.id} className="msg-file lino" href={fileUrl(a.key)!} download={a.name}>
            <Icon name="file" size={30} />
            <span className="msg-file-text">
              <b>{a.name}</b>
              <span className="t-muted">{formatSize(a.size)}</span>
            </span>
          </a>
        ),
      )}
    </div>
  );
}
const imageBox = (a: Attachment) => {
  const w = a.width ?? 400;
  const h = a.height ?? 300;
  const scale = Math.min(1, 400 / w, 300 / h);
  return { width: Math.max(40, Math.round(w * scale)), aspectRatio: `${w} / ${h}` };
};

function Lightbox({ item, onClose }: { item: Attachment; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="lightbox" role="dialog" aria-label={item.name} onClick={onClose}>
      <img src={fileUrl(item.key)!} alt={item.name} onClick={(e) => e.stopPropagation()} />
      <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <span>{item.name}</span>
        <a href={fileUrl(item.key)!} download={item.name}>Baixar</a>
        <button type="button" className="plain-btn" onClick={onClose}>Fechar</button>
      </div>
    </div>
  );
}

/** Arquivo escolhido e ainda subindo (ou pronto) antes de enviar a mensagem. */
interface Pending {
  id: string;
  file: File;
  preview?: string;
  progress: number;
  done?: Attachment;
  error?: string;
  abort: AbortController;
}

/** Edição no lugar da mensagem: Enter salva, Esc cancela. */
function EditBox({ initial, onSave, onCancel }: { initial: string; onSave: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") { e.preventDefault(); onCancel(); }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSave(text); }
  };
  return (
    <div className="msg-edit">
      <textarea ref={ref} className="lino" value={text} rows={1} maxLength={4000} aria-label="Editar mensagem" onChange={(e) => setText(e.target.value)} onKeyDown={onKey} />
      <p className="t-muted">
        Esc para <button type="button" className="plain-btn link" onClick={onCancel}>cancelar</button> · Enter para{" "}
        <button type="button" className="plain-btn link" onClick={() => onSave(text)}>salvar</button>
      </p>
    </div>
  );
}

/** Menu de ações de uma mensagem no celular (abre com toque longo), vindo de baixo. */
function MessageSheet({ message, text, canEdit, canDelete, onEdit, onDelete, onProfile, onClose }: { message: Message; text: string; canEdit: boolean; canDelete: boolean; onEdit: () => void; onDelete: () => void; onProfile: () => void; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(onClose, 600); }).catch(() => {});
  };
  return (
    <div className="m-sheet-wrap" role="presentation" onClick={onClose}>
      <div className="m-sheet lino" role="menu" aria-label="Ações da mensagem" onClick={(e) => e.stopPropagation()}>
        <div className="m-sheet-grip" aria-hidden="true" />
        <p className="m-sheet-preview t-muted"><b>{shownName(message)}</b> {text || (message.attachments.length ? "(arquivo)" : "")}</p>
        {text && <button type="button" role="menuitem" className="m-sheet-item" onClick={copy}><Icon name="file" size={20} /> {copied ? "Copiado!" : "Copiar texto"}</button>}
        {canEdit && <button type="button" role="menuitem" className="m-sheet-item" onClick={onEdit}><Icon name="pencil" size={20} /> Editar mensagem</button>}
        <button type="button" role="menuitem" className="m-sheet-item" onClick={onProfile}><Icon name="profile" size={20} /> Ver perfil</button>
        {canDelete && <button type="button" role="menuitem" className="m-sheet-item danger" onClick={onDelete}><Icon name="trash" size={20} /> Apagar mensagem</button>}
        <button type="button" className="m-sheet-cancel" onClick={onClose}>Cancelar</button>
      </div>
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
  dm,
  headerExtra,
  hasMore,
  onLoadOlder,
  canModerate,
}: {
  /** Conversa direta: `channel.name` é o nome da pessoa; sem convite nem lista de membros. */
  dm?: boolean;
  /** Botões extras no cabeçalho (ligar, bloquear, sair do grupo). */
  headerExtra?: React.ReactNode;
  channel?: Channel;
  messages: Message[];
  members: Member[];
  meId: string;
  onSend: (content: string, attachments: string[]) => void;
  membersOpen: boolean;
  onToggleMembers: () => void;
  canInvite: boolean;
  onInvite: () => void;
  onProfile: (userId: string) => void;
  /** Ainda há mensagens mais antigas no servidor. */
  hasMore: boolean;
  /** Busca a página anterior (devolve quando terminar). */
  onLoadOlder: () => Promise<void>;
  /** Dono/admin do servidor: pode apagar mensagens dos outros. */
  canModerate?: boolean;
}) {
  const list = useRef<HTMLDivElement>(null);
  const mobile = useMobile();
  /** Mensagem com o menu de ações aberto (toque longo no celular). */
  const [sheet, setSheet] = useState<Message>();
  /** Lendo mensagens antigas: mostra o botão de voltar ao fim. */
  const [away, setAway] = useState(false);
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | undefined>(undefined);
  /** O toque longo abriu o menu: o "clique" que vem ao soltar o dedo não deve abrir mais nada. */
  const fired = useRef(false);
  const startPress = (m: Message, e: React.TouchEvent) => {
    const t = e.touches[0];
    if (!mobile || !t || editing === m.id) return;
    clearTimeout(press.current?.timer);
    fired.current = false;
    press.current = { x: t.clientX, y: t.clientY, timer: setTimeout(() => { press.current = undefined; fired.current = true; navigator.vibrate?.(15); setSheet(m); }, 450) };
  };
  const movePress = (e: React.TouchEvent) => {
    const p = press.current;
    const t = e.touches[0];
    if (p && t && Math.hypot(t.clientX - p.x, t.clientY - p.y) > 10) { clearTimeout(p.timer); press.current = undefined; }
  };
  const endPress = (e: React.TouchEvent) => {
    clearTimeout(press.current?.timer);
    press.current = undefined;
    if (fired.current) { e.preventDefault(); fired.current = false; }
  };
  const pressHandlers = (m: Message) => (mobile ? { onTouchStart: (e: React.TouchEvent) => startPress(m, e), onTouchMove: movePress, onTouchEnd: endPress, onTouchCancel: endPress, onContextMenu: (e: React.MouseEvent) => e.preventDefault() } : {});
  const rows = useMemo(() => toRows(messages), [messages]);
  const names = useMemo(() => new Map(members.map((m) => [m.userId, shownName(m)])), [members]);

  // ---- Rolagem: fica no fim quando já estava no fim; ao carregar as antigas, não pula. ----
  const atBottom = useRef(true);
  const prepending = useRef<{ height: number; top: number } | null>(null);
  const loadingOlder = useRef(false);
  const lastId = useRef<string | undefined>(undefined);
  const firstId = useRef<string | undefined>(undefined);
  const toBottom = useCallback(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);
  useEffect(() => {
    atBottom.current = true;
    lastId.current = undefined;
    prepending.current = null;
    setAway(false);
    setSheet(undefined);
  }, [channel?.id]);
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const first = messages[0]?.id;
    const grewOnTop = first !== firstId.current;
    firstId.current = first;
    if (prepending.current && grewOnTop) {
      // Mantém na tela a mesma mensagem que estava antes de as antigas entrarem em cima.
      el.scrollTop = prepending.current.top + (el.scrollHeight - prepending.current.height);
      prepending.current = null;
      lastId.current = messages.at(-1)?.id;
      return;
    }
    const last = messages.at(-1);
    const isNew = last?.id !== lastId.current;
    lastId.current = last?.id;
    if (atBottom.current || (isNew && last?.userId === meId)) toBottom();
  }, [messages, meId, toBottom]);
  const onScroll = () => {
    const el = list.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    const far = el.scrollHeight - el.scrollTop - el.clientHeight > 600;
    if (far !== away) setAway(far);
    if (el.scrollTop < 300 && hasMore && !loadingOlder.current && messages.length) {
      loadingOlder.current = true;
      prepending.current = { height: el.scrollHeight, top: el.scrollTop };
      void onLoadOlder().finally(() => {
        loadingOlder.current = false;
        // Se não veio nada, esquece a posição guardada (depois que o React desenhar).
        requestAnimationFrame(() => (prepending.current = null));
      });
    }
  };
  // A lista mudou de tamanho (teclado do celular abriu, a conversa saiu de uma tela escondida):
  // se estava no fim, continua no fim.
  useEffect(() => {
    const el = list.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => { if (atBottom.current) el.scrollTop = el.scrollHeight; });
    ro.observe(el);
    return () => ro.disconnect();
  }, [channel?.id]);
  const onMediaLoad = () => {
    if (atBottom.current) toBottom();
  };

  // ---- Compositor: texto, menções e anexos ----
  const input = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [query, setQuery] = useState<string>();
  const [pick, setPick] = useState(0);
  const [pending, setPending] = useState<Pending[]>([]);
  const [fileError, setFileError] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState<string>();
  const [viewing, setViewing] = useState<Attachment>();
  const filePicker = useRef<HTMLInputElement>(null);
  // Trocar de conversa limpa o que estava sendo escrito e cancela os envios.
  useEffect(() => {
    setText("");
    setEditing(undefined);
    setFileError(undefined);
    setPending((p) => {
      for (const x of p) {
        x.abort.abort();
        if (x.preview) URL.revokeObjectURL(x.preview);
      }
      return [];
    });
  }, [channel?.id]);
  // Onde pôr o cursor depois de escolher uma menção (aplicado logo após o render).
  const caretAfter = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
    if (caretAfter.current === null) return;
    el.focus();
    el.setSelectionRange(caretAfter.current, caretAfter.current);
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

  const addFiles = (files: File[]) => {
    if (!channel || !files.length) return;
    setFileError(undefined);
    const room = MAX_ATTACHMENTS - pending.length;
    if (files.length > room) setFileError(`No máximo ${MAX_ATTACHMENTS} arquivos por mensagem.`);
    const next: Pending[] = [];
    for (const file of files.slice(0, Math.max(0, room))) {
      if (file.size > ATTACHMENT_MAX_BYTES) {
        setFileError(`"${file.name}" passa de ${ATTACHMENT_MAX_BYTES / 1024 / 1024} MB.`);
        continue;
      }
      const p: Pending = {
        id: `${Date.now()}-${Math.random()}`,
        file,
        preview: /^image\/(png|jpeg|gif|webp)$/.test(file.type) ? URL.createObjectURL(file) : undefined,
        progress: 0,
        abort: new AbortController(),
      };
      next.push(p);
      const update = (patch: Partial<Pending>) => setPending((l) => l.map((x) => (x.id === p.id ? { ...x, ...patch } : x)));
      api
        .uploadAttachment(channel.id, file, (progress) => update({ progress }), p.abort.signal)
        .then((done) => update({ done, progress: 1 }))
        .catch((e: Error) => !p.abort.signal.aborted && update({ error: e.message }));
    }
    setPending((l) => [...l, ...next]);
    input.current?.focus();
  };
  const removePending = (id: string) =>
    setPending((l) => {
      const p = l.find((x) => x.id === id);
      p?.abort.abort();
      if (p?.preview) URL.revokeObjectURL(p.preview);
      return l.filter((x) => x.id !== id);
    });
  const uploading = pending.some((p) => !p.done && !p.error);

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
  const send = (e?: FormEvent) => {
    e?.preventDefault();
    if (uploading) return;
    const ready = pending.filter((p) => p.done).map((p) => p.done!.id);
    if (!text.trim() && !ready.length) return;
    onSend(encodeMentions(text.trim(), members), ready);
    for (const p of pending) if (p.preview) URL.revokeObjectURL(p.preview);
    setPending([]);
    setFileError(undefined);
    setText("");
    setQuery(undefined);
    atBottom.current = true;
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setPick((p) => (p + (e.key === "ArrowDown" ? 1 : suggestions.length - 1)) % suggestions.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        choose(suggestions[pick]!);
        return;
      }
      if (e.key === "Escape") return setQuery(undefined);
    }
    // No celular, Enter quebra a linha (como no Discord); envia pelo botão.
    if (mobile && e.key === "Enter") return;
    // Seta para cima com a caixa vazia: edita a sua última mensagem, como no Discord.
    if (e.key === "ArrowUp" && !text) {
      const mine = [...messages].reverse().find((m) => m.userId === meId && m.content);
      if (mine) {
        e.preventDefault();
        setEditing(mine.id);
      }
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...e.clipboardData.files];
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  };
  const hasFiles = (e: DragEvent) => [...e.dataTransfer.types].includes("Files");
  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    setDragging(false);
    addFiles([...e.dataTransfer.files]);
  };

  const saveEdit = async (m: Message, value: string) => {
    const content = encodeMentions(value.trim(), members);
    setEditing(undefined);
    input.current?.focus();
    if (!content) return removeMessage(m, true);
    if (content === m.content) return;
    await api.editMessage(m.id, content).catch((err: Error) => window.alert(err.message));
  };
  const removeMessage = async (m: Message, ask = true) => {
    if (ask && !window.confirm("Apagar esta mensagem? Não dá para desfazer.")) return;
    await api.deleteMessage(m.id).catch((err: Error) => window.alert(err.message));
  };
  const mentionsMe = (m: Message) => mentionedIds(m.content).includes(meId);

  if (!channel) return <section className="chat" />;

  const actions = (m: Message) => {
    const mine = m.userId === meId;
    if (!mine && !(canModerate && !dm)) return null;
    return (
      <div className="msg-actions lino" role="toolbar" aria-label="Ações da mensagem">
        {mine && m.content !== "" && (
          <button type="button" title="Editar" aria-label="Editar mensagem" onClick={() => setEditing(m.id)}>
            <Icon name="pencil" size={18} />
          </button>
        )}
        <button type="button" title="Apagar (Shift: sem perguntar)" aria-label="Apagar mensagem" onClick={(e) => void removeMessage(m, !e.shiftKey)}>
          <Icon name="trash" size={18} />
        </button>
      </div>
    );
  };
  const body = (m: Message) =>
    editing === m.id ? (
      <EditBox initial={decodeMentions(m.content, names)} onSave={(v) => void saveEdit(m, v)} onCancel={() => { setEditing(undefined); input.current?.focus(); }} />
    ) : (
      <>
        <MessageText content={m.content} names={names} onProfile={onProfile} edited={m.editedAt} />
        <Attachments items={m.attachments} onOpen={setViewing} onLoad={onMediaLoad} />
      </>
    );

  return (
    <section
      className="chat"
      onDragOver={(e) => { if (hasFiles(e)) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={onDrop}
    >
      <ChannelHeader icon={dm ? "users" : "hash"} name={channel.name}>
        {headerExtra}
        {!dm && canInvite && (
          <IconButton label="Convidar pessoas" onClick={onInvite}>
            <Icon name="user-plus" />
          </IconButton>
        )}
        {!dm && <IconButton label={membersOpen ? "Ocultar lista de membros" : "Mostrar lista de membros"} active={membersOpen} onClick={onToggleMembers}>
          <Icon name="users" />
        </IconButton>}
      </ChannelHeader>

      <div ref={list} className="messages" role="log" aria-label={dm ? `Conversa com ${channel.name}` : `Mensagens em #${channel.name}`} onScroll={onScroll}>
        {hasMore ? (
          <div className="history-loading t-muted" aria-live="polite">Carregando mensagens antigas…</div>
        ) : (
          <div className="channel-welcome">
            <div className="channel-welcome-icon lino lino-lg">
              <Icon name={dm ? "users" : "hash"} size={44} />
            </div>
            <h2 className="t-display">{dm ? channel.name : `Bem-vindo(a) a #${channel.name}!`}</h2>
            <p className="t-muted">{dm ? `Este é o começo da sua conversa com ${channel.name}.` : `Este é o começo do canal #${channel.name}.`}</p>
            <p className="security-note" role="note">
              <Icon name="lock" size={14} /> As mensagens trafegam por uma conexão criptografada (HTTPS). Elas ficam guardadas no servidor do Turtle, que não usa criptografia de ponta a ponta.
            </p>
          </div>
        )}
        {rows.map((r) =>
          r.kind === "day" ? (
            <div key={r.key} className="day-divider" role="separator">
              <span>{r.label}</span>
            </div>
          ) : r.head ? (
            <article key={r.key} className={`msg head${mentionsMe(r.message) ? " mentioned" : ""}${editing === r.message.id ? " editing" : ""}${sheet?.id === r.message.id ? " pressed" : ""}`} {...pressHandlers(r.message)}>
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
                {body(r.message)}
              </div>
              {editing !== r.message.id && !mobile && actions(r.message)}
            </article>
          ) : (
            <article key={r.key} className={`msg${mentionsMe(r.message) ? " mentioned" : ""}${editing === r.message.id ? " editing" : ""}${sheet?.id === r.message.id ? " pressed" : ""}`} {...pressHandlers(r.message)}>
              <time className="msg-gutter" dateTime={r.message.createdAt}>
                {shortTime(r.message.createdAt)}
              </time>
              <div className="msg-body">{body(r.message)}</div>
              {editing !== r.message.id && !mobile && actions(r.message)}
            </article>
          ),
        )}
        <div className="messages-end" />
      </div>

      {away && (
        <button type="button" className="jump-latest lino" onClick={() => { atBottom.current = true; setAway(false); toBottom(); }}>
          Ver mensagens recentes <Icon name="chevron-down" size={16} />
        </button>
      )}
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
          {pending.length > 0 && (
            <ul className="pending-files" aria-label="Arquivos para enviar">
              {pending.map((p) => (
                <li key={p.id} className={`pending-file${p.error ? " failed" : ""}`}>
                  {p.preview ? <img src={p.preview} alt="" /> : <Icon name="file" size={36} />}
                  <span className="pending-name" title={p.file.name}>{p.file.name}</span>
                  <span className="t-muted pending-state">
                    {p.error ? p.error : p.done ? formatSize(p.file.size) : `Enviando ${Math.round(p.progress * 100)}%`}
                  </span>
                  {!p.done && !p.error && <span className="pending-bar" style={{ width: `${Math.round(p.progress * 100)}%` }} />}
                  <button type="button" className="pending-remove" aria-label={`Tirar ${p.file.name}`} title="Tirar" onClick={() => removePending(p.id)}>
                    <Icon name="close" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="composer-row">
            <button type="button" className="composer-attach" title="Enviar arquivo" aria-label="Enviar arquivo" onClick={() => filePicker.current?.click()}>
              <Icon name="paperclip" size={20} />
            </button>
            <input ref={filePicker} type="file" multiple hidden onChange={(e) => { addFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
            <textarea
              ref={input}
              name="text"
              rows={1}
              value={text}
              onChange={(e) => onType(e.target.value, e.target.selectionStart ?? e.target.value.length)}
              onKeyDown={onKey}
              onPaste={onPaste}
              onBlur={() => setQuery(undefined)}
              placeholder={dm ? `Conversar com ${channel.name}` : `Conversar em #${channel.name}`}
              autoComplete="off"
              aria-label={dm ? `Mensagem para ${channel.name}` : `Mensagem para #${channel.name}`}
              maxLength={4000}
            />
            <button type="submit" className="composer-send" title={uploading ? "Esperando os arquivos subirem" : "Enviar"} aria-label="Enviar" disabled={uploading}>
              <Icon name="send" size={20} />
            </button>
          </div>
        </div>
        {fileError && <p className="composer-error" role="alert">{fileError}</p>}
      </form>
      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-card lino">
            <Icon name="paperclip" size={40} />
            <b>Solte para enviar em {dm ? channel.name : `#${channel.name}`}</b>
            <span className="t-muted">Até {MAX_ATTACHMENTS} arquivos de {ATTACHMENT_MAX_BYTES / 1024 / 1024} MB</span>
          </div>
        </div>
      )}
      {viewing && <Lightbox item={viewing} onClose={() => setViewing(undefined)} />}
      {sheet && <MessageSheet
        message={sheet}
        canEdit={sheet.userId === meId && sheet.content !== ""}
        canDelete={sheet.userId === meId || (!!canModerate && !dm)}
        text={decodeMentions(sheet.content, names)}
        onEdit={() => { setEditing(sheet.id); setSheet(undefined); }}
        onDelete={() => { const m = sheet; setSheet(undefined); void removeMessage(m); }}
        onProfile={() => { const id = sheet.userId; setSheet(undefined); onProfile(id); }}
        onClose={() => setSheet(undefined)}
      />}
    </section>
  );
}
