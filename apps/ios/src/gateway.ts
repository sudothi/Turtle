import { serverEvent, type ClientEvent, type ServerEvent, type VoiceState, type Activity } from "@turtle/protocol";
import type { Api } from "./api";

export type VoiceReport = Extract<ClientEvent, { t: "voice" }>;
export type IncomingCall = Extract<ServerEvent, { t: "ring" }>;
export interface GatewayState { connected: boolean; ring?: IncomingCall; states: VoiceState[]; online: string[]; busy: string[]; activities: Record<string, Activity>; revision: number }

/** Best-effort gateway presence. Native media owns the call independently. */
export class Gateway {
  private socket?: WebSocket;
  private retry?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private connecting?: ReturnType<typeof setTimeout>;
  private pong?: ReturnType<typeof setTimeout>;
  private stopped = true;
  private attempts = 0;
  private ringExpiry?: ReturnType<typeof setTimeout>;
  private state: GatewayState = { connected: false, states: [], online: [], busy: [], activities: {}, revision: 0 };
  private listeners = new Set<() => void>();
  private events = new Set<(event: ServerEvent) => void>();
  private report: VoiceReport = { t: "voice", channelId: null, muted: true, deafened: false, camera: false, screen: false };
  constructor(private readonly api: Api, private readonly expired: () => void, private readonly sync: () => void) {}
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = () => this.state;
  subscribeEvents = (fn: (event: ServerEvent) => void) => { this.events.add(fn); return () => { this.events.delete(fn); }; };
  private set(patch: Partial<GatewayState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); }
  private send(value: ClientEvent) {
    const socket = this.socket;
    if (socket?.readyState !== 1) return;
    try { socket.send(JSON.stringify(value)); }
    catch { this.disconnected(socket); }
  }
  dismissRing(decline = false) {
    const ring = this.state.ring;
    clearTimeout(this.ringExpiry);
    this.set({ ring: undefined });
    if (decline && ring) this.send({ t: "ringDecline", channelId: ring.channelId });
  }
  update = (report: VoiceReport) => { this.report = report; this.send(report); };

  invalidate = () => { this.set({ revision: this.state.revision + 1 }); this.sync(); };

  start() { if (this.stopped) { this.stopped = false; this.connect(); } }
  resume() {
    if (this.stopped) return;
    // Replace a socket that can look OPEN after iOS suspended its transport.
    clearTimeout(this.retry);
    this.release();
    this.dismissRing();
    this.set({ connected: false, states: [], online: [], busy: [], activities: {} });
    this.connect();
  }

  private connect() {
    if (this.stopped) return;
    const socket = new WebSocket(this.api.gatewayUrl());
    this.socket = socket;
    this.connecting = setTimeout(() => this.disconnected(socket), 10_000);
    socket.onopen = () => {
      if (this.socket !== socket || this.stopped) return;
      clearTimeout(this.connecting);
      try { this.api.authenticateGateway(socket); }
      catch { this.disconnected(socket); return; }
      this.set({ connected: true, states: [], revision: this.state.revision + 1 });
      this.send(this.report);
      if (this.socket !== socket) return;
      this.sync();
      const ping = () => {
        this.pong = setTimeout(() => this.disconnected(socket), 15_000);
        this.send({ t: "ping" });
      };
      ping();
      if (this.socket === socket) this.heartbeat = setInterval(ping, 25_000);
    };
    socket.onmessage = event => {
      if (this.socket !== socket) return;
      try {
        const parsed = serverEvent.safeParse(JSON.parse(String(event.data)));
        if (!parsed.success) return;
        this.attempts = 0;
        if (parsed.data.t === "pong") { clearTimeout(this.pong); this.pong = undefined; return; }
        if (parsed.data.t === "ring") {
          this.dismissRing();
          this.set({ ring: parsed.data });
          this.ringExpiry = setTimeout(() => this.dismissRing(), 30_000);
        }
        if (parsed.data.t === "ringEnd" && parsed.data.channelId === this.state.ring?.channelId) this.dismissRing();
        if (parsed.data.t === "voiceStates") this.set({ ...this.state, states: parsed.data.states });
        if (parsed.data.t === "presence") this.set({ online: parsed.data.online, busy: parsed.data.busy, activities: parsed.data.activities });
        if (parsed.data.t === "sync") this.sync();
        if (["sync", "friends", "message", "messageUpdate", "messageDelete", "channel", "userUpdate", "read"].includes(parsed.data.t)) this.set({ revision: this.state.revision + 1 });
        this.events.forEach(fn => fn(parsed.data));
      } catch { /* Malformed messages do not tear down native audio. */ }
    };
    socket.onerror = () => this.disconnected(socket);
    socket.onclose = event => this.disconnected(socket, event.code);
  }

  private disconnected(socket: WebSocket, code?: number) {
    if (this.socket !== socket) return;
    this.release();
    this.dismissRing();
    this.set({ connected: false, states: [], online: [], busy: [], activities: {} });
    if (code === 4401) { this.stop(); this.expired(); return; }
    if (!this.stopped) {
      const delay = Math.min(30_000, 1_000 * 2 ** this.attempts++) + Math.random() * 500;
      this.retry = setTimeout(() => { this.retry = undefined; this.connect(); }, delay);
    }
  }

  private release() {
    clearInterval(this.heartbeat);
    clearTimeout(this.connecting);
    clearTimeout(this.pong);
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
    this.dismissRing();
    this.set({ connected: false, states: [], online: [], busy: [], activities: {} });
  }
}
