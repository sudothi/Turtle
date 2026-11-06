import { sentMessageId, sendTextBody, type Message, type ServerEvent } from "@turtle/protocol";
import { ApiError, type Api } from "../api";
import { errorText } from "../session";
import { editDraft, emptyDraft, encodeDraft, type Draft } from "./draft";

export interface PendingSend { id: string; requestId: string; content: string; draft: Draft; createdAt: string; status: "sending" | "failed" | "uncertain"; error?: string }
export interface ConversationState {
  messages: Message[]; draft: Draft; outbox: PendingSend[]; restoring: boolean;
  loading: boolean; loadingOlder: boolean; hasMore: boolean; newCount: number;
  error?: string; storageError?: string;
}
export interface ConversationDisk { draft: Draft; outbox: PendingSend[] }
export const compareMessages = (a: Pick<Message, "createdAt" | "id">, b: Pick<Message, "createdAt" | "id">) => a.createdAt === b.createdAt ? a.id < b.id ? -1 : a.id > b.id ? 1 : 0 : a.createdAt < b.createdAt ? -1 : 1;
const PAGE = 50;

/** Owns one conversation independently of its visible screen. All merges cross this seam. */
export class Conversation {
  private state: ConversationState = { messages: [], draft: emptyDraft(), outbox: [], restoring: true, loading: false, loadingOlder: false, hasMore: true, newCount: 0 };
  private listeners = new Set<() => void>();
  private stopped = false;
  private atLatest = true;
  private revision = 0;
  private versions = new Map<string, number>();
  private deleted = new Set<string>();
  private refreshing?: Promise<void>;
  private refreshQueued = false;
  private older?: Promise<void>;
  constructor(readonly channelId: string, private readonly userId: string, private readonly api: Pick<Api, "messages" | "sendText">, private readonly connected: () => boolean, private readonly id: () => string, private readonly changed: () => void, private readonly persist: () => Promise<void>, private readonly reject: (error: unknown) => Promise<boolean>) {}
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private set(patch: Partial<ConversationState>) { if (!this.stopped) { this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); } }
  restore(data?: ConversationDisk) { this.set({ restoring: false, ...(data ? { draft: data.draft, outbox: data.outbox.map(item => ({ ...item, status: item.status === "sending" ? "uncertain" : item.status })) } : {}) }); }
  disk = (): ConversationDisk => ({ draft: this.state.draft, outbox: this.state.outbox });
  storageError(error?: string) { this.set({ storageError: error }); }
  setDraft = (draft: Draft) => { if (!this.state.restoring) { this.set({ draft }); this.changed(); } };
  edit = (text: string) => this.setDraft(editDraft(this.state.draft, text));
  setAtLatest = (value: boolean) => { this.atLatest = value; if (value && this.state.newCount) this.set({ newCount: 0 }); };

  private merge(items: Message[], started = this.revision) {
    const all = new Map(this.state.messages.map(m => [m.id, m]));
    let added = 0;
    for (const item of items) {
      if (item.channelId !== this.channelId || this.deleted.has(item.id) || (this.versions.get(item.id) ?? 0) > started) continue;
      if (!all.has(item.id) && (!this.state.messages.length || compareMessages(item, this.state.messages.at(-1)!) > 0)) added++;
      all.set(item.id, item);
    }
    const outbox = this.state.outbox.filter(item => !all.has(item.id) && !this.deleted.has(item.id));
    const settled = outbox.length !== this.state.outbox.length;
    this.set({ messages: [...all.values()].sort(compareMessages), outbox, newCount: this.state.newCount + (this.atLatest ? 0 : added) });
    if (settled) this.changed();
  }
  receive(event: ServerEvent) {
    if (this.stopped) return;
    if ((event.t === "message" || event.t === "messageUpdate") && event.message.channelId === this.channelId) {
      if (event.t === "messageUpdate" && !this.state.messages.some(m => m.id === event.message.id)) return;
      this.versions.set(event.message.id, ++this.revision);
      this.merge([event.message]);
      this.changed();
    } else if (event.t === "messageDelete" && event.channelId === this.channelId) {
      this.deleted.add(event.id); this.versions.set(event.id, ++this.revision);
      this.set({ messages: this.state.messages.filter(m => m.id !== event.id), outbox: this.state.outbox.filter(m => m.id !== event.id) });
      this.changed();
    }
  }
  private failure = async (error: unknown) => {
    if (this.stopped) return;
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) this.set({ messages: [] });
    try { if (!await this.reject(error)) this.set({ error: errorText(error) }); }
    catch (error) { this.set({ error: errorText(error) }); }
  };
  refresh = (afterCurrent = false): Promise<void> => {
    if (this.stopped) return Promise.resolve();
    if (this.refreshing) { if (afterCurrent) this.refreshQueued = true; return this.refreshing; }
    this.set({ loading: true, error: undefined });
    const started = this.revision, oldestKnown = this.state.messages[0];
    this.refreshing = (async () => {
      try {
        let page = await this.api.messages(this.channelId, { limit: PAGE });
        const collected = [...page];
        while (!this.stopped && oldestKnown && page.length === PAGE && compareMessages(page[0]!, oldestKnown) > 0) {
          const cursor = page[0]!;
          page = await this.api.messages(this.channelId, { limit: PAGE, before: cursor.createdAt, beforeId: cursor.id });
          if (page[0] && compareMessages(page[0], cursor) >= 0) throw new Error("Não foi possível avançar no histórico. Atualize o servidor.");
          collected.push(...page);
        }
        if (this.stopped) return;
        const cutoff = collected.sort(compareMessages)[0], present = new Set(collected.map(m => m.id));
        // The fetched window is authoritative, except events received after the request began.
        this.set({ messages: this.state.messages.filter(m => (this.versions.get(m.id) ?? 0) > started || present.has(m.id) || (page.length === PAGE && cutoff && compareMessages(m, cutoff) < 0)) });
        this.merge(collected, started);
        this.set({ hasMore: page.length === PAGE });
      } catch (error) { await this.failure(error); }
      finally {
        this.set({ loading: false }); this.refreshing = undefined;
        if (this.refreshQueued && !this.stopped) { this.refreshQueued = false; void this.refresh(); }
      }
    })();
    return this.refreshing;
  };
  loadOlder = (): Promise<void> => {
    if (this.stopped || this.older || this.state.loading || !this.state.hasMore) return this.older ?? Promise.resolve();
    const oldest = this.state.messages[0];
    if (!oldest) return this.refresh();
    this.set({ loadingOlder: true, error: undefined });
    const started = this.revision;
    this.older = (async () => {
      try {
        const page = await this.api.messages(this.channelId, { limit: PAGE, before: oldest.createdAt, beforeId: oldest.id });
        if (!this.stopped) { this.merge(page, started); this.set({ hasMore: page.length === PAGE }); }
      } catch (error) { await this.failure(error); }
      finally { this.set({ loadingOlder: false }); this.older = undefined; }
    })();
    return this.older;
  };
  send = async () => {
    const content = encodeDraft(this.state.draft);
    if (this.stopped || this.state.restoring || !this.connected() || !content) return;
    const requestId = this.id();
    if (!sendTextBody.safeParse({ content, requestId }).success) { this.set({ error: "Use de 1 a 4000 caracteres na mensagem." }); return; }
    const item: PendingSend = { id: sentMessageId(this.userId, requestId), requestId, content, draft: this.state.draft, createdAt: new Date().toISOString(), status: "sending" };
    this.set({ draft: emptyDraft(), outbox: [...this.state.outbox, item], error: undefined });
    await this.deliver(item);
  };
  retry = async (id: string) => {
    const item = this.state.outbox.find(item => item.id === id);
    if (!item || item.status === "sending" || !this.connected() || this.stopped) return;
    this.set({ outbox: this.state.outbox.map(m => m.id === id ? { ...m, status: "sending", error: undefined } : m) });
    await this.deliver(item);
  };
  restoreDraft = (id: string) => {
    const item = this.state.outbox.find(m => m.id === id && m.status === "failed");
    if (!item || this.state.draft.text) return;
    this.set({ draft: item.draft, outbox: this.state.outbox.filter(m => m.id !== id) }); this.changed();
  };
  private async deliver(item: PendingSend) {
    let recorded = false;
    const started = this.revision;
    try {
      await this.persist(); recorded = true;
      if (this.stopped) return;
      const message = await this.api.sendText(this.channelId, { requestId: item.requestId, content: item.content });
      if (this.stopped) return;
      this.merge([message], started); this.changed();
    } catch (error) {
      if (this.stopped) return;
      const definitive = !recorded || (error instanceof ApiError && error.status < 500);
      this.set({ outbox: this.state.outbox.map(m => m.id === item.id ? { ...m, status: definitive ? "failed" : "uncertain", error: errorText(error) } : m) });
      try { await this.reject(error); } catch (error) { this.set({ error: errorText(error) }); }
      this.changed();
    }
  }
  dispose() { this.stopped = true; this.listeners.clear(); }
}
