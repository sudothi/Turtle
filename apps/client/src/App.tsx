import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { serverEvent, type Channel, type Message, type User } from "@turtle/protocol";
import { api, getToken, setToken } from "./api";

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

function Chat({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [current, setCurrent] = useState<string>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [online, setOnline] = useState<string[]>([]);
  const [invite, setInvite] = useState("");
  const ws = useRef<WebSocket | undefined>(undefined);
  const currentRef = useRef<string | undefined>(undefined);
  const bottom = useRef<HTMLDivElement>(null);
  currentRef.current = current;

  useEffect(() => {
    api.channels().then((c) => { setChannels(c); setCurrent(c[0]?.id); });
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
      s.onmessage = (ev) => {
        const parsed = serverEvent.safeParse(JSON.parse(ev.data));
        if (!parsed.success) return;
        const evt = parsed.data;
        if (evt.t === "message" && evt.message.channelId === currentRef.current) setMessages((m) => [...m, evt.message]);
        if (evt.t === "channel") setChannels((c) => (c.some((x) => x.id === evt.channel.id) ? c : [...c, evt.channel]));
        if (evt.t === "presence") setOnline(evt.online);
      };
      s.onclose = (ev) => {
        if (ev.code === 4401) return onLogout();
        if (!closed) retry = setTimeout(connect, 2000);
      };
    };
    connect();
    return () => { closed = true; clearTimeout(retry); ws.current?.close(); };
  }, [onLogout]);

  useEffect(() => { bottom.current?.scrollIntoView(); }, [messages]);

  const send = useCallback((e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem("text") as HTMLInputElement;
    if (!input.value.trim() || !current) return;
    ws.current?.send(JSON.stringify({ t: "send", channelId: current, content: input.value }));
    input.value = "";
  }, [current]);

  return (
    <div className="app">
      <aside className="side">
        <h2>Turtle</h2>
        {channels.map((c) => (
          <button key={c.id} className={`ch ${c.id === current ? "on" : ""}`} onClick={() => setCurrent(c.id)}># {c.name}</button>
        ))}
        {user.isAdmin && (
          <>
            <button onClick={() => { const n = prompt("Nome do canal"); if (n) api.createChannel(n).catch((e) => alert(e.message)); }}>+ canal</button>
            <button onClick={async () => setInvite((await api.createInvite()).code)}>Gerar convite</button>
            {invite && <div className="dim">código: <b>{invite}</b></div>}
          </>
        )}
        <div style={{ flex: 1 }} />
        <div className="dim">{user.username}</div>
        <button onClick={onLogout}>Sair</button>
      </aside>
      <section className="main">
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
      </section>
      <aside className="side right">
        <h2>Online</h2>
        {online.map((n) => <div key={n}>{n}</div>)}
      </aside>
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
