import { afterEach, describe, expect, it, vi } from "vitest";
import { messageSchema, sentMessageId, type Message, type Person } from "@turtle/protocol";
import { ApiError } from "../api";
import { ChatStore } from "./store";
import { chooseMention, editDraft, emptyDraft, encodeDraft, mentionQuery } from "./draft";

const uuid = "c1a1876a-fdf5-44fa-9ae2-399c691d9ccc";
const message = (n: number, patch: Partial<Message> = {}): Message => messageSchema.parse({ id: String(n).padStart(4, "0"), channelId: "a", userId: "other", username: "friend", displayName: "Amiga", avatar: null, staff: false, content: `texto ${n}`, createdAt: new Date(1_700_000_000_000 + n * 1000).toISOString(), editedAt: null, attachments: [], ...patch });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const stores: ChatStore[] = [];
afterEach(async () => { for (const store of stores.splice(0)) await store.dispose(); });
function setup(disk = new Map<string, string>(), origin = "https://chat.test", userId = "self") {
  const storage = { getItem: vi.fn(async (key: string) => disk.get(key) ?? null), setItem: vi.fn(async (key: string, value: string) => { disk.set(key, value); }), removeItem: vi.fn(async (key: string) => { disk.delete(key); }) };
  const api = { origin, messages: vi.fn(async (_id: string, _page?: { before?: string; beforeId?: string; limit?: number }): Promise<Message[]> => []), sendText: vi.fn(async (channelId: string, body: { requestId: string; content: string }) => message(100, { id: sentMessageId(userId, body.requestId), channelId, content: body.content, userId })) };
  const reject = vi.fn(async () => false);
  const store = new ChatStore(api, { userId, storage, id: () => uuid }, reject);
  stores.push(store);
  return { store, api, storage, disk, reject };
}

describe("conversation state", () => {
  it("isolates conversation drafts, persists them and restores without sending", async () => {
    const first = setup(); await first.store.ready;
    first.store.get("a").edit("rascunho A"); first.store.get("b").edit("rascunho B");
    await first.store.flush();
    const next = setup(first.disk); await next.store.ready;
    expect(next.store.get("a").getSnapshot().draft.text).toBe("rascunho A");
    expect(next.store.get("b").getSnapshot().draft.text).toBe("rascunho B");
    const otherAccount = setup(first.disk, "https://chat.test", "someone"); await otherAccount.store.ready;
    expect(otherAccount.store.get("a").getSnapshot().draft.text).toBe("");
    const otherOrigin = setup(first.disk, "https://else.test"); await otherOrigin.store.ready;
    expect(otherOrigin.store.get("a").getSnapshot().draft.text).toBe("");
    expect(next.api.sendText).not.toHaveBeenCalled();
  });
  it("records text before sending, merges WS/HTTP once and keeps a newer draft", async () => {
    const { store, api, storage } = setup(); await store.ready; store.setConnected(true);
    const c = store.get("a"), pending = deferred<Message>();
    api.sendText.mockReturnValueOnce(pending.promise);
    c.edit("primeira"); const sending = c.send();
    await vi.waitFor(() => expect(api.sendText).toHaveBeenCalledOnce());
    expect(JSON.parse(storage.setItem.mock.calls.at(-1)![1]).conversations.a.outbox[0].content).toBe("primeira");
    c.edit("segunda");
    const saved = message(100, { id: sentMessageId("self", uuid), content: "primeira", userId: "self" });
    store.receive({ t: "message", message: saved });
    pending.resolve(saved); await sending;
    expect(c.getSnapshot().messages).toEqual([saved]); expect(c.getSnapshot().outbox).toEqual([]);
    expect(c.getSnapshot().draft.text).toBe("segunda");
  });
  it("keeps ambiguous failures and retries the same identity only on request", async () => {
    const { store, api } = setup(); await store.ready; store.setConnected(true);
    const c = store.get("a"); c.edit("não perder");
    api.sendText.mockRejectedValueOnce(new TypeError("rede caiu"));
    await c.send();
    expect(c.getSnapshot().outbox[0]).toMatchObject({ content: "não perder", status: "uncertain" });
    store.setConnected(false); store.setConnected(true);
    expect(api.sendText).toHaveBeenCalledOnce();
    await c.retry(c.getSnapshot().outbox[0]!.id);
    expect(api.sendText.mock.calls[0]).toEqual(api.sendText.mock.calls[1]);
    expect(c.getSnapshot().outbox).toHaveLength(0);
  });
  it("does not send offline, duplicate retries, or lose text on storage failure", async () => {
    const { store, api, storage } = setup(); await store.ready;
    const c = store.get("a"); c.edit("aqui"); await c.send();
    expect(c.getSnapshot().draft.text).toBe("aqui"); expect(api.sendText).not.toHaveBeenCalled();
    store.setConnected(true); storage.setItem.mockRejectedValueOnce(new Error("disco cheio"));
    await c.send();
    expect(api.sendText).not.toHaveBeenCalled(); expect(c.getSnapshot().outbox[0]?.status).toBe("failed");
    const wait = deferred<Message>(); api.sendText.mockReturnValueOnce(wait.promise);
    const id = c.getSnapshot().outbox[0]!.id;
    const first = c.retry(id); await c.retry(id);
    await vi.waitFor(() => expect(api.sendText).toHaveBeenCalledOnce());
    wait.resolve(message(100, { id, userId: "self" })); await first;
  });
  it("restores a recorded in-flight send as uncertain without auto retry", async () => {
    const { store, disk } = setup(); await store.ready; store.setConnected(true);
    const c = store.get("a");
    c.restore({ draft: emptyDraft(), outbox: [{ id: sentMessageId("self", uuid), requestId: uuid, content: "pendente", draft: { text: "pendente", mentions: [] }, createdAt: new Date().toISOString(), status: "sending" }] });
    await store.flush(); const next = setup(disk); await next.store.ready; next.store.setConnected(true);
    expect(next.store.get("a").getSnapshot().outbox[0]?.status).toBe("uncertain");
    expect(next.api.sendText).not.toHaveBeenCalled();
  });
  it("only confirms the exact sender, conversation and send identity", async () => {
    const { store, api } = setup(); await store.ready; store.setConnected(true);
    const c = store.get("a"); c.edit("não confirmar outro envio");
    api.sendText.mockResolvedValueOnce(message(100));
    await c.send();
    expect(c.getSnapshot().outbox[0]?.status).toBe("uncertain");
    expect(c.getSnapshot().messages).toEqual([]);
  });
  it("catches up more than a page, keeps old history and counts new messages", async () => {
    const { store, api } = setup(); await store.ready;
    const c = store.get("a"); api.messages.mockResolvedValueOnce([message(1), message(2)]); await c.refresh();
    c.setAtLatest(false);
    api.messages.mockResolvedValueOnce(Array.from({ length: 50 }, (_, i) => message(81 + i)))
      .mockResolvedValueOnce(Array.from({ length: 50 }, (_, i) => message(31 + i)))
      .mockResolvedValueOnce(Array.from({ length: 30 }, (_, i) => message(1 + i)));
    await c.refresh();
    expect(c.getSnapshot().messages).toHaveLength(130); expect(c.getSnapshot().newCount).toBe(128);
    expect(api.messages.mock.calls[2]![1]).toMatchObject({ before: message(81).createdAt, beforeId: message(81).id });
    c.setAtLatest(true); expect(c.getSnapshot().newCount).toBe(0);
  });
  it("deduplicates older pages and never overwrites live edits/deletes with stale HTTP", async () => {
    const { store, api } = setup(); await store.ready;
    const c = store.get("a"); api.messages.mockResolvedValueOnce([message(1), message(2)]); await c.refresh();
    const http = deferred<Message[]>(); api.messages.mockReturnValueOnce(http.promise);
    const refresh = c.refresh();
    store.receive({ t: "messageUpdate", message: message(1, { content: "editada" }) });
    store.receive({ t: "messageDelete", channelId: "a", id: message(2).id });
    http.resolve([message(1), message(2)]); await refresh;
    expect(c.getSnapshot().messages.map(m => m.content)).toEqual(["editada"]);
    api.messages.mockResolvedValueOnce(Array.from({ length: 50 }, (_, i) => message(i + 3)));
    await c.refresh(); api.messages.mockResolvedValueOnce([message(1), message(2), message(3)]);
    await c.loadOlder();
    expect(c.getSnapshot().messages.filter(m => m.id === message(3).id)).toHaveLength(1);
    expect(c.getSnapshot().messages.some(m => m.id === message(2).id)).toBe(false);
  });
  it("removes offline deletions and ignores late replies after disposal", async () => {
    const { store, api } = setup(); await store.ready;
    const a = store.get("a"), b = store.get("b");
    api.messages.mockResolvedValueOnce([message(1), message(2)]); await a.refresh();
    api.messages.mockResolvedValueOnce([message(2)]); await a.refresh();
    expect(a.getSnapshot().messages).toEqual([message(2)]);
    const pending = deferred<Message[]>(); api.messages.mockReturnValueOnce(pending.promise);
    const load = a.refresh(); a.dispose(); pending.resolve([message(3)]); await load;
    expect(a.getSnapshot().messages).toEqual([message(2)]); expect(b.getSnapshot().messages).toEqual([]);
  });
  it("revoked access clears messages and a definitive error can restore the draft", async () => {
    const { store, api } = setup(); await store.ready; store.setConnected(true);
    const c = store.get("a"); api.messages.mockResolvedValueOnce([message(1)]); await c.refresh();
    api.messages.mockRejectedValueOnce(new ApiError(404, "sem acesso")); await c.refresh();
    expect(c.getSnapshot().messages).toEqual([]);
    c.edit("texto guardado"); api.sendText.mockRejectedValueOnce(new ApiError(403, "bloqueado")); await c.send();
    c.restoreDraft(c.getSnapshot().outbox[0]!.id);
    expect(c.getSnapshot().draft.text).toBe("texto guardado");
  });
  it("never restores revoked history from an older page or a delayed socket event", async () => {
    const { store, api } = setup(); await store.ready;
    const c = store.get("a"); api.messages.mockResolvedValueOnce(Array.from({ length: 50 }, (_, i) => message(i + 10))); await c.refresh();
    const old = deferred<Message[]>(); api.messages.mockReturnValueOnce(old.promise);
    const loading = c.loadOlder();
    api.messages.mockRejectedValueOnce(new ApiError(403, "sem acesso")); await c.refresh();
    old.resolve([message(1)]); await loading;
    store.receive({ t: "message", message: message(60) });
    expect(c.getSnapshot().messages).toEqual([]);
    api.messages.mockResolvedValueOnce([message(61)]); await c.refresh();
    expect(c.getSnapshot().messages).toEqual([message(61)]);
  });
  it("limits encoded text and clears storage on logout", async () => {
    const { store, api, disk } = setup(); await store.ready; store.setConnected(true);
    const c = store.get("a"); c.edit("x".repeat(4001)); await c.send();
    expect(api.sendText).not.toHaveBeenCalled(); expect(c.getSnapshot().draft.text).toHaveLength(4001);
    c.edit("x".repeat(4000)); await c.send(); expect(api.sendText).toHaveBeenCalledOnce();
    await store.flush(); expect(disk.size).toBe(1);
    await store.dispose(true); expect(disk.size).toBe(0);
  });
  it("retries history recovery after a reconnect races an older request", async () => {
    const { store, api } = setup(); await store.ready;
    const pending = deferred<Message[]>(); api.messages.mockReturnValueOnce(pending.promise).mockResolvedValueOnce([message(2)]);
    const off = store.activate("a");
    await vi.waitFor(() => expect(api.messages).toHaveBeenCalledOnce());
    store.setConnected(true); await Promise.resolve();
    pending.reject(new TypeError("old connection"));
    await vi.waitFor(() => expect(store.get("a").getSnapshot().messages).toEqual([message(2)]));
    expect(api.messages).toHaveBeenCalledTimes(2); off();
  });
  it("does not rewrite drafts when normal disposal races logout cleanup", async () => {
    const { store, storage, disk } = setup(); await store.ready;
    store.get("a").edit("privado");
    const write = deferred<void>(); storage.setItem.mockImplementationOnce(async (key, value) => { await write.promise; disk.set(key, value); });
    const disposing = store.dispose(); await Promise.resolve();
    const logout = store.dispose(true); write.resolve(); await Promise.all([disposing, logout]);
    expect(disk.size).toBe(0);
  });
});

describe("selected mentions", () => {
  const person = { id: "person-id", username: "joao", displayName: "João Pessoa", avatar: null } satisfies Person;
  it("inserts display names by touch while retaining the selected identity", () => {
    const draft = { text: "Oi @jo!", mentions: [] };
    const range = mentionQuery(draft.text, 6)!;
    const picked = chooseMention(draft, range, person);
    expect(picked.draft.text).toBe("Oi @João Pessoa !");
    expect(encodeDraft(picked.draft)).toBe("Oi <@person-id> !");
    expect(encodeDraft(editDraft(picked.draft, "Antes " + picked.draft.text))).toBe("Antes Oi <@person-id> !");
  });
  it("does not infer mentions from typed names and drops bindings when edited", () => {
    expect(encodeDraft({ text: "@João Pessoa", mentions: [] })).toBe("@João Pessoa");
    const selected = chooseMention({ text: "@jo", mentions: [] }, { start: 0, end: 3 }, person).draft;
    expect(encodeDraft(editDraft(selected, selected.text.replace("João", "José")))).toBe("@José Pessoa");
    expect(mentionQuery("mail@jo", 7)).toBeUndefined();
  });
  it("never assigns a repeated display name to the wrong selected person after deletion", () => {
    const draft = { text: "@Alex @Alex ", mentions: [{ start: 0, end: 5, userId: "first", label: "@Alex" }, { start: 6, end: 11, userId: "second", label: "@Alex" }] };
    expect(encodeDraft(editDraft(draft, "@Alex "))).toBe("@Alex");
  });
});
