import { afterEach, describe, expect, it, vi } from "vitest";
import { messageSchema, sentMessageId, type Message, type Person } from "@turtle/protocol";
import { ApiError } from "../api";
import { ChatStore } from "./store";
import { chooseMention, decodeDraft, editDraft, emptyDraft, encodeDraft, mentionQuery } from "./draft";
import { replyPreview, replyText } from "./reply";

const uuid = "c1a1876a-fdf5-44fa-9ae2-399c691d9ccc";
const message = (n: number, patch: Partial<Message> = {}): Message => messageSchema.parse({ id: String(n).padStart(4, "0"), channelId: "a", userId: "other", username: "friend", displayName: "Amiga", avatar: null, staff: false, content: `texto ${n}`, createdAt: new Date(1_700_000_000_000 + n * 1000).toISOString(), editedAt: null, attachments: [], ...patch });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const stores: ChatStore[] = [];
afterEach(async () => { for (const store of stores.splice(0)) await store.dispose(); });
function setup(disk = new Map<string, string>(), origin = "https://chat.test", userId = "self") {
  const storage = { getItem: vi.fn(async (key: string) => disk.get(key) ?? null), setItem: vi.fn(async (key: string, value: string) => { disk.set(key, value); }), removeItem: vi.fn(async (key: string) => { disk.delete(key); }) };
  const api = {
    origin, messages: vi.fn(async (_id: string, _page?: { before?: string; beforeId?: string; limit?: number }): Promise<Message[]> => []),
    sendText: vi.fn(async (channelId: string, body: { requestId: string; content: string; replyTo?: string }) => {
      const target = store.get(channelId).getSnapshot().messages.find(message => message.id === body.replyTo);
      return message(100, { id: sentMessageId(userId, body.requestId), channelId, content: body.content, userId, replyToId: body.replyTo ?? null, replyTo: target ? replyPreview(target) : null });
    }),
    editMessage: vi.fn(async (id: string, content: string) => message(1, { id, content, userId, editedAt: new Date().toISOString() })),
    deleteMessage: vi.fn(async (_id: string) => ({ ok: true as const })),
    setReaction: vi.fn(async (id: string, emoji: string, add: boolean) => message(1, { id, reactions: add ? [{ emoji, userIds: [userId] }] : [] })),
  };
  const reject = vi.fn(async () => false);
  const id = vi.fn(() => uuid);
  const store = new ChatStore(api, { userId, storage, id }, reject);
  stores.push(store);
  return { store, api, storage, disk, reject, id };
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

describe("replies", () => {
  async function opened() {
    const result = setup(); await result.store.ready; result.store.setConnected(true);
    const c = result.store.get("a");
    result.api.messages.mockResolvedValueOnce([message(1), message(2)]); await c.refresh();
    return { ...result, c };
  }
  it("preserves text and selected mentions when choosing, editing and canceling a reply", async () => {
    const { c } = await opened();
    const person = { id: "friend", username: "amiga", displayName: "Amiga", avatar: null };
    c.setDraft(chooseMention({ text: "Oi @am", mentions: [] }, { start: 3, end: 6 }, person).draft);
    c.replyTo(message(1).id); c.edit(c.getSnapshot().draft.text + "tudo bem?");
    expect(c.getSnapshot().draft.reply?.id).toBe(message(1).id);
    expect(encodeDraft(c.getSnapshot().draft)).toBe("Oi <@friend> tudo bem?");
    c.cancelReply();
    expect(c.getSnapshot().draft.reply).toBeUndefined();
    expect(encodeDraft(c.getSnapshot().draft)).toBe("Oi <@friend> tudo bem?");
  });
  it("persists a reply-only draft and keeps it isolated from other conversations and accounts", async () => {
    const { c, store, disk } = await opened();
    c.replyTo(message(1).id); await store.flush();
    const restored = setup(disk); await restored.store.ready;
    expect(restored.store.get("a").getSnapshot().draft.reply).toEqual({ id: message(1).id, preview: replyPreview(message(1)) });
    expect(restored.store.get("b").getSnapshot().draft.reply).toBeUndefined();
    const other = setup(disk, "https://chat.test", "another-account"); await other.store.ready;
    expect(other.store.get("a").getSnapshot().draft.reply).toBeUndefined();
  });
  it("records the target before HTTP and retries the same reply even after selecting another draft target", async () => {
    const { c, api, store, storage } = await opened();
    c.replyTo(message(1).id); c.edit("resposta");
    const failed = deferred<Message>(); api.sendText.mockReturnValueOnce(failed.promise);
    const sending = c.send();
    await vi.waitFor(() => expect(api.sendText).toHaveBeenCalledOnce());
    expect(JSON.parse(storage.setItem.mock.calls.at(-1)![1]).conversations.a.outbox[0].draft.reply.id).toBe(message(1).id);
    c.replyTo(message(2).id); c.edit("próxima resposta");
    failed.reject(new TypeError("rede caiu")); await sending;
    store.setConnected(false); store.setConnected(true);
    expect(api.sendText).toHaveBeenCalledOnce();
    await c.retry(c.getSnapshot().outbox[0]!.id);
    expect(api.sendText.mock.calls[1]).toEqual(api.sendText.mock.calls[0]);
    expect(api.sendText.mock.calls[1]?.[1].replyTo).toBe(message(1).id);
    expect(c.getSnapshot().draft).toMatchObject({ text: "próxima resposta", reply: { id: message(2).id } });
  });
  it("restores an uncertain reply without automatic resend and keeps the original request identity", async () => {
    const { c, api, store, disk } = await opened();
    api.sendText.mockRejectedValueOnce(new TypeError("resposta perdida"));
    c.replyTo(message(1).id); c.edit("resposta"); await c.send(); await store.flush();
    const restored = setup(disk); await restored.store.ready; restored.store.setConnected(true);
    const next = restored.store.get("a");
    expect(restored.api.sendText).not.toHaveBeenCalled();
    expect(next.getSnapshot().outbox[0]).toMatchObject({ requestId: uuid, status: "uncertain", draft: { reply: { id: message(1).id } } });
    await next.retry(next.getSnapshot().outbox[0]!.id);
    expect(restored.api.sendText.mock.calls[0]).toEqual(api.sendText.mock.calls[0]);
  });
  it("never confirms a reply as plain text, including a mismatched gateway echo", async () => {
    const { c, api, store } = await opened();
    const response = deferred<Message>(); api.sendText.mockReturnValueOnce(response.promise);
    c.replyTo(message(1).id); c.edit("não perder a referência");
    const sending = c.send(); await vi.waitFor(() => expect(api.sendText).toHaveBeenCalledOnce());
    const wrong = message(100, { id: sentMessageId("self", uuid), userId: "self" });
    store.receive({ t: "message", message: wrong });
    expect(c.getSnapshot().outbox).toHaveLength(1);
    response.resolve(wrong); await sending;
    expect(c.getSnapshot().outbox[0]).toMatchObject({ status: "uncertain", draft: { reply: { id: message(1).id } } });
    expect(c.getSnapshot().messages.some(m => m.id === wrong.id)).toBe(false);
  });
  it("clears deleted content from loaded quotes, draft and pending disk snapshots without changing retry identity", async () => {
    const { c, api, store, disk } = await opened();
    const original = message(1, { content: "conteúdo removido" });
    const quoted = message(3, { replyToId: original.id, replyTo: replyPreview(original) });
    api.messages.mockResolvedValueOnce([original, message(2), quoted]); await c.refresh();
    api.sendText.mockRejectedValueOnce(new TypeError("rede caiu"));
    c.replyTo(original.id); c.edit("resposta"); await c.send(); c.replyTo(original.id);
    const stale = deferred<Message[]>(); api.messages.mockReturnValueOnce(stale.promise); const refreshing = c.refresh();
    store.receive({ t: "messageDelete", channelId: "a", id: original.id });
    store.receive({ t: "messageUpdate", message: original });
    stale.resolve([original, message(2), quoted]); await refreshing; await store.flush();
    expect(c.getSnapshot().messages.find(m => m.id === quoted.id)?.replyTo).toBeNull();
    expect(c.getSnapshot().draft.reply?.preview).toBeNull();
    expect(c.getSnapshot().outbox[0]?.draft.reply).toEqual({ id: original.id, preview: null });
    expect([...disk.values()].join("")).not.toContain("conteúdo removido");
    c.edit("rascunho preservado"); await c.send(); expect(api.sendText).toHaveBeenCalledOnce();
  });
  it("updates quoted content outside the loaded page and prevents a stale history response undoing it", async () => {
    const { api, store } = setup(); await store.ready;
    const c = store.get("a");
    const original = message(1), quoted = message(3, { replyToId: original.id, replyTo: replyPreview(original) });
    api.messages.mockResolvedValueOnce([quoted]); await c.refresh();
    const stale = deferred<Message[]>(); api.messages.mockReturnValueOnce(stale.promise); const refreshing = c.refresh();
    store.receive({ t: "messageUpdate", message: { ...original, content: "corrigida" } });
    stale.resolve([quoted]); await refreshing;
    expect(c.getSnapshot().messages).toHaveLength(1);
    expect(c.getSnapshot().messages[0]?.replyTo?.content).toBe("corrigida");
  });
  it("handles a missing original as a definitive failure and allows a new plain send only after canceling the quote", async () => {
    const { c, api, id } = await opened();
    api.sendText.mockRejectedValueOnce(new ApiError(400, "mensagem apagada", "REPLY_UNAVAILABLE"));
    c.replyTo(message(1).id); c.edit("não perder meu texto"); await c.send();
    const pending = c.getSnapshot().outbox[0]!;
    expect(pending).toMatchObject({ status: "failed", draft: { reply: { id: message(1).id, preview: null } } });
    c.restoreDraft(pending.id);
    expect(c.getSnapshot().draft.text).toBe("não perder meu texto");
    await c.send(); expect(api.sendText).toHaveBeenCalledOnce();
    c.cancelReply(); id.mockReturnValueOnce("a1a1876a-fdf5-44fa-9ae2-399c691d9ccc"); await c.send();
    expect(api.sendText.mock.calls[1]?.[1]).not.toHaveProperty("replyTo");
    expect(api.sendText.mock.calls[1]?.[1].requestId).not.toBe(pending.requestId);
  });
  it("keeps a newer HTTP quote after a live edit when a previous older-page request finishes last", async () => {
    const { store, api } = setup(); await store.ready;
    const c = store.get("a"), original = message(1);
    const quoted = message(51, { replyToId: original.id, replyTo: replyPreview(original) });
    const page = [...Array.from({ length: 49 }, (_, i) => message(i + 2)), quoted];
    api.messages.mockResolvedValueOnce(page); await c.refresh();
    const older = deferred<Message[]>(); api.messages.mockReturnValueOnce(older.promise); const loading = c.loadOlder();
    store.receive({ t: "messageUpdate", message: { ...original, content: "edição ao vivo" } });
    const current = { ...replyPreview(original), content: "edição mais recente no histórico" };
    api.messages.mockResolvedValueOnce([...page.slice(0, -1), { ...quoted, replyTo: current }]); await c.refresh();
    older.resolve([message(0, { replyToId: original.id, replyTo: replyPreview(original) })]); await loading;
    expect(c.getSnapshot().messages.find(m => m.id === message(0).id)?.replyTo?.content).toBe(current.content);
    expect(c.getSnapshot().messages.find(m => m.id === quoted.id)?.replyTo?.content).toBe(current.content);
  });
  it("clears a restored quote when the original was deleted offline outside the loaded page", async () => {
    const { store, api } = setup(); await store.ready;
    const c = store.get("a"), original = message(1);
    c.setDraft({ text: "meu texto", mentions: [], reply: { id: original.id, preview: replyPreview(original) } });
    api.messages.mockResolvedValueOnce([message(3, { replyToId: original.id, replyTo: null })]); await c.refresh();
    expect(c.getSnapshot().draft).toMatchObject({ text: "meu texto", reply: { preview: null } });
  });
  it("removes a quote snapshot when refresh detects deletion or access is revoked", async () => {
    const { c, api } = await opened();
    c.replyTo(message(1).id); c.edit("rascunho");
    api.messages.mockResolvedValueOnce([message(2)]); await c.refresh();
    expect(c.getSnapshot().draft.reply?.preview).toBeNull();
    c.replyTo(message(2).id);
    api.messages.mockRejectedValueOnce(new ApiError(403, "sem acesso")); await c.refresh();
    expect(c.getSnapshot().draft).toMatchObject({ text: "rascunho", reply: { preview: null } });
  });
  it("renders names in quote mentions and an attachment summary when the original has no text", () => {
    const preview = replyPreview(message(1, { content: "Oi <@person>" }));
    expect(replyText(preview, new Map([["person", "João"]]))).toBe("Oi @João");
    expect(replyText({ ...preview, content: "", attachments: 2 }, new Map())).toBe("2 anexos");
    expect(replyPreview(message(1, { content: "x".repeat(500) })).content).toHaveLength(200);
  });
});

describe("selected mentions", () => {
  const person = { id: "person-id", username: "joao", displayName: "João Pessoa", avatar: null } satisfies Person;
  it("edits display names without losing the original mention identities or plain typed names", () => {
    const content = "Oi <@first> e <@second>, @Alex";
    const draft = decodeDraft(content, new Map([["first", "Alex"], ["second", "Alex"]]));
    expect(draft.text).toBe("Oi @Alex e @Alex, @Alex");
    expect(encodeDraft(draft)).toBe(content);
    expect(encodeDraft(editDraft(draft, draft.text + "!"))).toBe(content + "!");
    expect(encodeDraft(decodeDraft("Oi <@unknown>", new Map()))).toBe("Oi <@unknown>");
  });
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

describe("message actions", () => {
  async function opened() {
    const result = setup(); await result.store.ready; result.store.setConnected(true);
    const conversation = result.store.get("a");
    result.api.messages.mockResolvedValueOnce([message(1, { userId: "self" }), message(2)]);
    await conversation.refresh();
    return { ...result, conversation };
  }
  it("edits only the author's valid text, preserves an unrelated draft and works without a WS echo", async () => {
    const { api, conversation: c } = await opened();
    c.edit("outro rascunho");
    expect(await c.editMessage(message(2).id, "outra pessoa")).toBe(false);
    expect(await c.editMessage(message(1).id, " ")).toBe(false);
    expect(await c.editMessage(message(1).id, "x".repeat(4001))).toBe(false);
    expect(api.editMessage).not.toHaveBeenCalled();
    expect(await c.editMessage(message(1).id, "editada")).toBe(true);
    expect(c.getSnapshot().messages[0]).toMatchObject({ content: "editada", editedAt: expect.any(String) });
    expect(c.getSnapshot().draft.text).toBe("outro rascunho");
  });
  it("does not overwrite a live edit/reaction or resurrect a deleted message with late HTTP", async () => {
    const { api, store, conversation: c } = await opened();
    const response = deferred<Message>(); api.editMessage.mockReturnValueOnce(response.promise);
    const editing = c.editMessage(message(1).id, "minha edição");
    store.receive({ t: "messageUpdate", message: message(1, { userId: "self", content: "mais recente", reactions: [{ emoji: "🔥", userIds: ["other"] }] }) });
    response.resolve(message(1, { userId: "self", content: "minha edição" })); await editing;
    expect(c.getSnapshot().messages[0]).toMatchObject({ content: "mais recente", reactions: [{ emoji: "🔥", userIds: ["other"] }] });
    const reaction = deferred<Message>(); api.setReaction.mockReturnValueOnce(reaction.promise);
    const reacting = c.setReaction(message(2).id, "👍", true);
    store.receive({ t: "messageDelete", channelId: "a", id: message(2).id });
    reaction.resolve(message(2)); await reacting;
    expect(c.getSnapshot().messages).toHaveLength(1);
  });
  it("preserves a confirmed mutation when a previously started history request returns", async () => {
    const { api, conversation: c } = await opened();
    const history = deferred<Message[]>(); api.messages.mockReturnValueOnce(history.promise);
    const refreshing = c.refresh();
    await c.editMessage(message(1).id, "editada");
    history.resolve([message(1, { userId: "self" }), message(2)]); await refreshing;
    expect(c.getSnapshot().messages[0]?.content).toBe("editada");
  });
  it("adds/removes reactions and confirms deletion without requiring a gateway event", async () => {
    const { api, conversation: c } = await opened();
    await c.setReaction(message(2).id, "👍", true);
    expect(c.getSnapshot().messages[1]?.reactions).toEqual([{ emoji: "👍", userIds: ["self"] }]);
    await c.setReaction(message(2).id, "👍", false);
    expect(c.getSnapshot().messages[1]?.reactions).toEqual([]);
    await c.deleteMessage(message(1).id);
    api.messages.mockResolvedValueOnce([message(1), message(2)]); await c.refresh();
    expect(c.getSnapshot().messages.map(m => m.id)).toEqual([message(2).id]);
  });
  it("prevents duplicate actions and retains content and draft when a mutation fails", async () => {
    const { api, conversation: c } = await opened();
    c.edit("rascunho");
    const failed = deferred<Message>(); api.editMessage.mockReturnValueOnce(failed.promise);
    const editing = c.editMessage(message(1).id, "editar");
    expect(await c.editMessage(message(1).id, "duplicar")).toBe(false);
    expect(api.editMessage).toHaveBeenCalledOnce();
    failed.reject(new Error("rede caiu")); expect(await editing).toBe(false);
    expect(c.getSnapshot()).toMatchObject({ draft: { text: "rascunho" }, actionError: "rede caiu", acting: undefined });
    expect(c.getSnapshot().messages[0]?.content).toBe("texto 1");
  });
  it("does not clear history for a moderator permission error and does not act offline", async () => {
    const { api, store, conversation: c } = await opened();
    const messages = c.getSnapshot().messages;
    api.messages.mockResolvedValue(messages);
    api.deleteMessage.mockRejectedValueOnce(new ApiError(403, "sem permissão"));
    expect(await c.deleteMessage(message(2).id)).toBe(false);
    expect(c.getSnapshot().messages).toEqual(messages);
    store.setConnected(false);
    expect(await c.setReaction(message(2).id, "👍", true)).toBe(false);
    expect(api.setReaction).not.toHaveBeenCalled();
  });
  it("does not restore content after access is revoked during a mutation", async () => {
    const { api, conversation: c } = await opened();
    const response = deferred<Message>(); api.editMessage.mockReturnValueOnce(response.promise);
    const editing = c.editMessage(message(1).id, "privado");
    api.messages.mockRejectedValueOnce(new ApiError(403, "sem acesso")); await c.refresh();
    response.resolve(message(1, { userId: "self", content: "privado" }));
    expect(await editing).toBe(false);
    expect(c.getSnapshot().messages).toEqual([]);
  });
});
