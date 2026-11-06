import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Api } from "./api";
import { Gateway } from "./gateway";

class Socket {
  static all: Socket[] = [];
  readyState = 0;
  onopen?: (() => void) | null;
  onmessage?: ((event: { data: string }) => void) | null;
  onclose?: ((event: { code: number }) => void) | null;
  onerror?: (() => void) | null;
  send = vi.fn(); close = vi.fn(() => { this.readyState = 3; });
  constructor() { Socket.all.push(this); }
  open() { this.readyState = 1; this.onopen?.(); }
  receive(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
}
let gateway: Gateway;
beforeEach(() => { vi.useFakeTimers(); Socket.all = []; vi.stubGlobal("WebSocket", Socket); gateway = new Gateway({ gatewayUrl: () => "wss://test/ws", authenticateGateway: (socket: Socket) => socket.send(JSON.stringify({ t: "auth", token: "session" })) } as Api, vi.fn(), vi.fn()); });
afterEach(() => { gateway.stop(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it("forwards validated chat events, detaches screens and ignores replaced sockets", () => {
  const events = vi.fn(); const off = gateway.subscribeEvents(events);
  gateway.start(); const first = Socket.all[0]!; first.open();
  first.receive({ t: "messageDelete", channelId: "a", id: "m" });
  expect(events).toHaveBeenCalledWith({ t: "messageDelete", channelId: "a", id: "m" });
  first.receive({ t: "message", message: "invalid" }); expect(events).toHaveBeenCalledOnce();
  const stale = first.onmessage; gateway.resume();
  stale?.({ data: JSON.stringify({ t: "messageDelete", channelId: "a", id: "old" }) });
  expect(events).toHaveBeenCalledOnce();
  const next = Socket.all[1]!; next.open(); off(); next.receive({ t: "sync" });
  expect(events).toHaveBeenCalledOnce();
});
it("reconnection preserves the voice report independently of chat subscribers", () => {
  gateway.start(); Socket.all[0]!.open();
  const voice = { t: "voice" as const, channelId: "call", muted: true, deafened: true, camera: false, screen: false };
  gateway.update(voice); gateway.resume();
  expect(gateway.getSnapshot().connected).toBe(false);
  const next = Socket.all[1]!; next.open();
  expect(next.send).toHaveBeenCalledWith(JSON.stringify(voice));
  expect(gateway.getSnapshot().connected).toBe(true);
});

it("authenticates before reporting voice, without putting credentials in the URL", () => {
  gateway.start(); const socket = Socket.all[0]!; socket.open();
  expect(JSON.parse(socket.send.mock.calls[0]![0])).toEqual({ t: "auth", token: "session" });
  expect(JSON.parse(socket.send.mock.calls[1]![0])).toMatchObject({ t: "voice" });
});

it("replaces activities and clears them after reconnect to avoid stale presence", () => {
  gateway.start(); const socket = Socket.all[0]!; socket.open();
  socket.receive({ t: "presence", online: ["friend"], busy: [], activities: { friend: { game: "lol", phase: null, detail: null } } });
  expect(gateway.getSnapshot().activities.friend?.game).toBe("lol");
  gateway.resume();
  expect(gateway.getSnapshot().activities).toEqual({});
  const next = Socket.all[1]!; next.open(); next.receive({ t: "presence", online: [] });
  expect(gateway.getSnapshot().activities).toEqual({});
});
it("invalidates visible profiles after a userUpdate", () => {
  gateway.start(); const socket = Socket.all[0]!; socket.open();
  const before = gateway.getSnapshot().revision;
  socket.receive({ t: "userUpdate", user: { id: "friend", username: "friend", displayName: "Novo nome" } });
  expect(gateway.getSnapshot().revision).toBe(before + 1);
});

it("deduplicates incoming calls and expires them without declining automatically", async () => {
  gateway.start(); const socket = Socket.all[0]!; socket.open();
  const ring = { t: "ring", channelId: "dm", from: { id: "friend", username: "friend", displayName: null, avatar: null } };
  socket.receive(ring); socket.receive(ring);
  expect(gateway.getSnapshot().ring?.channelId).toBe("dm");
  await vi.advanceTimersByTimeAsync(30000);
  expect(gateway.getSnapshot().ring).toBeUndefined();
  expect(socket.send.mock.calls.some(([value]) => JSON.parse(value).t === "ringDecline")).toBe(false);
});
it("declines only the current call and clears call cards on reconnect", () => {
  gateway.start(); const socket = Socket.all[0]!; socket.open();
  const ring = { t: "ring", channelId: "dm", from: { id: "friend", username: "friend", displayName: null, avatar: null } };
  socket.receive(ring); gateway.dismissRing(true);
  expect(socket.send).toHaveBeenLastCalledWith(JSON.stringify({ t: "ringDecline", channelId: "dm" }));
  socket.receive(ring); socket.receive({ t: "ringEnd", channelId: "other" });
  expect(gateway.getSnapshot().ring).toBeDefined();
  gateway.resume(); expect(gateway.getSnapshot().ring).toBeUndefined();
});
