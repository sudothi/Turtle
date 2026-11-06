import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { MENTION_RE, REPLY_PREVIEW_CHARS, dmTitle, mentionedIds, serverEvent, shownName, type ServerEvent, type Channel, type ChannelKind, type Dm, type Friend, type Member, type Message, type Server, type Unread, type User, type UserStatus, type VoiceState } from "@turtle/protocol";
import { Avatar, Button, Icon, IconButton } from "@turtle/ui";
import { api, fileUrl, getToken } from "../api";
import { loadSoundPrefs, playSound, setSoundOutput } from "../sounds";
import { desktop, loadShortcuts } from "../desktop";
import { appFocused, askNotificationsOnFirstClick, showNotification } from "../notify";
import { PresenceContext } from "../presence";
import { MobileBack, trackVisualViewport, useMobile } from "../mobile";
import { VoiceClient } from "../voice/client";
import { ServerRail } from "../components/ServerRail";
import { ChannelSidebar } from "../components/ChannelSidebar";
import { UserPanel } from "../components/UserPanel";
import { ChatView, type Outgoing } from "../components/ChatView";
import { CallView } from "../components/CallView";
import { ShareModal } from "../components/ShareModal";
import { ScreenPicker } from "../components/ScreenPicker";
import { SettingsModal, type SettingsTab } from "../components/SettingsModal";
import { DmGroupPanel, DmProfilePanel, ProfileModal, ProfilePopout, type ProfileHandlers } from "../components/UserProfile";
import { AddToGroupModal, FriendsPanel, HomeSidebar, NewGroupModal } from "../components/Home";
import { MemberList } from "../components/MemberList";
import { CreateChannelModal, EditChannelModal, InviteModal } from "../components/modals";
import { CreateServerModal, JoinServerModal, ServerSettingsModal } from "../components/ServerModals";

const MEMBERS_KEY = "turtle.membersOpen";
/** Página do histórico (o servidor manda até 50 por vez). */
/** Evento de envio de uma mensagem da fila. */
const sendEvent = (o: Outgoing) => ({
  t: "send", channelId: o.channelId, content: o.content, attachments: o.attachments, nonce: o.nonce, ...(o.replyTo ? { replyTo: o.replyTo } : {}),
});
const PAGE = 50;
const DM_PANEL_KEY = "turtle.dmPanel";
const SERVER_KEY = "turtle.server";
const remembered = () => {
  try {
    return localStorage.getItem(SERVER_KEY) ?? undefined;
  } catch {
    return undefined;
  }
};

/** Tela principal: servidores | canais | chat ou chamada | membros. */
export function Workspace({ user: initialUser, onLogout }: { user: User; onLogout: () => void }) {
  const [user, setUser] = useState(initialUser);
  const [servers, setServers] = useState<Server[]>([]);
  const [serversLoaded, setServersLoaded] = useState(false);
  const [serverId, setServerId] = useState<string | undefined>(remembered);
  const [channels, setChannels] = useState<Channel[]>([]);
  /** Todos os canais já vistos (de qualquer servidor), para nomear a chamada em andamento. */
  const [known, setKnown] = useState<Record<string, Channel>>({});
  const [members, setMembers] = useState<Member[]>([]);
  const [current, setCurrent] = useState<string>();
  const [view, setView] = useState<"text" | "voice">("text");
  const [voiceView, setVoiceView] = useState<string>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [online, setOnline] = useState<string[]>([]);
  const [busy, setBusy] = useState<string[]>([]);
  /** Ainda há mensagens mais antigas no canal aberto. */
  const [hasMore, setHasMore] = useState(false);
  /** Mensagens enviadas ainda sem confirmação do servidor (ou que falharam). */
  const [outbox, setOutbox] = useState<Outgoing[]>([]);
  const outboxRef = useRef(outbox);
  outboxRef.current = outbox;
  const reconnectNow = useRef<() => void>(() => {});
  const [editingChannel, setEditingChannel] = useState<Channel>();
  const [voiceStates, setVoiceStates] = useState<VoiceState[]>([]);
  const [settings, setSettings] = useState<SettingsTab | null>(null);
  /** Mini perfil aberto e onde foi o clique (para abrir ao lado). */
  const [popout, setPopout] = useState<{ id: string; anchor?: DOMRect }>();
  const [fullProfile, setFullProfile] = useState<string>();
  const [dmPanel, setDmPanel] = useState(() => {
    try {
      return localStorage.getItem(DM_PANEL_KEY) !== "0";
    } catch {
      return true;
    }
  });
  /** Muda a cada ação de amizade/bloqueio: o painel da DM recarrega. */
  const [profileVersion, setProfileVersion] = useState(0);
  // Último elemento clicado: o mini perfil abre colado nele, como no Discord.
  const lastPress = useRef<{ rect: DOMRect; at: number }>(undefined);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.("button, [role=button], a");
      if (el) lastPress.current = { rect: el.getBoundingClientRect(), at: Date.now() };
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, []);
  const setViewProfile = useCallback((id: string | undefined) => {
    if (!id) return setPopout(undefined);
    const recent = lastPress.current && Date.now() - lastPress.current.at < 1000 ? lastPress.current.rect : undefined;
    const focused = document.activeElement && document.activeElement !== document.body ? document.activeElement.getBoundingClientRect() : undefined;
    setPopout({ id, anchor: recent ?? focused });
  }, []);
  const [sharing, setSharing] = useState(false);
  const [creating, setCreating] = useState<ChannelKind>();
  const [inviting, setInviting] = useState(false);
  const [creatingServer, setCreatingServer] = useState(false);
  const [joining, setJoining] = useState(false);
  const [serverSettings, setServerSettings] = useState(false);
  // Início: mensagens diretas e amigos.
  const [home, setHome] = useState(false);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [dms, setDms] = useState<Dm[]>([]);
  const [dmId, setDmId] = useState<string>();
  const [dmCall, setDmCall] = useState(false);
  const [newGroup, setNewGroup] = useState(false);
  const [addToGroup, setAddToGroup] = useState(false);
  /** Não lidas por canal (de servidor ou conversa direta); vem do servidor e sobrevive ao recarregar. */
  const [unread, setUnread] = useState<Record<string, Unread>>({});
  const [membersOpen, setMembersOpen] = useState(() => {
    try {
      return localStorage.getItem(MEMBERS_KEY) !== "0";
    } catch {
      return true;
    }
  });
  // ---- Celular: uma tela por vez (lista de canais ou conteúdo) e membros/perfil numa gaveta ----
  const mobile = useMobile();
  const [pane, setPane] = useState<"nav" | "content">("nav");
  const [drawer, setDrawer] = useState(false);
  useEffect(() => (mobile ? trackVisualViewport() : undefined), [mobile]);
  /** Abre a conversa/chamada escolhida em tela cheia (no celular). */
  const showContent = useCallback(() => {
    setDrawer(false);
    setPane("content");
  }, []);
  // O voltar do Android/navegador volta para a lista em vez de sair do app.
  useEffect(() => {
    if (!mobile || pane !== "content") return;
    if (history.state?.turtlePane !== "content") history.pushState({ turtlePane: "content" }, "");
    const onPop = () => { setDrawer(false); setPane("nav"); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [mobile, pane]);
  const back = useCallback(() => {
    if (history.state?.turtlePane === "content") history.back();
    else { setDrawer(false); setPane("nav"); }
  }, []);
  // Deslizar da borda esquerda para a direita também volta.
  const swipe = useRef<{ x: number; y: number } | undefined>(undefined);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    swipe.current = mobile && pane === "content" && t && t.clientX < 32 ? { x: t.clientX, y: t.clientY } : undefined;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = swipe.current;
    const t = e.changedTouches[0];
    swipe.current = undefined;
    if (start && t && t.clientX - start.x > 70 && Math.abs(t.clientY - start.y) < 60) back();
  };

  const ws = useRef<WebSocket | undefined>(undefined);
  const currentRef = useRef<string | undefined>(undefined);
  /** Canal aberto agora: a conversa direta no Início, senão o canal do servidor. */
  const activeId = home ? dmId : current;
  currentRef.current = activeId;
  const serverRef = useRef<string | undefined>(undefined);
  serverRef.current = serverId;
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;
  /** Conversa que está na tela agora (não conta o canal de texto escondido atrás de uma chamada). */
  const readingRef = useRef<string | undefined>(undefined);
  readingRef.current = home ? (dmCall ? undefined : dmId) : view === "text" ? current : undefined;
  const unreadRef = useRef(unread);
  unreadRef.current = unread;
  /** Canal a abrir quando os canais do servidor chegarem (clique numa notificação). */
  const pendingChannel = useRef<string | undefined>(undefined);

  const [voice] = useState(
    () =>
      new VoiceClient((state) => {
        if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify({ t: "voice", ...state }));
      }),
  );
  const snap = useSyncExternalStore(voice.subscribe, voice.getSnapshot);
  useEffect(() => () => void voice.leave(), [voice]);
  const chooseServer = useCallback((id: string | undefined) => {
    setHome(false);
    setServerId(id);
    setView("text");
    try {
      if (id) localStorage.setItem(SERVER_KEY, id);
    } catch {
      // sem storage: só não lembra
    }
  }, []);

  /** Busca os servidores; se o atual sumiu (apagado, expulso), vai para o primeiro que sobrou. */
  const loadServers = useCallback(async () => {
    const list = await api.servers();
    setServers(list);
    setServersLoaded(true);
    if (!list.some((s) => s.id === serverRef.current)) chooseServer(list[0]?.id);
    // Canais de todos os servidores: para saber de onde vem cada mensagem (não lidas e notificações).
    const all = await Promise.all(list.map((s) => api.channels(s.id).catch(() => [] as Channel[])));
    setKnown((k) => ({ ...k, ...Object.fromEntries(all.flat().map((c) => [c.id, c])) }));
  }, [chooseServer]);

  /** Busca canais e membros do servidor atual. `pick` escolhe um canal de texto se ainda não há um. */
  const loadServer = useCallback(async (id: string, pick: boolean) => {
    const [ch, mem] = await Promise.all([api.channels(id), api.members(id)]);
    if (serverRef.current !== id) return;
    setChannels(ch);
    setMembers(mem);
    setKnown((k) => ({ ...k, ...Object.fromEntries(ch.map((c) => [c.id, c])) }));
    const wanted = pendingChannel.current && ch.some((c) => c.id === pendingChannel.current) ? pendingChannel.current : undefined;
    pendingChannel.current = undefined;
    if (wanted) setCurrent(wanted);
    else if (pick || !ch.some((c) => c.id === currentRef.current)) setCurrent(ch.find((x) => x.kind === "text")?.id);
  }, []);

  useEffect(() => {
    void loadServers();
  }, [loadServers]);

  useEffect(() => {
    setChannels([]);
    setMembers([]);
    setMessages([]);
    setCurrent(undefined);
    if (serverId) void loadServer(serverId, true);
  }, [serverId, loadServer]);

  useEffect(() => {
    setMessages([]);
    setHasMore(false);
    if (!activeId) return;
    let stale = false;
    api.messages(activeId).then((m) => {
      if (stale) return;
      setMessages(m);
      setHasMore(m.length >= PAGE);
    }).catch(() => {});
    return () => { stale = true; };
  }, [activeId]);

  /** Página anterior do histórico (rolou até o topo). */
  const loadOlder = useCallback(async () => {
    const id = currentRef.current;
    const first = messagesRef.current[0];
    if (!id || !first) return;
    const older = await api.messages(id, first.createdAt).catch(() => null);
    if (!older || currentRef.current !== id) return;
    setHasMore(older.length >= PAGE);
    setMessages((m) => {
      const seen = new Set(m.map((x) => x.id));
      return [...older.filter((x) => !seen.has(x.id)), ...m];
    });
  }, []);

  // ---- Não lidas ----
  const readTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  /** Tira a marca na hora e avisa o servidor logo depois (várias mensagens seguidas viram um aviso só). */
  const markRead = useCallback((id: string) => {
    setUnread((u) => {
      if (!u[id]) return u;
      const n = { ...u };
      delete n[id];
      return n;
    });
    clearTimeout(readTimers.current.get(id));
    readTimers.current.set(id, setTimeout(() => {
      readTimers.current.delete(id);
      void api.markRead(id).catch(() => {});
    }, 700));
  }, []);
  const loadUnread = useCallback(async () => {
    const list = await api.unread();
    const open = readingRef.current;
    setUnread(Object.fromEntries(list.filter((u) => !(u.channelId === open && appFocused())).map((u) => [u.channelId, u])));
  }, []);
  const readingId = home ? (dmCall ? undefined : dmId) : view === "text" ? current : undefined;
  useEffect(() => {
    if (readingId && appFocused()) markRead(readingId);
  }, [readingId, markRead]);
  useEffect(() => {
    const back = () => {
      const id = readingRef.current;
      if (id && appFocused() && unreadRef.current[id]) markRead(id);
    };
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", back);
    return () => {
      window.removeEventListener("focus", back);
      document.removeEventListener("visibilitychange", back);
    };
  }, [markRead]);
  useEffect(() => askNotificationsOnFirstClick(), []);
  // Atalhos globais do app desktop: registra os guardados e reage ao aperto (o som sai do efeito de mudo/ensurdecer).
  useEffect(() => {
    const d = desktop();
    if (!d?.setShortcuts || !d.onShortcut) return;
    d.setShortcuts(loadShortcuts());
    return d.onShortcut((which) => void (which === "mute" ? voice.toggleMute() : voice.toggleDeafen()));
  }, [voice]);

  // ---- Sons de mutar, ensurdecer e transmitir (de qualquer botão: barra, chamada ou atalho) ----
  const lastSnap = useRef({ muted: snap.muted, deafened: snap.deafened, screen: snap.screen });
  useEffect(() => {
    const prev = lastSnap.current;
    if (snap.deafened !== prev.deafened) playSound(snap.deafened ? "deafen" : "undeafen");
    else if (snap.muted !== prev.muted) playSound(snap.muted ? "mute" : "unmute");
    if (snap.screen !== prev.screen) playSound(snap.screen ? "screenOn" : "screenOff");
    lastSnap.current = { muted: snap.muted, deafened: snap.deafened, screen: snap.screen };
  }, [snap.muted, snap.deafened, snap.screen]);
  useEffect(() => setSoundOutput(snap.prefs.outputId), [snap.prefs.outputId]);

  // ---- Aviso falado (leitor de tela) de quem entra/sai da chamada e de mudo/ensurdecido ----
  const [liveNote, setLiveNote] = useState("");
  const lastCall = useRef<{ ids: Map<string, string>; muted: boolean; deafened: boolean; channelId: string | undefined }>({ ids: new Map(), muted: snap.muted, deafened: snap.deafened, channelId: snap.channelId });
  useEffect(() => {
    const prev = lastCall.current;
    const ids = new Map(snap.participants.map((p) => [p.id, p.name] as const));
    const notes: string[] = [];
    if (snap.channelId && snap.channelId === prev.channelId) {
      for (const [id, name] of ids) if (!prev.ids.has(id) && !snap.participants.find((p) => p.id === id)?.isLocal) notes.push(`${name} entrou na chamada`);
      for (const [id, name] of prev.ids) if (!ids.has(id)) notes.push(`${name} saiu da chamada`);
    }
    if (snap.channelId) {
      if (snap.deafened !== prev.deafened) notes.push(snap.deafened ? "Você ensurdeceu" : "Você voltou a ouvir");
      else if (snap.muted !== prev.muted) notes.push(snap.muted ? "Você está mudo" : "Você está com o microfone ligado");
    }
    lastCall.current = { ids, muted: snap.muted, deafened: snap.deafened, channelId: snap.channelId };
    if (notes.length) setLiveNote(notes.join(". "));
  }, [snap.participants, snap.muted, snap.deafened, snap.channelId]);

  // Título da janela com o que está esperando você (aparece na barra de tarefas).
  const waiting = Object.values(unread).reduce((n, u) => n + (u.serverId === null ? 1 : u.mentions), 0);
  useEffect(() => {
    document.title = waiting ? `(${waiting}) Turtle` : Object.keys(unread).length ? "• Turtle" : "Turtle";
  }, [waiting, unread]);

  const loadHome = useCallback(async () => {
    const [f, d] = await Promise.all([api.friends(), api.dms()]);
    setFriends(f);
    setDms(d);
  }, []);
  useEffect(() => {
    void loadHome().catch(() => {});
  }, [loadHome]);

  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout>;
    let attempts = 0;
    let opened = false;
    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      // O token vai na primeira mensagem, não na URL (assim não aparece em log de proxy nem de servidor).
      const s = new WebSocket(`${proto}://${location.host}/ws`);
      ws.current = s;
      s.onopen = () => {
        s.send(JSON.stringify({ t: "auth", token: getToken() ?? "" }));
        attempts = 0;
        voice.resendState();
        void loadUnread().catch(() => {});
        // Reenvia o que ficou sem confirmação (o servidor ignora o que já tinha entrado, pelo nonce).
        for (const o of outboxRef.current) if (o.status === "sending") s.send(JSON.stringify(sendEvent(o)));
        // Reconectou: busca a última página da conversa aberta (chegou mensagem durante a queda).
        if (opened && currentRef.current) {
          const id = currentRef.current;
          api.messages(id).then((fresh) => {
            if (currentRef.current !== id) return;
            setMessages((old) => {
              const byId = new Map(fresh.map((m) => [m.id, m]));
              const cut = fresh[0]?.createdAt ?? "";
              return [...old.filter((m) => m.createdAt < cut && !byId.has(m.id)), ...fresh];
            });
          }).catch(() => {});
        }
        opened = true;
      };
      s.onmessage = (ev) => {
        const parsed = serverEvent.safeParse(JSON.parse(ev.data));
        if (!parsed.success) return;
        const evt = parsed.data;
        if (evt.t === "message") {
          if (evt.nonce) setOutbox((l) => (l.some((o) => o.nonce === evt.nonce) ? l.filter((o) => o.nonce !== evt.nonce) : l));
          onMessage.current(evt.message);
        }
        if (evt.t === "error" && evt.nonce) {
          const nonce = evt.nonce;
          setOutbox((l) => l.map((o) => (o.nonce === nonce ? { ...o, status: "failed", error: evt.error } : o)));
        }
        if (evt.t === "messageUpdate" && evt.message.channelId === currentRef.current) {
          const m = evt.message;
          // Atualiza a mensagem e a prévia dela nas respostas.
          setMessages((l) => l.map((x) => (x.id === m.id ? m : x.replyTo?.id === m.id ? { ...x, replyTo: { ...x.replyTo, content: m.content.slice(0, REPLY_PREVIEW_CHARS) } } : x)));
        }
        if (evt.t === "messageDelete" && evt.channelId === currentRef.current)
          setMessages((l) => l.filter((x) => x.id !== evt.id).map((x) => (x.replyTo?.id === evt.id ? { ...x, replyTo: null } : x)));
        if (evt.t === "read") setUnread((u) => {
          if (!u[evt.channelId]) return u;
          const n = { ...u };
          delete n[evt.channelId];
          return n;
        });
        if (evt.t === "friends") void loadHome().catch(() => {});
        if (evt.t === "channel") {
          setKnown((k) => ({ ...k, [evt.channel.id]: evt.channel }));
          if (evt.channel.serverId === serverRef.current) setChannels((c) => (c.some((x) => x.id === evt.channel.id) ? c : [...c, evt.channel]));
        }
        if (evt.t === "userUpdate") {
          // Perfil de alguém (ou o meu) mudou: aplica o perfil novo no que já está na tela, sem rebuscar nada.
          const u = evt.user;
          const same = { displayName: u.displayName, avatar: u.avatar };
          setUser((me) => (me.id === u.id ? { ...me, ...same, bio: u.bio, banner: u.banner } : me));
          setMembers((l) => l.map((m) => (m.userId === u.id ? { ...m, ...same, staff: u.staff } : m)));
          setFriends((l) => l.map((f) => (f.user.id === u.id ? { ...f, user: { ...f.user, ...same } } : f)));
          setDms((l) => l.map((d) => (d.users.some((p) => p.id === u.id) ? { ...d, users: d.users.map((p) => (p.id === u.id ? { ...p, ...same } : p)) } : d)));
          setMessages((l) => l.map((m) => {
            const mine = m.userId === u.id ? { ...m, ...same, staff: u.staff } : m;
            return mine.replyTo?.userId === u.id ? { ...mine, replyTo: { ...mine.replyTo, ...same } } : mine;
          }));
          setProfileVersion((n) => n + 1);
        }
        if (evt.t === "sync") {
          void loadServers().then(() => (serverRef.current ? loadServer(serverRef.current, false) : undefined)).catch(() => {});
          // Perfil de alguém mudou: atualiza o meu e as fotos/nomes nas mensagens.
          api.me().then(setUser).catch(() => {});
          void loadHome().catch(() => {});
          void loadUnread().catch(() => {});
          // Atualiza fotos/nomes só na última página (sem perder o que já foi carregado de mais antigo).
          if (currentRef.current) api.messages(currentRef.current).then((fresh) => setMessages((old) => {
            const byId = new Map(fresh.map((m) => [m.id, m]));
            const cut = fresh[0]?.createdAt ?? "";
            return [...old.filter((m) => m.createdAt < cut).map((m) => byId.get(m.id) ?? m), ...fresh];
          })).catch(() => {});
        }
        if (evt.t === "presence") {
          setOnline(evt.online);
          setBusy(evt.busy);
        }
        if (evt.t === "voiceStates") setVoiceStates(evt.states);
        if (evt.t === "typing") setTypingBy((all) => ({ ...all, [evt.channelId]: { ...all[evt.channelId], [evt.userId]: Date.now() } }));
        if (evt.t === "message") setTypingBy((all) => {
          const who = all[evt.message.channelId];
          if (!who?.[evt.message.userId]) return all;
          const { [evt.message.userId]: _gone, ...rest } = who;
          return { ...all, [evt.message.channelId]: rest };
        });
        if (evt.t === "ring") onRing.current(evt);
        if (evt.t === "ringEnd") setRings((l) => l.filter((x) => x.channelId !== evt.channelId));
        if (evt.t === "ringDeclined") setLiveNote("Chamada recusada");
      };
      s.onclose = (ev) => {
        if (ev.code === 4401) {
          closed = true;
          clearTimeout(retry);
          return onLogout();
        }
        // Espera crescente (1, 2, 4… até 10 s) com um pouco de sorteio, para todos não voltarem juntos.
        const wait = Math.min(10_000, 1000 * 2 ** attempts++) * (0.75 + Math.random() * 0.5);
        if (!closed) retry = setTimeout(connect, wait);
      };
    };
    connect();
    // Rede voltou, app voltou para a frente ou a pessoa pediu para reenviar: tenta na hora, sem esperar a vez.
    reconnectNow.current = () => {
      const st = ws.current?.readyState;
      if (closed || st === WebSocket.OPEN || st === WebSocket.CONNECTING) return;
      clearTimeout(retry);
      attempts = 0;
      connect();
    };
    const wake = () => { if (document.visibilityState === "visible") reconnectNow.current(); };
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      closed = true;
      clearTimeout(retry);
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
      ws.current?.close();
    };
  }, [onLogout, voice, loadServers, loadServer, loadHome, loadUnread]);

  /** Envia pelo WebSocket se estiver aberto; senão fica na fila e vai quando reconectar. */
  const transmit = useCallback((o: Outgoing) => {
    const s = ws.current;
    if (s?.readyState === WebSocket.OPEN) s.send(JSON.stringify(sendEvent(o)));
    else reconnectNow.current();
  }, []);
  // Sem confirmação em 15 s: marca como não enviada (a pessoa escolhe reenviar ou descartar).
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      if (outboxRef.current.some((o) => o.status === "sending" && now - o.at > 15_000))
        setOutbox((l) => l.map((o) => (o.status === "sending" && now - o.at > 15_000 ? { ...o, status: "failed", error: "sem conexão com o servidor" } : o)));
    }, 2000);
    return () => clearInterval(t);
  }, []);
  const send = useCallback((content: string, attachments: string[] = [], replyTo?: string) => {
    if (!activeId) return;
    const o: Outgoing = { nonce: crypto.randomUUID(), channelId: activeId, content, attachments, replyTo, status: "sending", at: Date.now() };
    setOutbox((l) => [...l, o]);
    transmit(o);
  }, [activeId, transmit]);
  const retrySend = useCallback((nonce: string) => {
    const o = outboxRef.current.find((x) => x.nonce === nonce);
    if (!o) return;
    const again = { ...o, status: "sending" as const, error: undefined, at: Date.now() };
    setOutbox((l) => l.map((x) => (x.nonce === nonce ? again : x)));
    transmit(again);
  }, [transmit]);
  const discardSend = useCallback((nonce: string) => setOutbox((l) => l.filter((x) => x.nonce !== nonce)), []);
  const pendingHere = outbox.filter((o) => o.channelId === activeId);

  const openDm = useCallback((dm: Dm) => {
    setHome(true);
    setDmCall(false);
    setDmId(dm.channelId);
    showContent();
  }, [showContent]);
  /** Abre um canal de servidor (vindo de uma notificação). */
  const goToChannel = useCallback((sid: string, channelId: string) => {
    setHome(false);
    setView("text");
    showContent();
    if (sid === serverRef.current) return setCurrent(channelId);
    pendingChannel.current = channelId;
    chooseServer(sid);
  }, [chooseServer, showContent]);

  // Mensagem nova chegando: lista, não lidas, som e notificação. Fica num ref para ver o estado atual sem reconectar.
  // ---- Chamadas tocando (DM e grupo) ----
  const [rings, setRings] = useState<Extract<ServerEvent, { t: "ring" }>[]>([]);
  // "Digitando…": quem avisou nos últimos 6 s, por canal.
  const [typingBy, setTypingBy] = useState<Record<string, Record<string, number>>>({});
  const typingIds = (channelId?: string) => (channelId ? Object.keys(typingBy[channelId] ?? {}) : []);
  useEffect(() => {
    if (!Object.keys(typingBy).length) return;
    const t = setInterval(() => setTypingBy((all) => {
      const now = Date.now();
      const next: typeof all = {};
      for (const [c, who] of Object.entries(all)) {
        const alive = Object.fromEntries(Object.entries(who).filter(([, at]) => now - at < 6000));
        if (Object.keys(alive).length) next[c] = alive;
      }
      return Object.keys(next).length === Object.keys(all).length && Object.entries(next).every(([c, w]) => Object.keys(w).length === Object.keys(all[c]!).length) ? all : next;
    }), 1000);
    return () => clearInterval(t);
  }, [typingBy]);
  const sendTyping = useCallback((channelId: string) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify({ t: "typing", channelId }));
  }, []);
  const onRing = useRef<(r: Extract<ServerEvent, { t: "ring" }>) => void>(() => {});
  onRing.current = (r) => {
    setRings((l) => [...l.filter((x) => x.channelId !== r.channelId), r]);
    if (r.silent && appFocused()) return;
    const dm = dms.find((d) => d.channelId === r.channelId);
    if (!appFocused() || r.silent)
      showNotification(`${shownName(r.from)} está te ligando`, dm?.group ? dmTitle(dm) : "Chamada de voz", fileUrl(r.from.avatar), () => {
        if (dm) openDm(dm);
      });
  };
  useEffect(() => {
    if (!rings.some((r) => !r.silent)) return;
    playSound("ring");
    const t = setInterval(() => playSound("ring"), 2500);
    return () => clearInterval(t);
  }, [rings]);
  const answerRing = (r: Extract<ServerEvent, { t: "ring" }>) => {
    setRings((l) => l.filter((x) => x.channelId !== r.channelId));
    const dm = dms.find((d) => d.channelId === r.channelId);
    if (dm) openDm(dm);
    setDmCall(true);
    void voice.join(r.channelId);
  };
  const declineRing = (r: Extract<ServerEvent, { t: "ring" }>) => {
    setRings((l) => l.filter((x) => x.channelId !== r.channelId));
    ws.current?.send(JSON.stringify({ t: "ringDecline", channelId: r.channelId }));
  };
  const onMessage = useRef<(m: Message) => void>(() => {});
  onMessage.current = (m: Message) => {
    if (m.channelId === currentRef.current) setMessages((l) => (l.some((x) => x.id === m.id) ? l : [...l, m]));
    const dm = dms.find((d) => d.channelId === m.channelId);
    const ch = known[m.channelId];
    if (dm) {
      setDms((l) => l.map((d) => (d.channelId === m.channelId ? { ...d, lastMessageAt: m.createdAt } : d)).sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? "")));
    } else if (!ch) {
      // Conversa que ainda não conheço (primeira DM de alguém): busca a lista.
      void loadHome().catch(() => {});
    }
    if (m.userId === user.id) return;
    if (m.channelId === readingRef.current && appFocused()) return markRead(m.channelId);
    // Responder a uma mensagem minha conta como menção (como no Discord).
    const mention = mentionedIds(m.content).includes(user.id) || m.replyTo?.userId === user.id;
    setUnread((u) => {
      const prev = u[m.channelId];
      return { ...u, [m.channelId]: { channelId: m.channelId, serverId: ch?.serverId ?? null, count: (prev?.count ?? 0) + 1, mentions: (prev?.mentions ?? 0) + (mention ? 1 : 0) } };
    });
    if (user.status === "busy") return;
    const direct = !ch;
    if (!(direct || mention || loadSoundPrefs().allServerMessages)) return;
    playSound("message");
    if (appFocused()) return;
    const names = new Map<string, string>([[user.id, shownName(user)], ...members.map((x) => [x.userId, shownName(x)] as [string, string]), ...dms.flatMap((d) => d.users.map((p) => [p.id, shownName(p)] as [string, string]))]);
    const text = m.content.replace(MENTION_RE, (_, id: string) => `@${names.get(id) ?? "alguém"}`);
    const files = m.attachments.length;
    const body = text || (files === 1 ? (m.attachments[0]!.mime.startsWith("image/") ? "Enviou uma imagem" : `Enviou ${m.attachments[0]!.name}`) : `Enviou ${files} arquivos`);
    const serverName = ch ? servers.find((s) => s.id === ch.serverId)?.name : undefined;
    const title = dm?.group ? `${shownName(m)} · ${dmTitle(dm)}` : ch ? `${shownName(m)} · #${ch.name}${serverName ? ` (${serverName})` : ""}` : shownName(m);
    showNotification(title, body, fileUrl(m.avatar), () => {
      if (dm) openDm(dm);
      else if (ch) goToChannel(ch.serverId, ch.id);
      else setHome(true);
    });
  };
  const changeStatus = useCallback((status: UserStatus) => {
    setUser((u) => ({ ...u, status }));
    api.setStatus(status).then(setUser).catch(() => {});
  }, []);
  const closePopout = useCallback(() => setPopout(undefined), []);
  const closeFull = useCallback(() => setFullProfile(undefined), []);
  const messageUser = useCallback(async (userId: string, text?: string) => {
    try {
      const dm = await api.openDm(userId);
      setDms((l) => (l.some((d) => d.channelId === dm.channelId) ? l : [dm, ...l]));
      openDm(dm);
      if (text) ws.current?.send(JSON.stringify({ t: "send", channelId: dm.channelId, content: text }));
    } catch {
      // sem permissão (nem amigos nem servidor em comum): o botão do perfil já avisa só pelo erro do servidor
    }
  }, [openDm]);

  const toggleMembers = () => {
    if (mobile) return setDrawer((o) => !o);
    setMembersOpen((o) => {
      try {
        localStorage.setItem(MEMBERS_KEY, o ? "0" : "1");
      } catch {
        // sem storage: só não lembra
      }
      return !o;
    });
  };

  const toggleDmPanel = () => {
    if (mobile) return setDrawer((o) => !o);
    setDmPanel((o) => {
      try {
        localStorage.setItem(DM_PANEL_KEY, o ? "0" : "1");
      } catch {
        // sem storage: só não lembra
      }
      return !o;
    });
  };

  const leaveServer = (s: Server) => {
    if (!window.confirm(`Sair de ${s.name}?`)) return;
    if (snap.channelId && allKnown.find((c) => c.id === snap.channelId)?.serverId === s.id) void voice.leave();
    api.removeMember(s.id, user.id).then(() => loadServers(), (e: Error) => window.alert(e.message));
  };
  const speaking = new Set(snap.channelId ? snap.participants.filter((p) => p.speaking && !p.muted).map((p) => p.id) : []);
  const textChannel = channels.find((c) => c.id === current);
  const showMembers = !home && (mobile ? drawer && pane === "content" : membersOpen) && view === "text" && !!serverId;
  const dm = dms.find((d) => d.channelId === dmId);
  const showDmPanel = home && !!dm && !dmCall && (mobile ? drawer && pane === "content" : dmPanel);
  const asChannel = (d: Dm): Channel => ({ id: d.channelId, serverId: "", name: dmTitle(d), kind: "text" });
  const dmChannel: Channel | undefined = dm && asChannel(dm);
  const dmMembers: Member[] = dm
    ? [...dm.users, { id: user.id, username: user.username, displayName: user.displayName, avatar: user.avatar }].map((p) => ({ userId: p.id, username: p.username, displayName: p.displayName, avatar: p.avatar, role: "member" as const, staff: false }))
    : [];
  const pendingIn = friends.filter((f) => f.status === "incoming").length;
  const server = servers.find((s) => s.id === serverId);
  const ownedCount = servers.filter((s) => s.ownerId === user.id).length;
  const callServer = servers.find((s) => s.id === known[snap.channelId ?? ""]?.serverId);
  const allKnown = [...Object.values(known), ...dms.map(asChannel)];
  const dmUnread = new Set(Object.values(unread).filter((u) => u.serverId === null).map((u) => u.channelId));
  const serverUnread: Record<string, { mentions: number }> = {};
  for (const u of Object.values(unread)) {
    if (!u.serverId) continue;
    serverUnread[u.serverId] = { mentions: (serverUnread[u.serverId]?.mentions ?? 0) + u.mentions };
  }
  const presence = { online: new Set(online), busy: new Set(busy) };
  const profileHandlers: ProfileHandlers = {
    meId: user.id,
    online,
    onMessage: (id, text) => void messageUser(id, text),
    onChanged: () => { setProfileVersion((n) => n + 1); void loadHome().catch(() => {}); },
    onEditProfile: () => setSettings("profile"),
    onOpenServer: (id) => chooseServer(id),
  };
  const footer = <UserPanel user={user} snap={snap} voice={voice} channels={allKnown} serverName={callServer?.name} onSettings={() => setSettings("voice")} onProfile={() => setSettings("profile")} onShare={() => setSharing(true)} onDownload={() => setSettings("desktop")} onLogout={onLogout} onStatus={changeStatus} />;

  // Celular: barra da chamada ativa quando se está em outra tela (chat, outro servidor, Amigos).
  const callChannel = snap.channelId ? known[snap.channelId] ?? (dms.find((d) => d.channelId === snap.channelId) && asChannel(dms.find((d) => d.channelId === snap.channelId)!)) : undefined;
  const callDm = dms.find((d) => d.channelId === snap.channelId);
  const watchingCall = home ? dmCall && dmId === snap.channelId : view === "voice" && voiceView === snap.channelId;
  const openCall = () => {
    if (!snap.channelId) return;
    if (callDm) { openDm(callDm); setDmCall(true); return; }
    const sid = known[snap.channelId]?.serverId;
    setHome(false);
    if (sid && sid !== serverId) chooseServer(sid);
    setVoiceView(snap.channelId);
    setView("voice");
    showContent();
  };
  const callBar = mobile && snap.status !== "idle" && snap.channelId && !(pane === "content" && watchingCall) ? (
    <div className={`m-callbar ${snap.status !== "connected" ? "connecting" : ""}`}>
      <button className="m-callbar-open" onClick={openCall}>
        <Icon name="speaker" size={18} />
        <span className="m-callbar-text">
          <b>{snap.status === "connected" ? "Na chamada" : "Conectando…"}</b>
          <span>{callChannel?.name ?? "chamada"}{snap.videos.some((v) => v.source === "screen" && !v.isLocal) ? " · tem tela ao vivo" : ""}</span>
        </span>
      </button>
      <IconButton label="Mudo" aria-pressed={snap.muted} className={snap.muted ? "is-off" : ""} onClick={() => void voice.toggleMute()}>
        <Icon name={snap.muted ? "mic-off" : "mic"} />
      </IconButton>
      <IconButton label="Sair da chamada" onClick={() => void voice.leave()}>
        <Icon name="phone-off" />
      </IconButton>
    </div>
  ) : null;

  const noServer = (
    <div className="no-server">
      <h2 className="t-display">Você ainda não está em nenhum servidor</h2>
      <p className="t-muted">Crie o seu ou entre em um com um convite de um amigo.</p>
      <div className="no-server-actions">
        <Button onClick={() => setCreatingServer(true)}>Criar servidor</Button>
        <Button variant="ghost" onClick={() => setJoining(true)}>Entrar com convite</Button>
      </div>
    </div>
  );

  return (
    <PresenceContext.Provider value={presence}>
    <MobileBack.Provider value={mobile ? back : undefined}>
    <div
      className={mobile ? `app m m-${pane}` : `app ${showMembers ? "with-members" : ""} ${showDmPanel ? (dm?.group ? "with-members" : "with-profile") : ""}`}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {rings.length > 0 && (
        <div className="ring-stack" role="alertdialog" aria-label="Chamada recebida">
          {rings.map((r) => (
            <div key={r.channelId} className="ring-card lino">
              <Avatar name={shownName(r.from)} src={fileUrl(r.from.avatar)} size={40} />
              <span><b>{shownName(r.from)}</b> está te ligando{r.silent ? " (Não perturbe)" : ""}</span>
              <Button size="sm" onClick={() => answerRing(r)}>Atender</Button>
              <Button size="sm" variant="ghost" onClick={() => declineRing(r)}>Recusar</Button>
            </div>
          ))}
        </div>
      )}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{liveNote}</div>
      <ServerRail
        servers={servers}
        activeId={serverId}
        onSelect={chooseServer}
        onCreate={() => setCreatingServer(true)}
        onJoin={() => setJoining(true)}
        homeActive={home}
        unread={dmUnread.size}
        serverUnread={serverUnread}
        onHome={() => setHome(true)}
      />
      {home ? (
        <HomeSidebar
          dms={dms}
          current={dmId}
          unread={dmUnread}
          online={online}
          friendsOpen={!dmId}
          pending={pendingIn}
          onFriends={() => { setDmId(undefined); showContent(); }}
          onDm={openDm}
          onNewGroup={() => setNewGroup(true)}
          calls={voiceStates}
          footer={footer}
        />
      ) : server ? (
        <ChannelSidebar
          serverName={server.name}
          canManage={server.role !== "member"}
          channels={channels}
          view={view}
          current={current}
          voiceView={voiceView}
          voiceStates={voiceStates}
          speaking={speaking}
          onText={(id) => { setCurrent(id); setView("text"); showContent(); }}
          onVoice={(id) => { setVoiceView(id); setView("voice"); showContent(); void voice.join(id); }}
          onCreate={setCreating}
          onInvite={() => setInviting(true)}
          onSettings={() => setServerSettings(true)}
          onLeave={server.role === "owner" ? undefined : () => leaveServer(server)}
          onProfile={setViewProfile}
          footer={footer}
          unread={unread}
          onEdit={setEditingChannel}
        />
      ) : (
        <aside className="sidebar" aria-label="Canais">
          <div className="channels">{mobile && serversLoaded && noServer}</div>
          {footer}
        </aside>
      )}
      <main className="stage">
        {pane === "content" && callBar}
        {home ? (
          dmChannel && dm && dmCall ? (
            <div className="dm-call">
              <button className="plain-btn dm-call-back" onClick={() => setDmCall(false)}>← Voltar ao chat</button>
              <CallView channel={dmChannel} snap={snap} voice={voice} members={voiceStates} onProfile={setViewProfile} />
            </div>
          ) : dmChannel && dm ? (
            <ChatView
              dm
              channel={dmChannel}
              typing={typingIds(dmChannel?.id)}
              onTyping={() => dmChannel && sendTyping(dmChannel.id)}
              messages={messages}
              members={dmMembers}
              meId={user.id}
              onSend={send}
              outbox={pendingHere}
              onRetry={retrySend}
              onDiscard={discardSend}
              me={user}
              membersOpen={false}
              onToggleMembers={() => {}}
              canInvite={false}
              onInvite={() => {}}
              onProfile={setViewProfile}
              hasMore={hasMore}
              onLoadOlder={loadOlder}
              headerExtra={
                <>
                  <IconButton label={snap.channelId === dm.channelId ? "Voltar à chamada" : voiceStates.some((v) => v.channelId === dm.channelId) ? "Entrar na chamada" : "Ligar"} onClick={() => { setDmCall(true); if (snap.channelId !== dm.channelId) void voice.join(dm.channelId); }}>
                    <Icon name="speaker" />
                  </IconButton>
                  {dm.group ? (
                    <>
                      <IconButton label="Adicionar ao grupo" onClick={() => setAddToGroup(true)}><Icon name="user-plus" /></IconButton>
                      <IconButton label="Sair do grupo" onClick={() => { if (window.confirm("Sair deste grupo?")) { const id = dm.channelId; if (snap.channelId === id) void voice.leave(); setDmId(undefined); void api.leaveGroup(id).then(() => loadHome()).catch(() => {}); } }}><Icon name="logout" /></IconButton>
                    </>
                  ) : null}
                  <IconButton
                    label={dm.group ? (dmPanel ? "Ocultar lista de membros" : "Mostrar lista de membros") : dmPanel ? "Ocultar perfil do usuário" : "Mostrar perfil do usuário"}
                    aria-pressed={mobile ? drawer : dmPanel}
                    className={(mobile ? drawer : dmPanel) ? "is-active" : ""}
                    onClick={toggleDmPanel}
                  >
                    <Icon name={dm.group ? "users" : "profile"} />
                  </IconButton>
                </>
              }
            />
          ) : (
            <FriendsPanel friends={friends} online={online} onMessage={(id) => void messageUser(id)} onProfile={setViewProfile} onChanged={() => void loadHome().catch(() => {})} />
          )
        ) : !server ? (
          serversLoaded && (
            noServer
          )
        ) : view === "voice" ? (
          <CallView channel={known[voiceView ?? ""]} snap={snap} voice={voice} members={voiceStates} onProfile={setViewProfile} />
        ) : (
          <ChatView
            channel={textChannel}
            typing={typingIds(textChannel?.id)}
            onTyping={() => textChannel && sendTyping(textChannel.id)}
            messages={messages}
            members={members}
            meId={user.id}
            onSend={send}
            outbox={pendingHere}
            onRetry={retrySend}
            onDiscard={discardSend}
            me={user}
            membersOpen={mobile ? drawer : membersOpen}
            onToggleMembers={toggleMembers}
            canInvite
            onInvite={() => setInviting(true)}
            onProfile={setViewProfile}
            hasMore={hasMore}
            onLoadOlder={loadOlder}
            canModerate={server.role !== "member"}
          />
        )}
      </main>
      {showDmPanel && dm && (dm.group
        ? <DmGroupPanel people={[...dm.users, { id: user.id, username: user.username, displayName: user.displayName, avatar: user.avatar }]} online={online} onProfile={setViewProfile} />
        : dm.users[0] && <DmProfilePanel userId={dm.users[0].id} h={profileHandlers} version={profileVersion} onFull={() => setFullProfile(dm.users[0]!.id)} onOpenUser={setFullProfile} />)}
      {mobile && (showMembers || showDmPanel) && <button className="m-backdrop" aria-label="Fechar painel" onClick={() => setDrawer(false)} />}
      {showMembers && <MemberList members={members} online={online} onProfile={(m) => setViewProfile(m.userId)} />}
      <ScreenPicker />
      {sharing && <ShareModal snap={snap} voice={voice} onClose={() => setSharing(false)} />}
      {newGroup && <NewGroupModal friends={friends} onClose={() => setNewGroup(false)} onCreated={(d) => { setDms((l) => [d, ...l.filter((x) => x.channelId !== d.channelId)]); openDm(d); }} />}
      {addToGroup && dm && <AddToGroupModal dm={dm} friends={friends} onClose={() => setAddToGroup(false)} onChanged={() => void loadHome().catch(() => {})} />}
      {popout && (
        <ProfilePopout
          key={popout.id}
          userId={popout.id}
          anchor={popout.anchor}
          role={home ? undefined : members.find((m) => m.userId === popout.id)?.role}
          h={profileHandlers}
          onFull={() => { setPopout(undefined); setFullProfile(popout.id); }}
          onClose={closePopout}
        />
      )}
      {fullProfile && <ProfileModal userId={fullProfile} role={home ? undefined : members.find((m) => m.userId === fullProfile)?.role} h={profileHandlers} onOpenUser={setFullProfile} onClose={closeFull} />}
      {settings && <SettingsModal user={user} voice={voice} prefs={snap.prefs} tab={settings} onTab={setSettings} onChanged={setUser} onLogout={() => { void voice.leave(); onLogout(); }} onClose={() => setSettings(null)} />}
      {editingChannel && <EditChannelModal channel={editingChannel} onClose={() => setEditingChannel(undefined)} />}
      {creating && server && <CreateChannelModal serverId={server.id} initialKind={creating} onClose={() => setCreating(undefined)} />}
      {inviting && server && <InviteModal serverId={server.id} serverName={server.name} onClose={() => setInviting(false)} />}
      {creatingServer && (
        <CreateServerModal
          ownedCount={ownedCount}
          onClose={() => setCreatingServer(false)}
          onCreated={(created) => { setServers((l) => [...l, created]); chooseServer(created.id); }}
        />
      )}
      {joining && (
        <JoinServerModal
          onClose={() => setJoining(false)}
          onJoined={(joined) => { setServers((l) => (l.some((x) => x.id === joined.id) ? l : [...l, joined])); chooseServer(joined.id); }}
        />
      )}
      {serverSettings && server && (
        <ServerSettingsModal
          server={server}
          me={user}
          members={members}
          ownedCount={ownedCount}
          onClose={() => setServerSettings(false)}
          onChanged={() => void loadServers().then(() => loadServer(server.id, false))}
          onGone={() => { setServerSettings(false); void loadServers(); }}
        />
      )}
    </div>
    </MobileBack.Provider>
    </PresenceContext.Provider>
  );
}
