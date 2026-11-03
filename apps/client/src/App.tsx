import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { serverEvent, type Channel, type Message, type User, type VoiceState } from "@turtle/protocol";
import { api, getToken, setToken } from "./api";
import { VoiceClient, type CallParticipant, type VoiceSnapshot } from "./voice/client";
import { VoiceSettings } from "./voice/VoiceSettings";

function Auth({ onAuth }: { onAuth: (u: User) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const username = String(f.get("username"));
    const password = String(f.get("password"));
    try {
      const r = mode === "login" ? await api.login(username, password) : await api.register(String(f.get("invite")), username, password);
      setToken(r.token);
      onAuth(r.user);
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <div className="auth">
      <form onSubmit={submit}>
        <h1>Turtle</h1>
        {mode === "register" && <input name="invite" placeholder="código de convite" required />}
        <input name="username" placeholder="usuário" required />
        <input name="password" type="password" placeholder="senha (mín. 8)" required />
        {error && <div className="err">{error}</div>}
        <button type="submit">{mode === "login" ? "Entrar" : "Criar conta"}</button>
        <button type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
          {mode === "login" ? "Tenho um convite" : "Já tenho conta"}
        </button>
      </form>
    </div>
  );
}

const qualityLabel: Record<CallParticipant["quality"], string> = {
  excellent: "conexão ótima", good: "conexão boa", poor: "conexão ruim", lost: "sem conexão", unknown: "",
};

function CallView({ channel, snap, voice }: { channel?: Channel; snap: VoiceSnapshot; voice: VoiceClient }) {
  const inThis = channel && snap.channelId === channel.id && snap.status !== "idle";
  if (!channel) return null;
  if (!inThis)
    return (
      <div className="call empty">
        <h2>🔊 {channel.name}</h2>
        <button onClick={() => void voice.join(channel.id)}>Entrar na chamada</button>
      </div>
    );
  return (
    <div className="call">
      <h2>🔊 {channel.name} {snap.status !== "connected" && <span className="dim">({snap.status === "connecting" ? "conectando…" : "reconectando…"})</span>}</h2>
      <div className="tiles">
        {snap.participants.map((p) => (
          <div key={p.id} className={`tile ${p.speaking && !p.muted ? "speaking" : ""}`}>
            <div className="avatar">{p.name.slice(0, 1).toUpperCase()}</div>
            <div className="name">{p.name}{p.isLocal && " (você)"}</div>
            <div className="dim">{[p.muted && "mudo", qualityLabel[p.quality]].filter(Boolean).join(" · ")}</div>
            {!p.isLocal && (
              <input
                type="range" min={0} max={1} step={0.05} aria-label={`Volume de ${p.name}`}
                value={snap.prefs.volumes[p.id] ?? 1}
                onChange={(e) => voice.setVolume(p.id, Number(e.target.value))}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function VoicePanel({ snap, voice, channels, onSettings }: { snap: VoiceSnapshot; voice: VoiceClient; channels: Channel[]; onSettings: () => void }) {
  const channel = channels.find((c) => c.id === snap.channelId);
  return (
    <div className="voicepanel">
      {snap.status !== "idle" && (
        <>
          <div>
            <b>{snap.status === "connected" ? "Voz conectada" : snap.status === "connecting" ? "Conectando…" : "Reconectando…"}</b>
            <div className="dim">{channel?.name}</div>
          </div>
          {snap.needsAudioUnlock && <button onClick={() => void voice.unlockAudio()}>Ativar som</button>}
        </>
      )}
      {snap.error && <div className="err">{snap.error}</div>}
      <div className="row">
        <button className={snap.muted ? "on" : ""} aria-pressed={snap.muted} title="Mudo" onClick={() => void voice.toggleMute()}>{snap.muted ? "Mudo" : "Mic"}</button>
        <button className={snap.deafened ? "on" : ""} aria-pressed={snap.deafened} title="Ensurdecer" onClick={() => void voice.toggleDeafen()}>{snap.deafened ? "Surdo" : "Som"}</button>
        <button title="Configurações de voz" onClick={onSettings}>⚙</button>
        {snap.status !== "idle" && <button title="Sair da chamada" onClick={() => void voice.leave()}>Sair</button>}
      </div>
    </div>
  );
}

function Chat({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [current, setCurrent] = useState<string>();
  const [view, setView] = useState<"text" | "voice">("text");
  const [voiceView, setVoiceView] = useState<string>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [online, setOnline] = useState<string[]>([]);
  const [voiceStates, setVoiceStates] = useState<VoiceState[]>([]);
  const [invite, setInvite] = useState("");
  const [settings, setSettings] = useState(false);
  const ws = useRef<WebSocket | undefined>(undefined);
  const currentRef = useRef<string | undefined>(undefined);
  const bottom = useRef<HTMLDivElement>(null);
  currentRef.current = current;

  const [voice] = useState(
    () =>
      new VoiceClient((channelId, muted, deafened) => {
        if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify({ t: "voice", channelId, muted, deafened }));
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

  useEffect(() => { bottom.current?.scrollIntoView(); }, [messages]);

  const send = useCallback((e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem("text") as HTMLInputElement;
    if (!input.value.trim() || !current) return;
    ws.current?.send(JSON.stringify({ t: "send", channelId: current, content: input.value }));
    input.value = "";
  }, [current]);

  const createChannel = (kind: "text" | "voice") => {
    const n = prompt(kind === "voice" ? "Nome do canal de voz" : "Nome do canal de texto");
    if (n) api.createChannel(n, kind).catch((e) => alert(e.message));
  };

  const textChannels = channels.filter((c) => c.kind === "text");
  const voiceChannels = channels.filter((c) => c.kind === "voice");
  const speaking = new Set(snap.participants.filter((p) => p.speaking && !p.muted).map((p) => p.id));

  return (
    <div className="app">
      <aside className="side">
        <h2>Turtle</h2>
        <div className="section">Texto</div>
        {textChannels.map((c) => (
          <button key={c.id} className={`ch ${view === "text" && c.id === current ? "on" : ""}`} onClick={() => { setCurrent(c.id); setView("text"); }}># {c.name}</button>
        ))}
        <div className="section">Voz</div>
        {voiceChannels.map((c) => (
          <div key={c.id}>
            <button
              className={`ch ${view === "voice" && c.id === voiceView ? "on" : ""}`}
              onClick={() => { setVoiceView(c.id); setView("voice"); void voice.join(c.id); }}
            >🔊 {c.name}</button>
            <ul className="vmembers">
              {voiceStates.filter((v) => v.channelId === c.id).map((v) => (
                <li key={v.userId} className={speaking.has(v.userId) && snap.channelId === c.id ? "speaking" : ""}>
                  {v.username}
                  {v.deafened ? <span className="dim"> · surdo</span> : v.muted ? <span className="dim"> · mudo</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {user.isAdmin && (
          <>
            <div className="row">
              <button onClick={() => createChannel("text")}>+ texto</button>
              <button onClick={() => createChannel("voice")}>+ voz</button>
            </div>
            <button onClick={async () => setInvite((await api.createInvite()).code)}>Gerar convite</button>
            {invite && <div className="dim">código: <b>{invite}</b></div>}
          </>
        )}
        <div style={{ flex: 1 }} />
        <VoicePanel snap={snap} voice={voice} channels={channels} onSettings={() => setSettings(true)} />
        <div className="dim">{user.username}</div>
        <button onClick={() => { void voice.leave(); onLogout(); }}>Sair da conta</button>
      </aside>
      <section className="main">
        {view === "voice" ? (
          <CallView channel={channels.find((c) => c.id === voiceView)} snap={snap} voice={voice} />
        ) : (
          <>
            <div className="msgs">
              {messages.map((m) => (
                <div className="msg" key={m.id}>
                  <b>{m.username}</b><time>{new Date(m.createdAt).toLocaleTimeString()}</time>
                  <div>{m.content}</div>
                </div>
              ))}
              <div ref={bottom} />
            </div>
            <form className="composer" onSubmit={send}>
              <input name="text" placeholder="Mensagem" autoComplete="off" />
              <button type="submit">Enviar</button>
            </form>
          </>
        )}
      </section>
      <aside className="side right">
        <h2>Online</h2>
        {online.map((n) => <div key={n}>{n}</div>)}
      </aside>
      {settings && <VoiceSettings voice={voice} prefs={snap.prefs} onClose={() => setSettings(false)} />}
    </div>
  );
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!getToken()) return setReady(true);
    api.me().then(setUser).catch(() => setToken(null)).finally(() => setReady(true));
  }, []);
  const logout = useCallback(() => { setToken(null); setUser(null); }, []);
  if (!ready) return null;
  return user ? <Chat user={user} onLogout={logout} /> : <Auth onAuth={setUser} />;
}
