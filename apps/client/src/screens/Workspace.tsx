import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { serverEvent, shownName, type Channel, type ChannelKind, type Dm, type Friend, type Member, type Message, type Server, type User, type VoiceState } from "@turtle/protocol";
import { Button } from "@turtle/ui";
import { api, getToken } from "../api";
import { VoiceClient } from "../voice/client";
import { ServerRail } from "../components/ServerRail";
import { ChannelSidebar } from "../components/ChannelSidebar";
import { UserPanel } from "../components/UserPanel";
import { ChatView } from "../components/ChatView";
import { CallView } from "../components/CallView";
import { ShareModal } from "../components/ShareModal";
import { ScreenPicker } from "../components/ScreenPicker";
import { SettingsModal, type SettingsTab } from "../components/SettingsModal";
import { ProfilePopup } from "../components/ProfilePopup";
import { FriendsPanel, HomeSidebar } from "../components/Home";
import { MemberList } from "../components/MemberList";
import { CreateChannelModal, InviteModal } from "../components/modals";
import { CreateServerModal, JoinServerModal, ServerSettingsModal } from "../components/ServerModals";

const MEMBERS_KEY = "turtle.membersOpen";
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
  const [voiceStates, setVoiceStates] = useState<VoiceState[]>([]);
  const [settings, setSettings] = useState<SettingsTab | null>(null);
  const [viewProfile, setViewProfile] = useState<string>();
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
  const [unread, setUnread] = useState<Set<string>>(new Set());
  const [membersOpen, setMembersOpen] = useState(() => {
    try {
      return localStorage.getItem(MEMBERS_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const ws = useRef<WebSocket | undefined>(undefined);
  const currentRef = useRef<string | undefined>(undefined);
  /** Canal aberto agora: a conversa direta no Início, senão o canal do servidor. */
  const activeId = home ? dmId : current;
  currentRef.current = activeId;
  const meRef = useRef(user.id);
  meRef.current = user.id;
  /** Canais de servidor já conhecidos: mensagem de outro canal é de uma DM nova. */
  const serverMessageIds = useRef<Set<string>>(new Set());
  const dmsRef = useRef<Dm[]>([]);
  dmsRef.current = dms;
  const serverRef = useRef<string | undefined>(undefined);
  serverRef.current = serverId;

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
  }, [chooseServer]);

  /** Busca canais e membros do servidor atual. `pick` escolhe um canal de texto se ainda não há um. */
  const loadServer = useCallback(async (id: string, pick: boolean) => {
    const [ch, mem] = await Promise.all([api.channels(id), api.members(id)]);
    if (serverRef.current !== id) return;
    setChannels(ch);
    setMembers(mem);
    setKnown((k) => ({ ...k, ...Object.fromEntries(ch.map((c) => [c.id, c])) }));
    if (pick || !ch.some((c) => c.id === currentRef.current)) setCurrent(ch.find((x) => x.kind === "text")?.id);
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
    if (!activeId) return;
    let stale = false;
    api.messages(activeId).then((m) => !stale && setMessages(m)).catch(() => {});
    return () => { stale = true; };
  }, [activeId]);

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
    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const s = new WebSocket(`${proto}://${location.host}/ws?token=${getToken()}`);
      ws.current = s;
      s.onopen = () => voice.resendState();
      s.onmessage = (ev) => {
        const parsed = serverEvent.safeParse(JSON.parse(ev.data));
        if (!parsed.success) return;
        const evt = parsed.data;
        if (evt.t === "message" && evt.message.channelId === currentRef.current) setMessages((m) => [...m, evt.message]);
        if (evt.t === "message" && dmsRef.current.some((d) => d.channelId === evt.message.channelId)) {
          const at = evt.message.createdAt;
          setDms((l) => l.map((d) => (d.channelId === evt.message.channelId ? { ...d, lastMessageAt: at } : d)).sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? "")));
          if (evt.message.channelId !== currentRef.current)
            setUnread((u) => (u.has(evt.message.channelId) ? u : new Set(u).add(evt.message.channelId)));
        } else if (evt.t === "message" && evt.message.userId !== meRef.current && !serverMessageIds.current.has(evt.message.channelId)) {
          // Mensagem de uma conversa que ainda não conheço (primeira DM de alguém): busca a lista.
          void loadHome().then(() => setUnread((u) => new Set(u).add(evt.message.channelId))).catch(() => {});
        }
        if (evt.t === "friends") void loadHome().catch(() => {});
        if (evt.t === "channel") {
          setKnown((k) => ({ ...k, [evt.channel.id]: evt.channel }));
          if (evt.channel.serverId === serverRef.current) setChannels((c) => (c.some((x) => x.id === evt.channel.id) ? c : [...c, evt.channel]));
        }
        if (evt.t === "sync") {
          void loadServers().then(() => (serverRef.current ? loadServer(serverRef.current, false) : undefined)).catch(() => {});
          // Perfil de alguém mudou: atualiza o meu e as fotos/nomes nas mensagens.
          api.me().then(setUser).catch(() => {});
          void loadHome().catch(() => {});
          if (currentRef.current) api.messages(currentRef.current).then(setMessages).catch(() => {});
        }
        if (evt.t === "presence") setOnline(evt.online);
        if (evt.t === "voiceStates") setVoiceStates(evt.states);
      };
      s.onclose = (ev) => {
        if (ev.code === 4401) return onLogout();
        if (!closed) retry = setTimeout(connect, 2000);
      };
    };
    connect();
    return () => { closed = true; clearTimeout(retry); ws.current?.close(); };
  }, [onLogout, voice, loadServers, loadServer, loadHome]);

  const send = useCallback((content: string) => {
    if (!activeId) return;
    ws.current?.send(JSON.stringify({ t: "send", channelId: activeId, content }));
  }, [activeId]);

  const openDm = useCallback((dm: Dm) => {
    setHome(true);
    setDmId(dm.channelId);
    setUnread((u) => { if (!u.has(dm.channelId)) return u; const n = new Set(u); n.delete(dm.channelId); return n; });
  }, []);
  const messageUser = useCallback(async (userId: string) => {
    try {
      const dm = await api.openDm(userId);
      setDms((l) => (l.some((d) => d.channelId === dm.channelId) ? l : [dm, ...l]));
      openDm(dm);
    } catch {
      // sem permissão (nem amigos nem servidor em comum): o botão do perfil já avisa só pelo erro do servidor
    }
  }, [openDm]);

  const toggleMembers = () => {
    setMembersOpen((o) => {
      try {
        localStorage.setItem(MEMBERS_KEY, o ? "0" : "1");
      } catch {
        // sem storage: só não lembra
      }
      return !o;
    });
  };

  const logout = () => { void voice.leave(); onLogout(); };
  const speaking = new Set(snap.channelId ? snap.participants.filter((p) => p.speaking && !p.muted).map((p) => p.id) : []);
  const textChannel = channels.find((c) => c.id === current);
  const showMembers = !home && membersOpen && view === "text" && !!serverId;
  const dm = dms.find((d) => d.channelId === dmId);
  const dmChannel: Channel | undefined = dm && { id: dm.channelId, serverId: "", name: shownName(dm.user), kind: "text" };
  const dmMembers: Member[] = dm
    ? [dm.user, { id: user.id, username: user.username, displayName: user.displayName, avatar: user.avatar }].map((p) => ({ userId: p.id, username: p.username, displayName: p.displayName, avatar: p.avatar, role: "member" as const }))
    : [];
  const pendingIn = friends.filter((f) => f.status === "incoming").length;
  const server = servers.find((s) => s.id === serverId);
  const ownedCount = servers.filter((s) => s.ownerId === user.id).length;
  const callServer = servers.find((s) => s.id === known[snap.channelId ?? ""]?.serverId);
  const allKnown = Object.values(known);
  serverMessageIds.current = new Set(Object.keys(known));
  const footer = <UserPanel user={user} snap={snap} voice={voice} channels={allKnown} serverName={callServer?.name} onSettings={() => setSettings("voice")} onProfile={() => setSettings("profile")} onShare={() => setSharing(true)} onLogout={onLogout} />;

  return (
    <div className={`app ${showMembers ? "with-members" : ""}`}>
      <ServerRail
        servers={servers}
        activeId={serverId}
        onSelect={chooseServer}
        onCreate={() => setCreatingServer(true)}
        onJoin={() => setJoining(true)}
        homeActive={home}
        unread={unread.size}
        onHome={() => setHome(true)}
      />
      {home ? (
        <HomeSidebar
          dms={dms}
          current={dmId}
          unread={unread}
          online={online}
          friendsOpen={!dmId}
          pending={pendingIn}
          onFriends={() => setDmId(undefined)}
          onDm={openDm}
          onProfile={setViewProfile}
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
          onText={(id) => { setCurrent(id); setView("text"); }}
          onVoice={(id) => { setVoiceView(id); setView("voice"); void voice.join(id); }}
          onCreate={setCreating}
          onInvite={() => setInviting(true)}
          onSettings={() => setServerSettings(true)}
          onLogout={logout}
          onProfile={setViewProfile}
          footer={footer}
        />
      ) : (
        <aside className="sidebar" aria-label="Canais">
          <div className="channels" />
          {footer}
        </aside>
      )}
      <main className="stage">
        {home ? (
          dmChannel ? (
            <ChatView dm channel={dmChannel} messages={messages} members={dmMembers} meId={user.id} onSend={send} membersOpen={false} onToggleMembers={() => {}} canInvite={false} onInvite={() => {}} onProfile={setViewProfile} />
          ) : (
            <FriendsPanel friends={friends} online={online} onMessage={(id) => void messageUser(id)} onProfile={setViewProfile} onChanged={() => void loadHome().catch(() => {})} />
          )
        ) : !server ? (
          serversLoaded && (
            <div className="no-server">
              <h2 className="t-display">Você ainda não está em nenhum servidor</h2>
              <p className="t-muted">Crie o seu ou entre em um com um convite de um amigo.</p>
              <div className="no-server-actions">
                <Button onClick={() => setCreatingServer(true)}>Criar servidor</Button>
                <Button variant="ghost" onClick={() => setJoining(true)}>Entrar com convite</Button>
              </div>
            </div>
          )
        ) : view === "voice" ? (
          <CallView channel={known[voiceView ?? ""]} snap={snap} voice={voice} members={voiceStates} onProfile={setViewProfile} />
        ) : (
          <ChatView
            channel={textChannel}
            messages={messages}
            members={members}
            meId={user.id}
            onSend={send}
            membersOpen={membersOpen}
            onToggleMembers={toggleMembers}
            canInvite
            onInvite={() => setInviting(true)}
            onProfile={setViewProfile}
          />
        )}
      </main>
      {showMembers && <MemberList members={members} online={online} onProfile={(m) => setViewProfile(m.userId)} />}
      <ScreenPicker />
      {sharing && <ShareModal snap={snap} voice={voice} onClose={() => setSharing(false)} />}
      {viewProfile && <ProfilePopup userId={viewProfile} role={members.find((m) => m.userId === viewProfile)?.role} meId={user.id} onMessage={(id) => void messageUser(id)} onChanged={() => void loadHome().catch(() => {})} onClose={() => setViewProfile(undefined)} />}
      {settings && <SettingsModal user={user} voice={voice} prefs={snap.prefs} tab={settings} onTab={setSettings} onChanged={setUser} onClose={() => setSettings(null)} />}
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
  );
}
