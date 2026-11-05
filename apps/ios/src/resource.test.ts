import { describe, expect, it, vi } from "vitest";
import { Resource } from "./resource";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};
describe("screen HTTP resources", () => {
  it("does not let a slow previous request replace a refreshed conversation", async () => {
    const first = deferred<string[]>();
    const second = deferred<string[]>();
    const load = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const resource = new Resource<string[]>([], load, async () => false);
    const old = resource.refresh();
    const fresh = resource.refresh();
    second.resolve(["current"]); await fresh;
    first.resolve(["stale"]); await old;
    expect(resource.getSnapshot()).toMatchObject({ data: ["current"], loading: false });
  });
  it("keeps previous content when refresh temporarily fails and allows retry", async () => {
    const load = vi.fn().mockResolvedValueOnce(["saved"]).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(["new"]);
    const resource = new Resource<string[]>([], load, async () => false);
    await resource.refresh(); await resource.refresh();
    expect(resource.getSnapshot()).toEqual({ data: ["saved"], loading: false, error: "offline" });
    await resource.refresh();
    expect(resource.getSnapshot()).toEqual({ data: ["new"], loading: false, error: undefined });
  });
  it("a discarded screen cannot reject the session after its request fails", async () => {
    const pending = deferred<string[]>();
    const rejected = vi.fn(async () => true);
    const resource = new Resource([], () => pending.promise, rejected);
    const refreshing = resource.refresh(); resource.dispose();
    pending.reject(new Error("late 401")); await refreshing;
    expect(rejected).not.toHaveBeenCalled();
  });
  it("unsubscribing a view does not cancel ownership of the shared data", async () => {
    const resource = new Resource<string[]>([], async () => ["one"], async () => false);
    const first = vi.fn(); const unsubscribe = resource.subscribe(first); unsubscribe();
    await resource.refresh();
    const next = vi.fn(); resource.subscribe(next);
    expect(resource.getSnapshot().data).toEqual(["one"]);
    expect(first).not.toHaveBeenCalled();
    await resource.refresh(); expect(next).toHaveBeenCalled();
  });
});
