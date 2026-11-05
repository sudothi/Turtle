import { errorText } from "./session";

export interface ResourceState<T> { data: T; loading: boolean; error?: string }

/** Shared HTTP read state: keep previous data and let only the latest request publish. */
export class Resource<T> {
  private state: ResourceState<T>;
  private generation = 0;
  private disposed = false;
  private listeners = new Set<() => void>();
  constructor(initial: T, private readonly load: () => Promise<T>, private readonly rejected: (error: unknown) => Promise<boolean>) {
    this.state = { data: initial, loading: true };
  }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private set(patch: Partial<ResourceState<T>>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(fn => fn());
  }
  refresh = async () => {
    if (this.disposed) return;
    const generation = ++this.generation;
    this.set({ loading: true, error: undefined });
    try {
      const data = await this.load();
      if (!this.disposed && generation === this.generation) this.set({ data });
    } catch (error) {
      if (this.disposed || generation !== this.generation) return;
      try {
        if (!(await this.rejected(error)) && !this.disposed && generation === this.generation) this.set({ error: errorText(error) });
      } catch (rejectionError) {
        if (!this.disposed && generation === this.generation) this.set({ error: errorText(rejectionError) });
      }
    } finally {
      if (!this.disposed && generation === this.generation) this.set({ loading: false });
    }
  };
  dispose() { this.disposed = true; ++this.generation; this.listeners.clear(); }
}
