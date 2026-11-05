import { AppState } from "react-native";
import type { Channel, Server } from "@turtle/protocol";
import { Api, ApiError } from "./api";
import { Gateway } from "./gateway";
import { Resource } from "./resource";
import { errorText, type Session } from "./session";
import { Voice } from "./voice";

export type Directory = { server: Server; channels: Channel[] }[];
export interface WorkspaceState { error?: string; signingOut: boolean }

/** One owner for the authenticated lifetime. Screen subscriptions never own native media. */
export class WorkspaceSession {
  readonly directory: Resource<Directory>;
  readonly gateway: Gateway;
  readonly voice: Voice;
  private state: WorkspaceState = { signingOut: false };
  private listeners = new Set<() => void>();
  private started = false;
  private disposed = false;
  constructor(readonly api: Api, private readonly auth: Pick<Session, "logout" | "rejectIfUnauthorized">) {
    this.directory = new Resource<Directory>([], async () => {
      const servers = await api.servers();
      return Promise.all(servers.map(async server => ({ server, channels: await api.channels(server.id) })));
    }, this.reject);
    this.gateway = new Gateway(api, () => { void this.reject(new ApiError(401, "Sessão inválida")).catch(error => this.set({ error: errorText(error) })); }, () => { void this.directory.refresh(); });
    this.voice = new Voice(api, this.gateway.update, () => AppState.currentState === "active");
  }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private set(patch: Partial<WorkspaceState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(fn => fn());
  }
  start() {
    if (this.started || this.disposed) return;
    this.started = true;
    this.gateway.start();
    void this.directory.refresh();
  }
  resume() { if (!this.disposed) this.gateway.resume(); }
  reject = async (error: unknown) => {
    if (this.disposed || !(error instanceof ApiError) || error.status !== 401) return false;
    await this.voice.leave();
    if (this.disposed) return false;
    return this.auth.rejectIfUnauthorized(error);
  };
  enter = async (channelId: string, name: string, microphone: boolean) => {
    if (this.disposed || this.state.signingOut) return;
    this.set({ error: undefined });
    try { await this.voice.join(channelId, name, microphone); }
    catch (error) {
      try {
        if (!(await this.reject(error))) this.set({ error: error instanceof ApiError ? error.message : "Não foi possível entrar na chamada. Confira a conexão e tente novamente." });
      } catch (rejectionError) { this.set({ error: errorText(rejectionError) }); }
    }
  };
  clearError = () => this.set({ error: undefined });
  logout = async () => {
    if (this.disposed || this.state.signingOut) return;
    this.set({ signingOut: true, error: undefined });
    try { await this.voice.leave(); await this.auth.logout(); }
    catch (error) { this.set({ error: errorText(error) }); }
    finally { this.set({ signingOut: false }); }
  };
  dispose = async () => {
    if (this.disposed) return;
    this.disposed = true;
    this.directory.dispose();
    this.gateway.stop();
    this.listeners.clear();
    await this.voice.leave();
  };
}
