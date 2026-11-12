import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError, type Api } from "./api";
import { messageSchema, sentMessageId } from "@turtle/protocol";
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
beforeEach(() => { vi.useFakeTimers(); Socket.all = []; vi.stubGlobal("WebSocket", Socket); gateway = new Gateway({ gatewayUrl: () => "wss://test/ws", authenticateGateway: (socket: Socket) => socket.send(JSON.stringify({ t: "auth", token: "session" })) } as Api, vi.fn(), vi.fn(), "self"); });
afterEach(() => { gateway.stop(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it("replaces a transport that remains connecting instead of waiting forever", async () => {
  vi.spyOn(Math, "random").mockReturnValue(0);
  gateway.start(); const first = Socket.all[0]!;
  await vi.advanceTimersByTimeAsync(10000);
  expect(first.close).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1000);
  expect(Socket.all).toHaveLength(2);
  vi.restoreAllMocks();
});
it("recovers a half-open socket whose send succeeds but server pong never arrives", async () => {
  vi.spyOn(Math, "random").mockReturnValue(0);
  gateway.start(); const first = Socket.all[0]!; first.open();
  gateway.update({ t: "voice", channelId: "call", muted: true, deafened: false, camera: false, screen: false });
  await vi.advanceTimersByTimeAsync(15000);
  expect(gateway.getSnapshot().connected).toBe(false);
  await vi.advanceTimersByTimeAsync(1000);
  const replacement = Socket.all[1]!; replacement.open();
  expect(replacement.send).toHaveBeenCalledWith(expect.stringContaining('"channelId":"call"'));
  vi.restoreAllMocks();
});
it("keeps an acknowledged socket and does not replace it when the previous pong deadline passes", async () => {
  gateway.start(); const socket = Socket.all[0]!; socket.open(); socket.receive({ t: "pong" });
  await vi.advanceTimersByTimeAsync(25000);
  socket.receive({ t: "pong" });
  await vi.advanceTimersByTimeAsync(14999);
  expect(Socket.all).toHaveLength(1);
  expect(gateway.getSnapshot().connected).toBe(true);
});
it("resets backoff only after a valid authenticated server message", async () => {
  vi.spyOn(Math, "random").mockReturnValue(0);
  gateway.start(); const first = Socket.all[0]!; first.open(); first.onerror?.();
  await vi.advanceTimersByTimeAsync(1000);
  const second = Socket.all[1]!; second.open(); second.onerror?.();
  await vi.advanceTimersByTimeAsync(1000); expect(Socket.all).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1000); expect(Socket.all).toHaveLength(3);
  const third = Socket.all[2]!; third.open(); third.receive({ t: "pong" }); third.onerror?.();
  await vi.advanceTimersByTimeAsync(1000); expect(Socket.all).toHaveLength(4);
  vi.restoreAllMocks();
});
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

const nonce = "c1a1876a-fdf5-44fa-9ae2-399c691d9ccc";
const confirmedMessage = () => messageSchema.parse({ id: sentMessageId("self", nonce), channelId: "a", userId: "self", username: "self", content: "texto", createdAt: new Date().toISOString(), attachments: [] });
const sending = () => { gateway.start(); const socket = Socket.all[0]!; socket.open(); socket.receive({ t: "pong", confirmedText: true }); return socket; };
it("sends a durable nonce and reply over WS only after negotiation, then settles the exact acknowledgement", async () => {
  const socket = sending();
  const promise = gateway.sendText("a", { requestId: nonce, content: "texto", replyTo: "original" });
  expect(socket.send).toHaveBeenLastCalledWith(JSON.stringify({ t: "sendConfirmed", channelId: "a", nonce, content: "texto", replyTo: "original" }));
  const message = { ...confirmedMessage(), replyToId: "original" };
  socket.receive({ t: "message", message, nonce: "other" });
  socket.receive({ t: "message", message: { ...message, channelId: "other" }, nonce });
  socket.receive({ t: "message", message: { ...message, userId: "other", id: sentMessageId("other", nonce) }, nonce });
  const settled = vi.fn(); void promise.then(settled);
  await Promise.resolve(); expect(settled).not.toHaveBeenCalled();
  socket.receive({ t: "message", message, nonce });
  expect(await promise).toMatchObject(message);
});
it("preserves structured rejection codes and leaves no timeout after confirmation", async () => {
  const socket = sending();
  const promise = gateway.sendText("a", { requestId: nonce, content: "texto" });
  const rejection = expect(promise).rejects.toMatchObject({ status: 400, code: "REPLY_UNAVAILABLE" });
  socket.receive({ t: "error", nonce, status: 400, code: "REPLY_UNAVAILABLE", error: "apagada" });
  await rejection;
  const next = gateway.sendText("a", { requestId: nonce, content: "texto" });
  const closed = expect(next).rejects.toThrow();
  gateway.stop(); await closed;
});
it("rejects unacknowledged sends on timeout and never switches an in-flight send to HTTP", async () => {
  sending();
  const promise = gateway.sendText("a", { requestId: nonce, content: "texto" });
  const rejection = expect(promise).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(15_000);
  await rejection;
});
it("drops pending transports on resume and ignores an acknowledgement from the replaced socket", async () => {
  const socket = sending(), stale = socket.onmessage;
  const promise = gateway.sendText("a", { requestId: nonce, content: "texto" });
  const rejection = expect(promise).rejects.toThrow("Conexão interrompida");
  gateway.resume(); await rejection;
  const next = Socket.all[1]!; next.open(); next.receive({ t: "pong", confirmedText: true });
  const retry = gateway.sendText("a", { requestId: nonce, content: "texto" });
  const done = vi.fn(); void retry.then(done);
  stale?.({ data: JSON.stringify({ t: "message", message: confirmedMessage(), nonce }) });
  await Promise.resolve(); expect(done).not.toHaveBeenCalled();
  next.receive({ t: "message", message: confirmedMessage(), nonce }); await retry;
});
it("uses HTTP on legacy servers and clears the negotiated capability when reconnecting", async () => {
  gateway.stop();
  const sendText = vi.fn(async () => confirmedMessage());
  gateway = new Gateway({ gatewayUrl: () => "wss://test/ws", authenticateGateway: () => {}, sendText } as unknown as Api, vi.fn(), vi.fn(), "self");
  const socket = sending();
  gateway.resume(); const next = Socket.all[1]!; next.open(); next.receive({ t: "pong" });
  await gateway.sendText("a", { requestId: nonce, content: "texto" });
  expect(sendText).toHaveBeenCalledOnce();
  expect(socket.send.mock.calls.some(([value]) => JSON.parse(value).t === "sendConfirmed")).toBe(false);
});
it("shares concurrent identical requests and rejects a reused identity with changed content", async () => {
  const socket = sending();
  const first = gateway.sendText("a", { requestId: nonce, content: "texto" });
  expect(gateway.sendText("a", { requestId: nonce, content: "texto" })).toBe(first);
  await expect(gateway.sendText("a", { requestId: nonce, content: "outro" })).rejects.toBeInstanceOf(ApiError);
  socket.receive({ t: "message", message: confirmedMessage(), nonce }); await first;
});
