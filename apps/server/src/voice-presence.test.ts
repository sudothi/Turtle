import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VoiceState } from "@turtle/protocol";
import { VoicePresence } from "./voice-presence.js";

const state = { userId: "user", channelId: "call", serverId: "server", username: "friend", displayName: null, avatar: null, staff: false, muted: false, deafened: false, camera: true, screen: false } satisfies VoiceState;
const media = { muted: false, camera: false, screen: false };
let presence: VoicePresence<string>;
function setup() {
  const probe = vi.fn(async (_connection: string, _state: VoiceState): Promise<typeof media | null> => media);
  const changed = vi.fn(), removed = vi.fn(), disconnect = vi.fn(async () => {});
  presence = new VoicePresence({ probe, changed, removed, disconnect, intervalMs: 100, leaseMs: 300, timeoutMs: 50 });
  presence.set("socket", state);
  return { probe, changed, removed, disconnect };
}
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { presence?.close(); vi.useRealTimers(); });

describe("voice presence after chat socket closure", () => {
  it("retains a verified media session and follows its native mute/camera state", async () => {
    const { probe, changed } = setup();
    presence.detach("socket"); await vi.advanceTimersByTimeAsync(0);
    expect(presence.get("socket")).toMatchObject(media);
    await vi.advanceTimersByTimeAsync(2000);
    expect(presence.size).toBe(1);
    expect(probe.mock.calls.length).toBeGreaterThan(5);
    expect(changed).toHaveBeenCalledOnce();
  });
  it("removes ended or unauthorized media sessions", async () => {
    const { probe, removed, disconnect } = setup(); probe.mockResolvedValue(null);
    presence.detach("socket"); await vi.advanceTimersByTimeAsync(0);
    expect(presence.size).toBe(0); expect(removed).toHaveBeenCalledWith("socket");
    expect(disconnect).toHaveBeenCalledWith(state);
  });
  it("tolerates transient lookup failures but never retains unverified presence indefinitely", async () => {
    const { probe } = setup(); probe.mockRejectedValue(new Error("unreachable"));
    presence.detach("socket"); await vi.advanceTimersByTimeAsync(200);
    expect(presence.size).toBe(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(presence.size).toBe(0);
  });
  it("bounds stalled probes and expires their lease", async () => {
    const { probe } = setup(); probe.mockImplementation(() => new Promise(() => {}));
    presence.detach("socket"); await vi.advanceTimersByTimeAsync(400);
    expect(presence.size).toBe(0);
  });
  it("never restores or removes a replacement connection from a stale probe", async () => {
    const { probe, disconnect } = setup();
    let finish!: (value: null) => void;
    probe.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    presence.detach("socket"); presence.delete("socket");
    presence.set("new socket", { ...state, camera: false });
    finish(null); await vi.advanceTimersByTimeAsync(1000);
    expect([...presence.keys()]).toEqual(["new socket"]);
    expect(disconnect).not.toHaveBeenCalled();
  });
  it("stops verifying a call when explicitly deleted or the server shuts down", async () => {
    const { probe } = setup(); presence.detach("socket"); await vi.advanceTimersByTimeAsync(0);
    presence.delete("socket"); await vi.advanceTimersByTimeAsync(1000);
    expect(probe).toHaveBeenCalledOnce();
  });
});
