import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { serverEvent, type Channel, type ChannelKind, type Member, type Message, type Server, type User, type VoiceState } from "@turtle/protocol";
import { Button } from "@turtle/ui";
import { api, getToken } from "../api";
import { VoiceClient } from "../voice/client";
import { VoiceSettings } from "../voice/VoiceSettings";
import { ServerRail } from "../components/ServerRail";
import { ChannelSidebar } from "../components/ChannelSidebar";
import { UserPanel } from "../components/UserPanel";
import { ChatView } from "../components/ChatView";
import { CallView } from "../components/CallView";
import { ShareModal } from "../components/ShareModal";
import { ScreenPicker } from "../components/ScreenPicker";
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
export function Workspace({ user, onLogout }: { user: User; onLogout: () => void }) {
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
  const [settings, setSettings] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [creating, setCreating] = useState<ChannelKind>();
  const [inviting, setInviting] = useState(false);
  const [creatingServer, setCreatingServer] = useState(false);
  const [joining, setJoining] = useState(false);
  const [serverSettings, setServerSettings] = useState(false);
  const [membersOpen, setMembersOpen] = useState(() => {
    try {
      return localStorage.getItem(MEMBERS_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const ws = useRef<WebSocket | undefined>(undefined);
  const currentRef = useRef<string | undefined>(undefined);
  currentRef.current = current;
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
    if (!current) return;
    api.messages(current).then(setMessages);
  }, [current]);

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
        if (evt.t === "channel") {
          setKnown((k) => ({ ...k, [evt.channel.id]: evt.channel }));
          if (evt.channel.serverId === serverRef.current) setChannels((c) => (c.some((x) => x.id === evt.channel.id) ? c : [...c, evt.channel]));
        }
        if (evt.t === "sync") {
          void loadServers().then(() => (serverRef.current ? loadServer(serverRef.current, false) : undefined)).catch(() => {});
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
  }, [onLogout, voice, loadServers, loadServer]);

  const send = useCallback((content: string) => {
    if (!current) return;
    ws.current?.send(JSON.stringify({ t: "send", channelId: current, content }));
  }, [current]);

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
  const showMembers = membersOpen && view === "text" && !!serverId;
  const server = servers.find((s) => s.id === serverId);
  const ownedCount = servers.filter((s) => s.ownerId === user.id).length;
  const callServer = servers.find((s) => s.id === known[snap.channelId ?? ""]?.serverId);
  const allKnown = Object.values(known);

  return (
    <div className={`app ${showMembers ? "with-members" : ""}`}>
      <ServerRail
        servers={servers}
        activeId={serverId}
        onSelect={chooseServer}
        onCreate={() => setCreatingServer(true)}
        onJoin={() => setJoining(true)}
      />
      {server ? (
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
          footer={<UserPanel user={user} snap={snap} voice={voice} channels={allKnown} serverName={callServer?.name} onSettings={() => setSettings(true)} onShare={() => setSharing(true)} onLogout={onLogout} />}
        />
      ) : (
        <aside className="sidebar" aria-label="Canais">
          <div className="channels" />
          <UserPanel user={user} snap={snap} voice={voice} channels={allKnown} serverName={callServer?.name} onSettings={() => setSettings(true)} onShare={() => setSharing(true)} onLogout={onLogout} />
        </aside>
      )}
      <main className="stage">
        {!server ? (
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
          <CallView channel={known[voiceView ?? ""]} snap={snap} voice={voice} members={voiceStates} />
        ) : (
          <ChatView
            channel={textChannel}
            messages={messages}
            onSend={send}
            membersOpen={membersOpen}
            onToggleMembers={toggleMembers}
            canInvite
            onInvite={() => setInviting(true)}
          />
        )}
      </main>
      {showMembers && <MemberList members={members} online={online} />}
      <ScreenPicker />
      {sharing && <ShareModal snap={snap} voice={voice} onClose={() => setSharing(false)} />}
      {settings && <VoiceSettings voice={voice} prefs={snap.prefs} onClose={() => setSettings(false)} />}
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
