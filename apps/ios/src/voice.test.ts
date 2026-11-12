import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VoiceReport } from "./gateway";

const fake = vi.hoisted(() => {
  class AudioTrack { kind = "audio"; setVolume = vi.fn(); }
  class Room {
    static instances: Room[] = [];
    localParticipant = { isCameraEnabled: false, getTrackPublication: vi.fn(), setCameraEnabled: vi.fn(async (enabled: boolean) => { this.localParticipant.isCameraEnabled = enabled; }), identity: "local", name: "Amigo", isSpeaking: false, isMicrophoneEnabled: false, connectionQuality: "excellent", setMicrophoneEnabled: vi.fn(async (enabled: boolean) => { this.localParticipant.isMicrophoneEnabled = enabled; }) };
    remoteParticipants = new Map();
    connect = vi.fn(async () => {});
    disconnect = vi.fn(async () => {});
    handlers = new Map<string, (...args: any[]) => void>();
    on = vi.fn((event: string, handler: (...args: any[]) => void) => { this.handlers.set(event, handler); return this; });
    emit(event: string, ...args: any[]) { this.handlers.get(event)?.(...args); }
    removeAllListeners = vi.fn(() => this.handlers.clear());
    constructor() { Room.instances.push(this); }
  }
  return { Room, AudioTrack, audio: { configureAudio: vi.fn(async () => {}), startAudioSession: vi.fn(async () => {}), stopAudioSession: vi.fn(async () => {}), setDefaultRemoteAudioTrackVolume: vi.fn(async () => {}) } };
});
vi.mock("@livekit/react-native", () => ({ AudioSession: fake.audio }));
vi.mock("livekit-client", async original => ({ ...await original<typeof import("livekit-client")>(), Room: fake.Room, RemoteAudioTrack: fake.AudioTrack }));
import { Voice } from "./voice";

function setup(active = () => true) {
  const api = { voiceToken: vi.fn(async () => ({ url: "wss://voice.example.test", token: "room-token" })) };
  const report = vi.fn<(state: VoiceReport) => void>();
  const expired = vi.fn<(error: unknown) => void>();
  return { api, report, expired, voice: new Voice(api, report, active, expired) };
}
beforeEach(() => { fake.Room.instances = []; vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); });

describe("native call lifecycle", () => {
  it("keeps the microphone closed after a system interruption until explicitly reopened", async () => {
    const { voice } = setup();
    await voice.join("voice1", "Amigos", true);
    await voice.interrupt();
    await voice.toggleMute();
    expect(voice.getSnapshot().muted).toBe(true);
    voice.interruptionEnded();
    expect(voice.getSnapshot().muted).toBe(true);
    await voice.toggleMute();
    expect(voice.getSnapshot().muted).toBe(false);
    await voice.leave();
  });
  it("does not reopen capture if interruption happens while requesting a recovery token", async () => {
    vi.useFakeTimers();
    const { voice, api } = setup();
    await voice.join("voice1", "Amigos", true);
    fake.Room.instances[0]!.emit("disconnected", 0);
    let resolve!: (value: { url: string; token: string }) => void;
    api.voiceToken.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await vi.advanceTimersByTimeAsync(1000);
    await voice.interrupt(); voice.interruptionEnded();
    resolve({ url: "wss://voice.test", token: "token" });
    await vi.advanceTimersByTimeAsync(1);
    expect(fake.Room.instances[1]!.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalledWith(true);
    await voice.leave();
  });
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


describe("call recovery", () => {
  it("recovers a network disconnect with a fresh token and preserves deafening", async () => {
    vi.useFakeTimers();
    const { voice, api } = setup();
    await voice.join("voice1", "Amigos", true);
    await voice.toggleDeafened();
    fake.Room.instances[0]!.emit("disconnected", 0);
    expect(voice.getSnapshot().status).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.voiceToken).toHaveBeenCalledTimes(2);
    expect(voice.getSnapshot()).toMatchObject({ status: "connected", deafened: true, muted: true });
    expect(fake.Room.instances[1]!.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    expect(fake.audio.setDefaultRemoteAudioTrackVolume).toHaveBeenLastCalledWith(0);
    await voice.leave();
  });
  it("cancels a scheduled reconnect when leaving", async () => {
    vi.useFakeTimers();
    const { voice, api } = setup();
    await voice.join("voice1", "Amigos", true);
    fake.Room.instances[0]!.emit("disconnected", 0);
    await voice.leave();
    await vi.advanceTimersByTimeAsync(30000);
    expect(api.voiceToken).toHaveBeenCalledOnce();
    expect(voice.getSnapshot().status).toBe("idle");
  });
  it("does not reopen the mic when recovery completes in background", async () => {
    vi.useFakeTimers();
    let active = true;
    const { voice } = setup(() => active);
    await voice.join("voice1", "Amigos", true);
    active = false;
    fake.Room.instances[0]!.emit("disconnected", 0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fake.Room.instances[1]!.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    expect(voice.getSnapshot().muted).toBe(true);
    await voice.leave();
  });
  it("stops recovery when access is revoked", async () => {
    vi.useFakeTimers();
    const { voice, api } = setup();
    await voice.join("voice1", "Amigos", false);
    api.voiceToken.mockRejectedValueOnce(Object.assign(new Error("denied"), { status: 403 }));
    fake.Room.instances[0]!.emit("disconnected", 0);
    await vi.advanceTimersByTimeAsync(30000);
    expect(api.voiceToken).toHaveBeenCalledTimes(2);
    expect(voice.getSnapshot().status).toBe("idle");
  });
  it("reports an expired account session when fetching a recovery token returns 401", async () => {
    vi.useFakeTimers();
    const { voice, api, expired } = setup();
    await voice.join("voice1", "Amigos", true);
    const error = Object.assign(new Error("session revoked"), { status: 401 });
    api.voiceToken.mockRejectedValueOnce(error);
    fake.Room.instances[0]!.emit("disconnected", 0);
    await vi.advanceTimersByTimeAsync(30000);
    expect(expired).toHaveBeenCalledExactlyOnceWith(error);
    expect(api.voiceToken).toHaveBeenCalledTimes(2);
    expect(voice.getSnapshot()).toMatchObject({ status: "idle", muted: true });
    expect(fake.audio.stopAudioSession).toHaveBeenCalled();
  });
  it.each([403, 404, 503])("does not invalidate the account session for recovery HTTP %s", async status => {
    vi.useFakeTimers();
    const { voice, api, expired } = setup();
    await voice.join("voice1", "Amigos", false);
    api.voiceToken.mockRejectedValueOnce(Object.assign(new Error("unavailable"), { status }));
    fake.Room.instances[0]!.emit("disconnected", 0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(expired).not.toHaveBeenCalled();
    expect(voice.getSnapshot().status).toBe(status === 503 ? "reconnecting" : "idle");
    await voice.leave();
  });
});


describe("camera and screen subscriptions", () => {
  it.each(["local", "remote"])("removes muted %s video even when its track is retained, then resumes on unmute", async side => {
    const { voice } = setup();
    await voice.join("voice1", "Amigos", false);
    const room = fake.Room.instances[0]!;
    const camera = { source: "camera", trackSid: "camera", isMuted: false, videoTrack: {} as object | undefined, setSubscribed: vi.fn() };
    const participant = side === "local" ? room.localParticipant : {
      identity: "friend", name: "Amigo", getTrackPublication: vi.fn((source: string) => source === "camera" ? camera : undefined),
      trackPublications: new Map([[camera.trackSid, camera]]), audioTrackPublications: new Map(), isMicrophoneEnabled: true,
    };
    if (side === "local") room.localParticipant.getTrackPublication.mockImplementation(source => source === "camera" ? camera : undefined);
    else room.remoteParticipants.set(participant.identity, participant);
    room.emit(side === "local" ? "localTrackPublished" : "trackSubscribed", camera.videoTrack, camera, participant);
    const member = () => voice.getSnapshot().members.find(member => member.id === participant.identity)!;
    expect(member().video?.publication).toBe(camera);
    for (let cycle = 0; cycle < 2; cycle++) {
      camera.isMuted = true;
      room.emit("trackMuted", camera, participant);
      expect(camera.videoTrack).toBeDefined();
      expect(member().video).toBeUndefined();
      camera.isMuted = false;
      room.emit("trackUnmuted", camera, participant);
      expect(member().video?.publication).toBe(camera);
    }
    camera.videoTrack = undefined;
    room.emit("trackUnsubscribed", undefined, camera, participant);
    expect(member().video).toBeUndefined();
    camera.videoTrack = {};
    room.emit(side === "local" ? "localTrackPublished" : "trackSubscribed", camera.videoTrack, camera, participant);
    expect(member().video).toBeDefined();
    participant.getTrackPublication.mockReturnValue(undefined);
    room.emit(side === "local" ? "localTrackUnpublished" : "trackUnpublished", camera, participant);
    expect(member().video).toBeUndefined();
    await voice.leave();
  });
  it("removes the local video in background when disabling capture retains a muted track", async () => {
    let active = true;
    const { voice } = setup(() => active);
    await voice.join("voice1", "Amigos", false);
    const room = fake.Room.instances[0]!;
    const camera = { isMuted: false, videoTrack: {} };
    room.localParticipant.getTrackPublication.mockImplementation(source => source === "camera" ? camera : undefined);
    room.localParticipant.setCameraEnabled.mockImplementation(async enabled => {
      room.localParticipant.isCameraEnabled = enabled;
      camera.isMuted = !enabled;
    });
    await voice.toggleCamera();
    expect(voice.getSnapshot().members[0]!.video).toBeDefined();
    active = false;
    await voice.background();
    expect(camera.videoTrack).toBeDefined();
    expect(voice.getSnapshot()).toMatchObject({ camera: false, members: [expect.objectContaining({ video: undefined })] });
    active = true;
    voice.foreground();
    expect(voice.getSnapshot().members[0]!.video).toBeUndefined();
    await voice.toggleCamera();
    expect(voice.getSnapshot().members[0]!.video).toBeDefined();
    await voice.leave();
  });
  it("keeps the camera off after a brief inactive/active transition during camera startup", async () => {
    let active = true;
    const { voice } = setup(() => active);
    await voice.join("voice1", "Amigos", false);
    const room = fake.Room.instances[0]!;
    let finish!: () => void;
    room.localParticipant.setCameraEnabled.mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { finish = resolve; });
      room.localParticipant.isCameraEnabled = true;
    });
    const starting = voice.toggleCamera();
    active = false; await voice.background();
    active = true; voice.foreground(); finish(); await starting;
    expect(voice.getSnapshot().camera).toBe(false);
    expect(room.localParticipant.setCameraEnabled).toHaveBeenLastCalledWith(false);
    await voice.leave();
  });
  it("subscribes to cameras only on the call screen and to shared screen/audio only on request", async () => {
    const { voice } = setup();
    await voice.join("voice1", "Amigos", false);
    const pub = (source: string) => ({ source, trackSid: source, isMuted: false, setSubscribed: vi.fn() });
    const mic = pub("microphone"), camera = pub("camera"), screen = pub("screen_share"), audio = pub("screen_share_audio");
    const publications = [mic, camera, screen, audio];
    fake.Room.instances[0]!.remoteParticipants.set("friend", { identity: "friend", name: "Amigo", getTrackPublication: (source: string) => publications.find(p => p.source === source), trackPublications: new Map(publications.map(p => [p.trackSid, p])), audioTrackPublications: new Map(), isSpeaking: false, isMicrophoneEnabled: true });
    voice.setVideoVisible(true);
    expect(mic.setSubscribed).toHaveBeenLastCalledWith(true);
    expect(camera.setSubscribed).toHaveBeenLastCalledWith(true);
    expect(screen.setSubscribed).toHaveBeenLastCalledWith(false);
    expect(audio.setSubscribed).toHaveBeenLastCalledWith(false);
    voice.watchScreen("screen_share", true);
    expect(screen.setSubscribed).toHaveBeenLastCalledWith(true);
    expect(audio.setSubscribed).toHaveBeenLastCalledWith(true);
    voice.setVideoVisible(false);
    expect(camera.setSubscribed).toHaveBeenLastCalledWith(false);
    expect(audio.setSubscribed).toHaveBeenLastCalledWith(false);
    expect(mic.setSubscribed).toHaveBeenLastCalledWith(true);
    await voice.leave();
  });
  it("keeps independent voice and screen volumes and applies deafening to both", async () => {
    const { voice, mic, audio } = await receivingScreen();
    const micTrack = mic.track!, screenTrack = audio.track!;
    voice.setVolume("friend", "voice", 0.5); voice.setVolume("friend", "screen", 0.25);
    expect(micTrack.setVolume).toHaveBeenLastCalledWith(0.5);
    expect(screenTrack.setVolume).toHaveBeenLastCalledWith(0.25);
    await voice.toggleDeafened();
    expect(micTrack.setVolume).toHaveBeenLastCalledWith(0);
    expect(screenTrack.setVolume).toHaveBeenLastCalledWith(0);
    await voice.toggleDeafened();
    expect(micTrack.setVolume).toHaveBeenLastCalledWith(0.5);
    expect(screenTrack.setVolume).toHaveBeenLastCalledWith(0.25);
    await voice.leave();
  });
  it("turns the camera off in background and requires an explicit action to reopen", async () => {
    let active = true;
    const { voice } = setup(() => active);
    await voice.join("voice1", "Amigos", false);
    await voice.toggleCamera();
    expect(voice.getSnapshot().camera).toBe(true);
    active = false; await voice.background();
    expect(voice.getSnapshot().camera).toBe(false);
    active = true; voice.foreground();
    expect(voice.getSnapshot().camera).toBe(false);
    await voice.leave();
  });
});

async function receivingScreen() {
  const { voice } = setup();
  await voice.join("voice1", "Amigos", false);
  const room = fake.Room.instances[0]!;
  const pub = (source: string, track?: InstanceType<typeof fake.AudioTrack>) => ({ source, trackSid: source, isMuted: false, track, setSubscribed: vi.fn() });
  const mic = pub("microphone", new fake.AudioTrack()), screen = pub("screen_share"), audio = pub("screen_share_audio", new fake.AudioTrack());
  const publications = new Map([mic, screen, audio].map(p => [p.trackSid, p]));
  const participant = { identity: "friend", name: "Amigo", getTrackPublication: (source: string) => [...publications.values()].find(p => p.source === source), trackPublications: publications, audioTrackPublications: new Map([[mic.trackSid, mic], [audio.trackSid, audio]]), isSpeaking: false, isMicrophoneEnabled: true };
  room.remoteParticipants.set(participant.identity, participant);
  voice.setVideoVisible(true);
  voice.watchScreen(screen.trackSid, true);
  return { voice, room, participant, publications, mic, screen, audio };
}

describe("screen audio cleanup", () => {
  it("unsubscribes and silences orphaned screen audio as soon as video is unpublished", async () => {
    const { voice, room, participant, publications, mic, screen, audio } = await receivingScreen();
    publications.delete(screen.trackSid);
    room.emit("trackUnpublished", screen, participant);
    expect(audio.setSubscribed).toHaveBeenLastCalledWith(false);
    expect(audio.track!.setVolume).toHaveBeenLastCalledWith(0);
    expect(mic.setSubscribed).toHaveBeenLastCalledWith(true);
    expect(mic.track!.setVolume).toHaveBeenLastCalledWith(1);
    expect(voice.getSnapshot()).toMatchObject({ status: "connected", screens: [] });
    await voice.leave();
  });
  it("keeps late audio silent even when volume and deafening change", async () => {
    const { voice, room, participant, publications, screen, audio } = await receivingScreen();
    publications.delete(screen.trackSid);
    room.emit("trackUnpublished", screen, participant);
    room.emit("trackSubscribed", audio.track, audio, participant);
    expect(audio.track!.setVolume).toHaveBeenLastCalledWith(0);
    voice.setVolume(participant.identity, "screen", 0.5);
    expect(audio.track!.setVolume).toHaveBeenLastCalledWith(0);
    await voice.toggleDeafened();
    await voice.toggleDeafened();
    expect(audio.track!.setVolume).toHaveBeenLastCalledWith(0);
    await voice.leave();
  });
  it("requires watching a new publication explicitly and restores its chosen volume", async () => {
    const { voice, room, participant, publications, screen, audio } = await receivingScreen();
    voice.setVolume(participant.identity, "screen", 0.25);
    publications.delete(screen.trackSid);
    room.emit("trackUnpublished", screen, participant);
    const next = { ...screen, trackSid: "next-screen", setSubscribed: vi.fn() };
    publications.set(next.trackSid, next);
    room.emit("trackPublished", next, participant);
    expect(audio.setSubscribed).toHaveBeenLastCalledWith(false);
    expect(audio.track!.setVolume).toHaveBeenLastCalledWith(0);
    expect(voice.getSnapshot().screens).toEqual([expect.objectContaining({ id: next.trackSid, watching: false })]);
    voice.watchScreen(next.trackSid, true);
    expect(audio.setSubscribed).toHaveBeenLastCalledWith(true);
    expect(audio.track!.setVolume).toHaveBeenLastCalledWith(0.25);
    await voice.leave();
  });
  it("silences muted screen video and requires a new watch action after unmuting", async () => {
    const { voice, room, participant, screen, audio } = await receivingScreen();
    screen.isMuted = true;
    room.emit("trackMuted", screen, participant);
    expect(audio.setSubscribed).toHaveBeenLastCalledWith(false);
    expect(audio.track!.setVolume).toHaveBeenLastCalledWith(0);
    screen.isMuted = false;
    room.emit("trackUnmuted", screen, participant);
    expect(audio.track!.setVolume).toHaveBeenLastCalledWith(0);
    voice.watchScreen(screen.trackSid, true);
    expect(audio.track!.setVolume).toHaveBeenLastCalledWith(1);
    await voice.leave();
  });
  it("silences screen audio while not watching or when the call screen is hidden", async () => {
    const { voice, screen, audio } = await receivingScreen();
    voice.watchScreen(screen.trackSid, false);
    expect(audio.track!.setVolume).toHaveBeenLastCalledWith(0);
    voice.watchScreen(screen.trackSid, true);
    expect(audio.track!.setVolume).toHaveBeenLastCalledWith(1);
    voice.setVideoVisible(false);
    expect(audio.track!.setVolume).toHaveBeenLastCalledWith(0);
    await voice.leave();
  });
});
