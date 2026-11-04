import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { serverEvent, type Channel, type ChannelKind, type Message, type User, type VoiceState } from "@turtle/protocol";
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

const MEMBERS_KEY = "turtle.membersOpen";

/** Tela principal: servidores | canais | chat ou chamada | membros. */
export function Workspace({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [channels, setChannels] = useState<Channel[]>([]);
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

  const [voice] = useState(
    () =>
      new VoiceClient((state) => {
        if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify({ t: "voice", ...state }));
      }),
  );
  const snap = useSyncExternalStore(voice.subscribe, voice.getSnapshot);
  useEffect(() => () => void voice.leave(), [voice]);

  useEffect(() => {
    api.channels().then((c) => { setChannels(c); setCurrent(c.find((x) => x.kind === "text")?.id); });
  }, []);

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
        if (evt.t === "channel") setChannels((c) => (c.some((x) => x.id === evt.channel.id) ? c : [...c, evt.channel]));
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
  }, [onLogout, voice]);

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
  const showMembers = membersOpen && view === "text";

  return (
    <div className={`app ${showMembers ? "with-members" : ""}`}>
      <ServerRail servers={[{ id: "turtle", name: "Turtle" }]} activeId="turtle" />
      <ChannelSidebar
        user={user}
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
        onLogout={logout}
        footer={<UserPanel user={user} snap={snap} voice={voice} channels={channels} onSettings={() => setSettings(true)} onShare={() => setSharing(true)} onLogout={onLogout} />}
      />
      <main className="stage">
        {view === "voice" ? (
          <CallView channel={channels.find((c) => c.id === voiceView)} snap={snap} voice={voice} members={voiceStates} />
        ) : (
          <ChatView
            channel={textChannel}
            messages={messages}
            onSend={send}
            membersOpen={membersOpen}
            onToggleMembers={toggleMembers}
            isAdmin={user.isAdmin}
            onInvite={() => setInviting(true)}
          />
        )}
      </main>
      {showMembers && <MemberList online={online} />}
      <ScreenPicker />
      {sharing && <ShareModal snap={snap} voice={voice} onClose={() => setSharing(false)} />}
      {settings && <VoiceSettings voice={voice} prefs={snap.prefs} onClose={() => setSettings(false)} />}
      {creating && <CreateChannelModal initialKind={creating} onClose={() => setCreating(undefined)} />}
      {inviting && <InviteModal onClose={() => setInviting(false)} />}
    </div>
  );
}
