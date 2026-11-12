import { z } from "zod";
import { replyPreviewSchema, type ServerEvent } from "@turtle/protocol";
import type { Api } from "../api";
import { Conversation, type ConversationApi, type ConversationDisk } from "./conversation";

export interface ChatStorage { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<unknown>; removeItem(key: string): Promise<unknown> }
export interface ChatOptions { userId: string; storage: ChatStorage; id: () => string }
const draftSchema = z.object({ text: z.string(), mentions: z.array(z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), userId: z.string(), label: z.string() })), reply: z.object({ id: z.string().min(1).max(128), preview: replyPreviewSchema.nullable() }).optional() });
const savedSchema = z.object({ version: z.literal(1), conversations: z.record(z.object({
  draft: draftSchema,
  outbox: z.array(z.object({ id: z.string(), requestId: z.string().uuid(), content: z.string().max(4000), draft: draftSchema, createdAt: z.string(), status: z.enum(["sending", "failed", "uncertain"]), error: z.string().optional() })),
})) });

/** Account-scoped durable outbox. Recovery reuses each saved request, never the current draft. */
export class ChatStore {
  readonly ready: Promise<void>;
  private conversations = new Map<string, Conversation>();
  private restored = false;
  private stopped = false;
  private online = false;
  private write: Promise<unknown> = Promise.resolve();
  private saveTimer?: ReturnType<typeof setTimeout>;
  private active = new Set<string>();
  private recoveryTimer?: ReturnType<typeof setTimeout>;
  private recoveryReady = false;
  private recovering = false;
  private recoveryAfter = 0;
  private connectionEpoch = 0;
  private recoveries = new Map<string, { attempts: number; at: number }>();
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
    if (this.stopped) return;
    const reconnected = value && !this.online;
    this.online = value;
    if (!value) { this.recoveryReady = false; ++this.connectionEpoch; clearTimeout(this.recoveryTimer); }
    if (reconnected) {
      const epoch = ++this.connectionEpoch;
      this.recoveries.clear();
      void this.ready.then(async () => {
        if (this.stopped || epoch !== this.connectionEpoch) return;
        await Promise.all([...this.active].map(id => this.get(id).refresh(true)));
        if (this.stopped || !this.online || epoch !== this.connectionEpoch) return;
        this.recoveryReady = true; this.scheduleRecovery();
      });
    }
  };
  receive = (event: ServerEvent) => {
    if (event.t === "message" || event.t === "messageUpdate") this.conversations.get(event.message.channelId)?.receive(event);
    else if (event.t === "messageDelete") this.conversations.get(event.channelId)?.receive(event);
    else if (event.t === "sync") for (const id of this.active) void this.get(id).refresh(true);
  };
  private schedule = () => { this.scheduleRecovery(); clearTimeout(this.saveTimer); if (!this.stopped) this.saveTimer = setTimeout(() => { void this.flush().catch(() => {}); }, 200); };
  private scheduleRecovery = () => {
    clearTimeout(this.recoveryTimer);
    if (this.stopped || !this.online || !this.recoveryReady || this.recovering) return;
    const pending = [...this.conversations.values()].flatMap(conversation => conversation.getSnapshot().outbox.map(item => ({ conversation, item })));
    for (const id of this.recoveries.keys()) if (!pending.some(({ item }) => item.id === id)) this.recoveries.delete(id);
    const candidates = pending.filter(({ item }) => item.status === "uncertain").map(value => {
      let recovery = this.recoveries.get(value.item.id);
      if (!recovery) { recovery = { attempts: 0, at: Date.now() + 1_000 }; this.recoveries.set(value.item.id, recovery); }
      return { ...value, recovery };
    }).filter(({ recovery }) => recovery.attempts < 5).sort((a, b) => a.recovery.at - b.recovery.at);
    const next = candidates[0];
    if (!next) return;
    this.recoveryTimer = setTimeout(() => {
      if (this.stopped || !this.online || !this.recoveryReady) return;
      this.recovering = true;
      next.recovery.attempts++;
      void next.conversation.retry(next.item.id).finally(() => {
        this.recovering = false;
        next.recovery.at = Date.now() + Math.min(30_000, 1_000 * 2 ** next.recovery.attempts);
        // Serialize all conversations and leave room for presence/control events in the flood limit.
        this.recoveryAfter = Date.now() + 250;
        this.scheduleRecovery();
      });
    }, Math.max(0, Math.max(next.recovery.at, this.recoveryAfter) - Date.now()));
  };
  flush = async () => {
    clearTimeout(this.saveTimer);
    if (this.stopped) return;
    await this.ready;
    if (this.stopped) return;
    const conversations = Object.fromEntries([...this.conversations].map(([id, c]) => [id, c.disk()]).filter(([, data]) => (data as ConversationDisk).draft.text || (data as ConversationDisk).draft.reply || (data as ConversationDisk).outbox.length));
    const snapshot = JSON.stringify({ version: 1, conversations });
    this.write = this.write.catch(() => {}).then(() => this.options.storage.setItem(this.key, snapshot));
    try { await this.write; for (const c of this.conversations.values()) c.storageError(); }
    catch (error) { for (const c of this.conversations.values()) c.storageError("Não foi possível salvar o rascunho neste iPhone. Seu texto continua nesta sessão."); throw error; }
  };
  async dispose(clear = false) {
    await this.ready;
    if (!this.stopped) {
      this.stopped = true; clearTimeout(this.saveTimer); clearTimeout(this.recoveryTimer);
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
