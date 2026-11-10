import { describe, expect, it, vi } from "vitest";
import { CallLifecycle, type AudioInterruption } from "./call-lifecycle";

function setup(initialState = "active") {
  let event!: (state: AudioInterruption) => void;
  let status = "connected";
  let changeVoice!: () => void;
  const owner = {
    resume: vi.fn(), chat: { flush: vi.fn(async () => {}) },
    voice: { getSnapshot: () => ({ status }), subscribe: (fn: () => void) => { changeVoice = fn; return vi.fn(); }, background: vi.fn(async () => {}), foreground: vi.fn(), interrupt: vi.fn(async () => {}), interruptionEnded: vi.fn() },
  };
  const audio = {
    snapshot: vi.fn(async () => ({ id: 0, held: false, interrupted: false })),
    setCallActive: vi.fn(async (_active: boolean) => {}), acknowledge: vi.fn(async (_id: number) => true),
    addListener: (_name: "onInterruption", fn: typeof event) => { event = fn; return { remove: vi.fn() }; },
  };
  const lifecycle = new CallLifecycle(owner, audio, initialState);
  return { owner, audio, lifecycle, emit: (state: AudioInterruption) => event(state), status: (value: string) => { status = value; changeVoice(); } };
}

describe("iOS call lifecycle", () => {
  it("flushes drafts and turns off video when inactive, without restarting media", () => {
    const { lifecycle, owner } = setup();
    lifecycle.change("inactive"); lifecycle.change("inactive"); lifecycle.change("background");
    expect(owner.voice.background).toHaveBeenCalledTimes(2);
    expect(owner.resume).not.toHaveBeenCalled();
    lifecycle.change("active"); lifecycle.change("active");
    expect(owner.resume).toHaveBeenCalledOnce();
    expect(owner.voice.foreground).toHaveBeenCalledOnce();
    lifecycle.stop();
  });
  it("never releases native audio before the interrupted microphone has been muted", async () => {
    const { lifecycle, owner, audio, emit } = setup();
    let finish!: () => void;
    owner.voice.interrupt.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    emit({ id: 1, held: true, interrupted: false });
    expect(audio.acknowledge).not.toHaveBeenCalled();
    finish();
    await vi.waitFor(() => expect(audio.acknowledge).toHaveBeenCalledWith(1));
    expect(owner.voice.interruptionEnded).toHaveBeenCalledOnce();
    lifecycle.stop();
  });
  it("keeps native capture held while the OS interruption is active", async () => {
    const { lifecycle, owner, audio, emit } = setup();
    emit({ id: 1, held: true, interrupted: true });
    await vi.waitFor(() => expect(owner.voice.interrupt).toHaveBeenCalledOnce());
    expect(audio.acknowledge).not.toHaveBeenCalled();
    emit({ id: 1, held: true, interrupted: false });
    await vi.waitFor(() => expect(owner.voice.interruptionEnded).toHaveBeenCalledOnce());
    lifecycle.stop();
  });
  it("recovers an interruption missed by suspended JS from the native snapshot", async () => {
    const { lifecycle, owner, audio } = setup("background");
    audio.snapshot.mockResolvedValue({ id: 3, held: true, interrupted: false });
    lifecycle.change("active");
    await vi.waitFor(() => expect(audio.acknowledge).toHaveBeenCalledWith(3));
    expect(owner.voice.interrupt).toHaveBeenCalled();
    lifecycle.stop();
  });
  it("does not clear the capture guard if a newer native interruption rejects acknowledgement", async () => {
    const { lifecycle, owner, audio, emit } = setup();
    audio.acknowledge.mockResolvedValue(false);
    emit({ id: 1, held: true, interrupted: false });
    await vi.waitFor(() => expect(audio.acknowledge).toHaveBeenCalledWith(1));
    expect(owner.voice.interruptionEnded).not.toHaveBeenCalled();
    lifecycle.stop();
  });
  it("does not mutate a disposed workspace from late events", () => {
    const { lifecycle, owner, emit } = setup();
    lifecycle.stop();
    emit({ id: 1, held: true, interrupted: false }); lifecycle.change("inactive");
    expect(owner.voice.interrupt).not.toHaveBeenCalled();
    expect(owner.voice.background).not.toHaveBeenCalled();
  });
});
