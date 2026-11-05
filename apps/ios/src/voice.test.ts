import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VoiceReport } from "./gateway";

const fake = vi.hoisted(() => {
  class Room {
    static instances: Room[] = [];
    localParticipant = { identity: "local", name: "Amigo", isSpeaking: false, isMicrophoneEnabled: false, connectionQuality: "excellent", setMicrophoneEnabled: vi.fn(async (enabled: boolean) => { this.localParticipant.isMicrophoneEnabled = enabled; }) };
    remoteParticipants = new Map();
    connect = vi.fn(async () => {});
    disconnect = vi.fn(async () => {});
    on = vi.fn(() => this);
    removeAllListeners = vi.fn();
    constructor() { Room.instances.push(this); }
  }
  return { Room, audio: { configureAudio: vi.fn(async () => {}), startAudioSession: vi.fn(async () => {}), stopAudioSession: vi.fn(async () => {}), setDefaultRemoteAudioTrackVolume: vi.fn(async () => {}) } };
});
vi.mock("@livekit/react-native", () => ({ AudioSession: fake.audio }));
vi.mock("livekit-client", async original => ({ ...await original<typeof import("livekit-client")>(), Room: fake.Room }));
import { Voice } from "./voice";

function setup(active = () => true) {
  const api = { voiceToken: vi.fn(async () => ({ url: "wss://voice.example.test", token: "room-token" })) };
  const report = vi.fn<(state: VoiceReport) => void>();
  return { api, report, voice: new Voice(api, report, active) };
}
beforeEach(() => { fake.Room.instances = []; vi.clearAllMocks(); });

describe("native call lifecycle", () => {
  it("joins listen-only without publishing a microphone and reports gateway state", async () => {
    const { voice, report } = setup();
    await voice.join("voice1", "Amigos", false);
    expect(voice.getSnapshot()).toMatchObject({ status: "connected", muted: true });
    expect(fake.Room.instances[0]!.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ channelId: "voice1", muted: true }));
    await voice.leave();
  });
  it("cancels a pending token request without connecting or reopening the mic", async () => {
    const { api, voice } = setup();
    let resolve!: (token: { url: string; token: string }) => void;
    api.voiceToken.mockImplementation(() => new Promise(done => { resolve = done; }));
    const joining = voice.join("voice1", "Amigos", true);
    const leaving = voice.leave();
    resolve({ url: "wss://voice.example.test", token: "token" });
    await Promise.all([joining, leaving]);
    expect(fake.Room.instances).toHaveLength(0);
    expect(voice.getSnapshot()).toMatchObject({ status: "idle", channelId: null, muted: true });
  });
  it("does not publish the mic if iOS backgrounds the app during connection", async () => {
    const { voice } = setup(() => false);
    await voice.join("voice1", "Amigos", true);
    expect(fake.Room.instances[0]!.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    expect(voice.getSnapshot().muted).toBe(true);
    await voice.leave();
  });
  it("keeps the call connected if reopening the microphone is denied", async () => {
    const { voice } = setup();
    const connecting = voice.join("voice1", "Amigos", true);
    await vi.waitFor(() => expect(fake.Room.instances).toHaveLength(1));
    // Exercise the same behavior through the user mute control after joining.
    await connecting;
    const room = fake.Room.instances[0]!;
    await voice.toggleMute();
    room.localParticipant.setMicrophoneEnabled.mockRejectedValueOnce(new Error("permission denied"));
    await voice.toggleMute();
    expect(voice.getSnapshot()).toMatchObject({ status: "connected", muted: true });
    expect(voice.getSnapshot().error).toContain("permissão");
    await voice.leave();
  });
  it("undeafening never silently reopens capture", async () => {
    const { voice } = setup();
    await voice.join("voice1", "Amigos", true);
    await voice.toggleDeafened();
    await voice.toggleMute();
    expect(voice.getSnapshot()).toMatchObject({ deafened: true, muted: true });
    await voice.toggleDeafened();
    expect(voice.getSnapshot()).toMatchObject({ deafened: false, muted: true });
    await voice.leave();
  });
  it("leaving disconnects native media, deactivates audio, and clears presence", async () => {
    const { voice, report } = setup();
    await voice.join("voice1", "Amigos", false);
    const room = fake.Room.instances[0]!;
    await voice.leave();
    expect(room.disconnect).toHaveBeenCalledOnce();
    expect(fake.audio.stopAudioSession).toHaveBeenCalled();
    expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ channelId: null, muted: true }));
    expect(voice.getSnapshot().status).toBe("idle");
  });
});
