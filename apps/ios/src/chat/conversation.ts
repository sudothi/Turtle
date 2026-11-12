import { editMessageBody, sentMessageId, sendTextBody, type Message, type ReplyPreview, type ServerEvent } from "@turtle/protocol";
import { ApiError, type Api } from "../api";
import { errorText } from "../session";
import { editDraft, emptyDraft, encodeDraft, type Draft } from "./draft";
import { replyPreview } from "./reply";

export interface PendingSend { id: string; requestId: string; content: string; draft: Draft; createdAt: string; status: "sending" | "failed" | "uncertain"; error?: string }
export interface ConversationState {
  messages: Message[]; draft: Draft; outbox: PendingSend[]; restoring: boolean;
  loading: boolean; loadingOlder: boolean; hasMore: boolean; newCount: number;
  error?: string; storageError?: string; acting?: string; actionError?: string;
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
  private accessEpoch = 0;
  private denied = false;
  private revision = 0;
  private versions = new Map<string, number>();
  private deleted = new Set<string>();
  private previews = new Map<string, { version: number; value: ReplyPreview | null }>();
  private refreshing?: Promise<void>;
  private refreshQueued = false;
  private older?: Promise<void>;
  constructor(readonly channelId: string, private readonly userId: string, private readonly api: ConversationApi, private readonly connected: () => boolean, private readonly id: () => string, private readonly changed: () => void, private readonly persist: () => Promise<void>, private readonly reject: (error: unknown) => Promise<boolean>) {}
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private set(patch: Partial<ConversationState>) { if (!this.stopped) { this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); } }
  restore(data?: ConversationDisk) { this.set({ restoring: false, ...(data ? { draft: data.draft, outbox: data.outbox.map(item => ({ ...item, status: item.status === "sending" ? "uncertain" : item.status })) } : {}) }); }
  disk = (): ConversationDisk => ({ draft: this.state.draft, outbox: this.state.outbox });
  storageError(error?: string) { this.set({ storageError: error }); }
  setDraft = (draft: Draft) => { if (!this.state.restoring) { this.set({ draft }); this.changed(); } };
  edit = (text: string) => this.setDraft(editDraft(this.state.draft, text));
  replyTo = (id: string) => {
    const message = this.state.messages.find(message => message.id === id);
    if (message && !this.denied && !this.deleted.has(id)) this.setDraft({ ...this.state.draft, reply: { id, preview: replyPreview(message) } });
  };
  cancelReply = () => { this.setDraft({ ...this.state.draft, reply: undefined }); this.set({ error: undefined }); };
  setAtLatest = (value: boolean) => { this.atLatest = value; if (value && this.state.newCount) this.set({ newCount: 0 }); };

  clearActionError = () => this.set({ actionError: undefined });
  editMessage = (id: string, content: string) => {
    if (!editMessageBody.safeParse({ content }).success) {
      this.set({ actionError: "Use de 1 a 4000 caracteres na mensagem." });
      return Promise.resolve(false);
    }
    if (this.state.messages.find(message => message.id === id)?.userId !== this.userId) return Promise.resolve(false);
    return this.mutateMessage(id, () => this.api.editMessage(id, content));
  };
  deleteMessage = (id: string) => this.mutateMessage(id, async () => { await this.api.deleteMessage(id); });
  setReaction = (id: string, emoji: string, add: boolean) => this.mutateMessage(id, () => this.api.setReaction(id, emoji, add));
  private async mutateMessage(id: string, operation: () => Promise<Message | void>) {
    if (this.stopped || this.denied || this.state.acting || !this.state.messages.some(message => message.id === id)) return false;
    if (!this.connected()) { this.set({ actionError: "Sem conexão. Tente novamente quando voltar à rede." }); return false; }
    this.set({ acting: id, actionError: undefined });
    const started = this.revision, epoch = this.accessEpoch;
    try {
      const result = await operation();
      if (this.stopped || this.denied || epoch !== this.accessEpoch) return false;
      if (result) {
        if (result.id !== id || result.channelId !== this.channelId) throw new Error("A resposta não confirmou esta alteração. Atualize a conversa.");
        if ((this.versions.get(id) ?? 0) <= started && !this.deleted.has(id)) {
          this.versions.set(id, ++this.revision);
          this.merge([result]);
        }
      } else this.receive({ t: "messageDelete", channelId: this.channelId, id });
      return true;
    } catch (error) {
      if (!this.stopped) {
        try { if (!await this.reject(error)) this.set({ actionError: errorText(error) }); }
        catch (cause) { this.set({ actionError: errorText(cause) }); }
        // A mutation can be forbidden without revoking access to the conversation.
        if (error instanceof ApiError && (error.status === 403 || error.status === 404)) void this.refresh(true);
      }
      return false;
    } finally { this.set({ acting: undefined }); }
  }

  private merge(items: Message[], started = this.revision) {
    const all = new Map(this.state.messages.map(m => [m.id, m]));
    const accepted: Message[] = [];
    let added = 0;
    for (const item of items) {
      if (item.channelId !== this.channelId || this.deleted.has(item.id) || (this.versions.get(item.id) ?? 0) > started) continue;
      const pending = this.state.outbox.find(send => send.id === item.id);
      if (pending && (item.userId !== this.userId || item.replyToId !== (pending.draft.reply?.id ?? null))) continue;
      if (!all.has(item.id) && !this.state.outbox.some(m => m.id === item.id) && (!this.state.messages.length || compareMessages(item, this.state.messages.at(-1)!) > 0)) added++;
      const live = item.replyToId ? this.previews.get(item.replyToId) : undefined;
      all.set(item.id, item.replyToId && this.deleted.has(item.replyToId) ? { ...item, replyTo: null } : live && live.version > started ? { ...item, replyTo: live.value } : item);
      accepted.push(item);
    }
    const outbox = this.state.outbox.filter(item => !all.has(item.id) && !this.deleted.has(item.id));
    const settled = outbox.length !== this.state.outbox.length;
    this.set({ messages: [...all.values()].sort(compareMessages), outbox, newCount: this.state.newCount + (this.atLatest ? 0 : added) });
    for (const item of accepted) {
      this.updateReferences(item.id, replyPreview(item));
      if (!item.replyToId || this.deleted.has(item.replyToId)) continue;
      const live = this.previews.get(item.replyToId);
      const preview = live && live.version > started ? live.value : item.replyTo;
      if (!preview) this.forgetReply(item.replyToId);
      else if (live && live.version <= started) this.updateReferences(item.replyToId, preview);
    }
    if (settled) this.changed();
  }
  private updateReferences(id: string, preview: ReplyPreview | null) {
    const live = this.previews.get(id);
    if (live) live.value = preview;
    const draft = (value: Draft): Draft => value.reply?.id === id ? { ...value, reply: { id, preview } } : value;
    const affected = this.state.draft.reply?.id === id || this.state.outbox.some(item => item.draft.reply?.id === id);
    if (!affected && !this.state.messages.some(message => message.replyToId === id)) return;
    this.set({
      messages: this.state.messages.map(message => message.replyToId === id ? { ...message, replyTo: preview } : message),
      draft: draft(this.state.draft), outbox: this.state.outbox.map(item => item.draft.reply?.id === id ? { ...item, draft: draft(item.draft) } : item),
    });
    if (affected) this.changed();
  }
  private forgetReply(id: string) {
    this.deleted.add(id); this.versions.set(id, ++this.revision);
    this.previews.set(id, { version: this.revision, value: null });
    this.updateReferences(id, null);
    this.set({ messages: this.state.messages.filter(message => message.id !== id) });
  }
  receive(event: ServerEvent) {
    if (this.stopped || this.denied) return;
    if ((event.t === "message" || event.t === "messageUpdate") && event.message.channelId === this.channelId) {
      if (this.deleted.has(event.message.id)) return;
      this.versions.set(event.message.id, ++this.revision);
      this.previews.set(event.message.id, { version: this.revision, value: replyPreview(event.message) });
      this.updateReferences(event.message.id, replyPreview(event.message));
      if (event.t === "messageUpdate" && !this.state.messages.some(m => m.id === event.message.id)) return;
      this.merge([event.message]);
      this.changed();
    } else if (event.t === "messageDelete" && event.channelId === this.channelId) {
      this.forgetReply(event.id);
      this.set({ messages: this.state.messages.filter(m => m.id !== event.id), outbox: this.state.outbox.filter(m => m.id !== event.id) });
      this.changed();
    }
  }
  private failure = async (error: unknown) => {
    if (this.stopped) return;
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
      this.denied = true; this.accessEpoch++;
      for (const id of new Set([this.state.draft.reply?.id, ...this.state.outbox.map(item => item.draft.reply?.id)])) if (id) this.updateReferences(id, null);
      this.previews.clear(); this.set({ messages: [], hasMore: false });
    }
    try { if (!await this.reject(error)) this.set({ error: errorText(error) }); }
    catch (error) { this.set({ error: errorText(error) }); }
  };
  refresh = (afterCurrent = false): Promise<void> => {
    if (this.stopped) return Promise.resolve();
    if (this.refreshing) { if (afterCurrent) this.refreshQueued = true; return this.refreshing; }
    this.set({ loading: true, error: undefined });
    const started = this.revision, epoch = this.accessEpoch, oldestKnown = this.state.messages[0];
    this.refreshing = (async () => {
      try {
        let page = await this.api.messages(this.channelId, { limit: PAGE });
        const collected = [...page];
        while (!this.stopped && epoch === this.accessEpoch && oldestKnown && page.length === PAGE && compareMessages(page[0]!, oldestKnown) > 0) {
          const cursor = page[0]!;
          page = await this.api.messages(this.channelId, { limit: PAGE, before: cursor.createdAt, beforeId: cursor.id });
          if (page[0] && compareMessages(page[0], cursor) >= 0) throw new Error("Não foi possível avançar no histórico. Atualize o servidor.");
          collected.push(...page);
        }
        if (this.stopped || epoch !== this.accessEpoch) return;
        this.denied = false;
        const cutoff = collected.sort(compareMessages)[0], present = new Set(collected.map(m => m.id));
        // The fetched window is authoritative, except events received after the request began.
        const retained = this.state.messages.filter(m => (this.versions.get(m.id) ?? 0) > started || present.has(m.id) || (page.length === PAGE && cutoff && compareMessages(m, cutoff) < 0));
        const removed = this.state.messages.filter(message => !retained.includes(message));
        this.set({ messages: retained });
        for (const message of removed) this.forgetReply(message.id);
        this.merge(collected, started);
        this.set({ hasMore: page.length === PAGE });
      } catch (error) { if (epoch === this.accessEpoch) await this.failure(error); }
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
    const started = this.revision, epoch = this.accessEpoch;
    this.older = (async () => {
      try {
        const page = await this.api.messages(this.channelId, { limit: PAGE, before: oldest.createdAt, beforeId: oldest.id });
        if (!this.stopped && epoch === this.accessEpoch) { this.merge(page, started); this.set({ hasMore: page.length === PAGE }); }
      } catch (error) { if (epoch === this.accessEpoch) await this.failure(error); }
      finally { this.set({ loadingOlder: false }); this.older = undefined; }
    })();
    return this.older;
  };
  send = async () => {
    const content = encodeDraft(this.state.draft);
    if (this.stopped || this.state.restoring || !this.connected() || !content) return;
    if (this.state.draft.reply?.preview === null) { this.set({ error: "A mensagem respondida foi apagada. Cancele a resposta para enviar seu texto." }); return; }
    const requestId = this.id();
    if (!sendTextBody.safeParse({ content, requestId, replyTo: this.state.draft.reply?.id }).success) { this.set({ error: "Use de 1 a 4000 caracteres na mensagem." }); return; }
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
    if (!item || this.state.draft.text || this.state.draft.reply) return;
    this.set({ draft: item.draft, outbox: this.state.outbox.filter(m => m.id !== id) }); this.changed();
  };
  private async deliver(item: PendingSend) {
    let recorded = false;
    const started = this.revision;
    try {
      await this.persist(); recorded = true;
      if (this.stopped) return;
      const message = await this.api.sendText(this.channelId, { requestId: item.requestId, content: item.content, ...(item.draft.reply ? { replyTo: item.draft.reply.id } : {}) });
      if (this.stopped) return;
      if (message.id !== item.id || message.channelId !== this.channelId || message.userId !== this.userId || message.replyToId !== (item.draft.reply?.id ?? null)) throw new Error("A resposta não confirmou este envio. Atualize a conversa antes de tentar novamente.");
      if (this.denied) this.set({ outbox: this.state.outbox.filter(m => m.id !== message.id) });
      else this.merge([message], started);
      this.changed();
    } catch (error) {
      if (this.stopped) return;
      if (error instanceof ApiError && error.code === "REPLY_UNAVAILABLE" && item.draft.reply) this.forgetReply(item.draft.reply.id);
      const definitive = !recorded || (error instanceof ApiError && error.status < 500 && ![408, 425, 429].includes(error.status));
      this.set({ outbox: this.state.outbox.map(m => m.id === item.id ? { ...m, status: definitive ? "failed" : "uncertain", error: recorded ? errorText(error) : "Não foi possível salvar o envio neste iPhone. Tente novamente." } : m) });
      try { await this.reject(error); } catch (error) { this.set({ error: errorText(error) }); }
      this.changed();
    }
  }
  dispose() { this.stopped = true; this.listeners.clear(); }
}

export type ConversationApi = Pick<Api, "messages" | "sendText" | "editMessage" | "deleteMessage" | "setReaction">;
