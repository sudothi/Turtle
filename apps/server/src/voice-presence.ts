import type { VoiceState } from "@turtle/protocol";

type MediaState = Pick<VoiceState, "muted" | "camera" | "screen">;
interface PresenceOptions<Connection> {
  probe?: (connection: Connection, state: VoiceState) => Promise<MediaState | null>;
  changed(): void;
  removed(connection: Connection): void;
  disconnect(state: VoiceState): Promise<void>;
  intervalMs?: number;
  leaseMs?: number;
  timeoutMs?: number;
}
interface Detached { timer?: ReturnType<typeof setTimeout>; verifiedUntil: number }

/** A closed chat socket can retain voice only while its authenticated media session is verified. */
export class VoicePresence<Connection> extends Map<Connection, VoiceState> {
  private detached = new Map<Connection, Detached>();
  constructor(private readonly options: PresenceOptions<Connection>) { super(); }

  override delete(connection: Connection) {
    clearTimeout(this.detached.get(connection)?.timer);
    this.detached.delete(connection);
    const removed = super.delete(connection);
    if (removed) this.options.removed(connection);
    return removed;
  }

  detach(connection: Connection) {
    if (!this.has(connection) || this.detached.has(connection)) return;
    const entry: Detached = { verifiedUntil: Date.now() + (this.options.leaseMs ?? 45_000) };
    this.detached.set(connection, entry);
    void this.reconcile(connection, entry);
  }

  private async reconcile(connection: Connection, entry: Detached) {
    const state = this.get(connection);
    if (!state || this.detached.get(connection) !== entry) return;
    if (Date.now() >= entry.verifiedUntil) return this.drop(connection, state);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const media = this.options.probe ? await Promise.race([
        this.options.probe(connection, state),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("voice presence timeout")), Math.min(this.options.timeoutMs ?? 5_000, entry.verifiedUntil - Date.now())); timeout.unref?.(); }),
      ]) : null;
      if (this.detached.get(connection) !== entry) return;
      if (!media) return this.drop(connection, state);
      entry.verifiedUntil = Date.now() + (this.options.leaseMs ?? 45_000);
      const current = this.get(connection)!;
      if (current.muted !== media.muted || current.camera !== media.camera || current.screen !== media.screen) {
        this.set(connection, { ...current, ...media });
        this.options.changed();
      }
    } catch {
      if (this.detached.get(connection) !== entry) return;
      if (Date.now() >= entry.verifiedUntil) return this.drop(connection, state);
    } finally { clearTimeout(timeout); }
    if (this.detached.get(connection) !== entry) return;
    entry.timer = setTimeout(() => void this.reconcile(connection, entry), Math.min(this.options.intervalMs ?? 15_000, Math.max(0, entry.verifiedUntil - Date.now())));
    entry.timer.unref?.();
  }

  private drop(connection: Connection, state: VoiceState) {
    this.delete(connection);
    this.options.changed();
    // Fails closed after an expired verification lease; a disconnected process must not become invisible.
    void this.options.disconnect(state).catch(() => {});
  }

  close() {
    for (const entry of this.detached.values()) clearTimeout(entry.timer);
    this.detached.clear();
    super.clear();
  }
}
