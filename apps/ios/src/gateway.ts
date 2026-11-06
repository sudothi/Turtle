import { serverEvent, type ClientEvent, type ServerEvent, type VoiceState } from "@turtle/protocol";
import type { Api } from "./api";

export type VoiceReport = Extract<ClientEvent, { t: "voice" }>;
export interface GatewayState { connected: boolean; states: VoiceState[]; online: string[]; busy: string[]; revision: number }

/** Best-effort gateway presence. Native media owns the call independently. */
export class Gateway {
  private socket?: WebSocket;
  private retry?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private stopped = true;
  private attempts = 0;
  private state: GatewayState = { connected: false, states: [], online: [], busy: [], revision: 0 };
  private listeners = new Set<() => void>();
  private events = new Set<(event: ServerEvent) => void>();
  private report: VoiceReport = { t: "voice", channelId: null, muted: true, deafened: false, camera: false, screen: false };
  constructor(private readonly api: Api, private readonly expired: () => void, private readonly sync: () => void) {}
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = () => this.state;
  subscribeEvents = (fn: (event: ServerEvent) => void) => { this.events.add(fn); return () => { this.events.delete(fn); }; };
  private set(patch: Partial<GatewayState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); }
  private send(value: ClientEvent) { if (this.socket?.readyState === 1) this.socket.send(JSON.stringify(value)); }
  update = (report: VoiceReport) => { this.report = report; this.send(report); };

  invalidate = () => { this.set({ revision: this.state.revision + 1 }); this.sync(); };

  start() { if (this.stopped) { this.stopped = false; this.connect(); } }
  resume() {
    if (this.stopped) return;
    // Replace a socket that can look OPEN after iOS suspended its transport.
    clearTimeout(this.retry);
    this.release();
    this.set({ connected: false, states: [], online: [], busy: [] });
    this.connect();
  }

  private connect() {
    if (this.stopped) return;
    const socket = new WebSocket(this.api.gatewayUrl());
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket || this.stopped) return;
      this.attempts = 0;
      this.set({ connected: true, states: [], revision: this.state.revision + 1 });
      this.send(this.report);
      this.sync();
      this.heartbeat = setInterval(() => this.send({ t: "ping" }), 25_000);
    };
    socket.onmessage = event => {
      if (this.socket !== socket) return;
      try {
        const parsed = serverEvent.safeParse(JSON.parse(String(event.data)));
        if (!parsed.success) return;
        if (parsed.data.t === "voiceStates") this.set({ ...this.state, states: parsed.data.states });
        if (parsed.data.t === "presence") this.set({ online: parsed.data.online, busy: parsed.data.busy });
        if (parsed.data.t === "sync") this.sync();
        if (["sync", "friends", "message", "messageUpdate", "messageDelete", "channel", "userUpdate", "read"].includes(parsed.data.t)) this.set({ revision: this.state.revision + 1 });
        this.events.forEach(fn => fn(parsed.data));
      } catch { /* Malformed messages do not tear down native audio. */ }
    };
    socket.onerror = () => { if (this.socket === socket) socket.close(); };
    socket.onclose = event => {
      if (this.socket !== socket) return;
      clearInterval(this.heartbeat);
      this.socket = undefined;
      this.set({ connected: false, states: [], online: [], busy: [] });
      if (event.code === 4401) { this.stop(); this.expired(); return; }
      if (!this.stopped) {
        const delay = Math.min(30_000, 1_000 * 2 ** this.attempts++) + Math.random() * 500;
        this.retry = setTimeout(() => this.connect(), delay);
      }
    };
  }

  private release() {
    clearInterval(this.heartbeat);
    const socket = this.socket;
    this.socket = undefined;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
    }
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.retry);
    this.release();
    this.set({ connected: false, states: [], online: [], busy: [] });
  }
}
