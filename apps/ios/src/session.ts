import type { User } from "@turtle/protocol";
import { z } from "zod";
import { Api, ApiError, apiOrigin, type Credentials } from "./api";

const savedSession = z.object({ origin: z.string(), token: z.string().min(1) });
export interface SecretStore {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  remove(): Promise<void>;
}
export type SessionState =
  | { phase: "restoring" }
  | { phase: "signedOut"; error?: string }
  | { phase: "offline"; error: string }
  | { phase: "signedIn"; user: User; api: Api };

export const errorText = (error: unknown) => error instanceof Error ? error.message : "Não foi possível concluir. Tente novamente.";

/** Network failure never deletes a valid saved credential. Only a confirmed 401 does. */
export class Session {
  private state: SessionState = { phase: "restoring" };
  private listeners = new Set<() => void>();
  private generation = 0;
  private storageTask: Promise<void> = Promise.resolve();
  constructor(private readonly store: SecretStore, private readonly transport?: typeof fetch) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(state: SessionState) { this.state = state; this.listeners.forEach(fn => fn()); }
  private mutateStore(operation: () => Promise<void>) {
    const next = this.storageTask.then(operation);
    this.storageTask = next.catch(() => {});
    return next;
  }

  async restore() {
    const generation = ++this.generation;
    this.set({ phase: "restoring" });
    try {
      await this.storageTask;
      const raw = await this.store.read();
      if (generation !== this.generation) return;
      if (!raw) return this.set({ phase: "signedOut" });
      const saved = savedSession.safeParse(JSON.parse(raw));
      if (!saved.success) throw new Error("Não foi possível ler a sessão. Saia da conta e entre novamente.");
      const api = new Api(saved.data.origin, saved.data.token, this.transport);
      const user = await api.me();
      if (generation === this.generation) this.set({ phase: "signedIn", api, user });
    } catch (error) {
      if (generation !== this.generation) return;
      if (error instanceof ApiError && error.status === 401) {
        try {
          await this.mutateStore(async () => { if (generation === this.generation) await this.store.remove(); });
          if (generation === this.generation) this.set({ phase: "signedOut", error: "Sua sessão não é mais válida. Entre novamente." });
        } catch (storageError) {
          if (generation === this.generation) this.set({ phase: "offline", error: errorText(storageError) });
        }
      } else this.set({ phase: "offline", error: errorText(error) });
    }
  }

  async authenticate(origin: string, username: string, password: string, inviteCode?: string) {
    const generation = ++this.generation;
    const normalized = apiOrigin(origin);
    const api = new Api(normalized, undefined, this.transport);
    const result = inviteCode === undefined
      ? await api.login(username, password)
      : await api.register({ username, password, inviteCode } satisfies Credentials);
    if (generation !== this.generation) return;
    await this.mutateStore(async () => {
      if (generation === this.generation) await this.store.write(JSON.stringify({ origin: normalized, token: result.token }));
    });
    if (generation === this.generation) this.set({ phase: "signedIn", user: result.user, api: new Api(normalized, result.token, this.transport) });
  }

  async logout() {
    ++this.generation;
    await this.mutateStore(() => this.store.remove());
    this.set({ phase: "signedOut" });
  }

  /** Used only after an authenticated API request is rejected, never after a login error. */
  async rejectIfUnauthorized(error: unknown) {
    if (!(error instanceof ApiError) || error.status !== 401) return false;
    await this.logout();
    this.set({ phase: "signedOut", error: "Sua sessão não é mais válida. Entre novamente." });
    return true;
  }
}
