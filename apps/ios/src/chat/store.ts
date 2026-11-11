import { z } from "zod";
import type { ServerEvent } from "@turtle/protocol";
import type { Api } from "../api";
import { Conversation, type ConversationApi, type ConversationDisk } from "./conversation";

export interface ChatStorage { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<unknown>; removeItem(key: string): Promise<unknown> }
export interface ChatOptions { userId: string; storage: ChatStorage; id: () => string }
const draftSchema = z.object({ text: z.string(), mentions: z.array(z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), userId: z.string(), label: z.string() })) });
const savedSchema = z.object({ version: z.literal(1), conversations: z.record(z.object({
  draft: draftSchema,
  outbox: z.array(z.object({ id: z.string(), requestId: z.string().uuid(), content: z.string().max(4000), draft: draftSchema, createdAt: z.string(), status: z.enum(["sending", "failed", "uncertain"]), error: z.string().optional() })),
})) });

/** Account-scoped history/draft owner. Reconnection never automatically resends messages. */
export class ChatStore {
  readonly ready: Promise<void>;
  private conversations = new Map<string, Conversation>();
  private restored = false;
  private stopped = false;
  private online = false;
  private write: Promise<unknown> = Promise.resolve();
  private saveTimer?: ReturnType<typeof setTimeout>;
  private active = new Set<string>();
  private readonly key: string;
  constructor(private readonly api: ConversationApi & Pick<Api, "origin">, private readonly options: ChatOptions, private readonly reject: (error: unknown) => Promise<boolean>) {
    this.key = `turtle.chat.v1:${encodeURIComponent(api.origin)}:${options.userId}`;
    this.ready = this.restore();
  }
  get = (id: string): Conversation => {
    let conversation = this.conversations.get(id);
    if (!conversation) {
      conversation = new Conversation(id, this.options.userId, this.api, () => this.online, this.options.id, this.schedule, this.flush, this.reject);
      this.conversations.set(id, conversation);
      if (this.restored) conversation.restore();
    }
    return conversation;
  };
  private async restore() {
    try {
      const raw = await this.options.storage.getItem(this.key);
      if (this.stopped) return;
      const data = raw ? savedSchema.parse(JSON.parse(raw)).conversations : {};
      this.restored = true;
      for (const [id, saved] of Object.entries(data)) this.get(id).restore(saved as ConversationDisk);
    } catch {
      if (!this.stopped) for (const conversation of this.conversations.values()) conversation.storageError("Não foi possível restaurar os rascunhos neste iPhone.");
    } finally {
      if (!this.stopped) { this.restored = true; for (const conversation of this.conversations.values()) if (conversation.getSnapshot().restoring) conversation.restore(); }
    }
  }
  activate(id: string) {
    this.active.add(id);
    void this.ready.then(() => { if (!this.stopped && this.active.has(id)) void this.get(id).refresh(); });
    return () => { this.active.delete(id); };
  }
  setConnected = (value: boolean) => {
    const reconnected = value && !this.online;
    this.online = value;
    if (reconnected) void this.ready.then(() => { if (!this.stopped) for (const id of this.active) void this.get(id).refresh(true); });
  };
  receive = (event: ServerEvent) => {
    if (event.t === "message" || event.t === "messageUpdate") this.conversations.get(event.message.channelId)?.receive(event);
    else if (event.t === "messageDelete") this.conversations.get(event.channelId)?.receive(event);
    else if (event.t === "sync") for (const id of this.active) void this.get(id).refresh(true);
  };
  private schedule = () => { clearTimeout(this.saveTimer); if (!this.stopped) this.saveTimer = setTimeout(() => { void this.flush().catch(() => {}); }, 200); };
  flush = async () => {
    clearTimeout(this.saveTimer);
    if (this.stopped) return;
    await this.ready;
    if (this.stopped) return;
    const conversations = Object.fromEntries([...this.conversations].map(([id, c]) => [id, c.disk()]).filter(([, data]) => (data as ConversationDisk).draft.text || (data as ConversationDisk).outbox.length));
    const snapshot = JSON.stringify({ version: 1, conversations });
    this.write = this.write.catch(() => {}).then(() => this.options.storage.setItem(this.key, snapshot));
    try { await this.write; for (const c of this.conversations.values()) c.storageError(); }
    catch (error) { for (const c of this.conversations.values()) c.storageError("Não foi possível salvar o rascunho neste iPhone. Seu texto continua nesta sessão."); throw error; }
  };
  async dispose(clear = false) {
    await this.ready;
    if (!this.stopped) {
      this.stopped = true; clearTimeout(this.saveTimer);
      for (const c of this.conversations.values()) c.dispose();
      if (!clear) {
        const snapshot = JSON.stringify({ version: 1, conversations: Object.fromEntries([...this.conversations].map(([id, c]) => [id, c.disk()])) });
        this.write = this.write.catch(() => {}).then(() => this.options.storage.setItem(this.key, snapshot));
        await this.write.catch(() => {});
      }
    }
    if (clear) { await this.write.catch(() => {}); await this.options.storage.removeItem(this.key); }
  }
}
