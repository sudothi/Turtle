import type { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ rooms: [] as any[] }));
vi.mock("./rnnoise", () => ({ preloadNoiseWasm: vi.fn(async () => undefined), publishAsMono: vi.fn(), RnnoiseProcessor: class {} }));
vi.mock("./codec", () => ({ preferHardwareH264: vi.fn() }));
vi.mock("../sounds", () => ({ loadSoundPrefs: () => ({}), playSound: vi.fn() }));
vi.mock("../api", () => ({ api: { voiceToken: vi.fn(async () => ({ url: "wss://voice.test", token: "test" })) } }));
vi.mock("../desktop", () => ({ desktop: () => undefined }));
vi.mock("livekit-client", async original => {
  const sdk = await original<typeof import("livekit-client")>();
  const { EventEmitter } = await import("node:events");
  class Room extends EventEmitter {
    remoteParticipants = new Map();
    localParticipant = new Participant("local");
    connect = vi.fn(async () => {});
    disconnect = vi.fn(async () => {});
    constructor() { super(); fake.rooms.push(this); }
  }
  return { ...sdk, Room, createLocalAudioTrack: vi.fn(async () => { throw new Error("listen only"); }) };
});
import { createLocalAudioTrack, DisconnectReason, type LocalAudioTrack, RoomEvent, Track } from "livekit-client";
import { VoiceClient } from "./client";

function publication(source: Track.Source, sid = source as string) {
  const element = { dataset: {} as Record<string, string>, remove: vi.fn() };
  const attachedElements: typeof element[] = [];
  const track = { sid, kind: source === Track.Source.ScreenShare ? Track.Kind.Video : Track.Kind.Audio, stop: vi.fn(), attachedElements, attach: vi.fn(() => { attachedElements.push(element); return element; }), detach: vi.fn(() => attachedElements.splice(0)), setVolume: vi.fn() };
  return { source, trackSid: sid, track, isMuted: false, setSubscribed: vi.fn() };
}
type Publication = ReturnType<typeof publication>;
class Participant {
  name = "Amigo";
  isSpeaking = false;
  trackPublications = new Map<string, Publication>();
  constructor(public identity: string) {}
  get isScreenShareEnabled() { return !!this.getTrackPublication(Track.Source.ScreenShare); }
  getTrackPublication(source: Track.Source) { return [...this.trackPublications.values()].find(p => p.source === source); }
  setVolume = vi.fn((value: number, source: Track.Source) => { this.getTrackPublication(source)?.track.setVolume(value); });
  publishTrack = vi.fn(async () => {});
  setScreenShareEnabled = vi.fn(async (enabled: boolean) => {
    if (enabled) return;
    // SDK only removes the pair when the video publication still exists.
    if (!this.getTrackPublication(Track.Source.ScreenShare)) return;
    for (const source of [Track.Source.ScreenShare, Track.Source.ScreenShareAudio]) {
      const pub = this.getTrackPublication(source);
      if (pub) await this.unpublishTrack(pub.track);
    }
  });
  unpublishTrack = vi.fn(async (track: Publication["track"]) => {
    const pub = this.trackPublications.get(track.sid);
    if (!pub) return;
    track.stop();
    this.trackPublications.delete(pub.trackSid);
    fake.rooms.at(-1).emit(RoomEvent.LocalTrackUnpublished, pub, this);
  });
}
async function setup() {
  const voice = new VoiceClient(vi.fn());
  await voice.join("call");
  return { voice, room: fake.rooms.at(-1) as EventEmitter & { localParticipant: Participant; remoteParticipants: Map<string, Participant> } };
}
beforeEach(() => {
  fake.rooms.length = 0;
  vi.clearAllMocks();
  vi.stubGlobal("document", { querySelectorAll: () => [], body: { appendChild: vi.fn() } });
});

describe("independent conversation and screen audio", () => {
  it("silences voices while keeping the watched screen at its chosen volume", async () => {
    const { voice, participant, audio, mic } = await receiving();
    voice.setVolume(participant.identity, 0.6);
    voice.setStreamVolume(participant.identity, 0.35);
    await voice.toggleDeafen();
    expect(mic.track.setVolume).toHaveBeenLastCalledWith(0);
    expect(mic.setSubscribed).toHaveBeenLastCalledWith(false);
    expect(mic.track.attachedElements).toHaveLength(0);
    expect(audio.track.setVolume).toHaveBeenLastCalledWith(0.35);
    await voice.toggleDeafen();
    expect(mic.track.setVolume).toHaveBeenLastCalledWith(0.6);
    expect(audio.track.setVolume).toHaveBeenLastCalledWith(0.35);
    await voice.leave();
  });
  it("can start watching a newly published screen while voices are already silenced", async () => {
    const { voice, room } = await setup();
    await voice.toggleDeafen();
    const participant = new Participant("friend");
    const video = publication(Track.Source.ScreenShare), audio = publication(Track.Source.ScreenShareAudio), mic = publication(Track.Source.Microphone);
    for (const pub of [video, audio, mic]) participant.trackPublications.set(pub.trackSid, pub);
    room.remoteParticipants.set(participant.identity, participant);
    room.emit(RoomEvent.ParticipantConnected, participant);
    voice.setStreamVolume(participant.identity, 0.4);
    voice.watch(participant.identity);
    room.emit(RoomEvent.TrackSubscribed, audio.track, audio, participant);
    room.emit(RoomEvent.TrackSubscribed, mic.track, mic, participant);
    expect(audio.track.setVolume).toHaveBeenLastCalledWith(0.4);
    expect(mic.track.setVolume).toHaveBeenLastCalledWith(0);
    expect(mic.track.attach).not.toHaveBeenCalled();
    await voice.leave();
  });
  it("preserves a zero screen volume when conversation audio is toggled", async () => {
    const { voice, participant, video, audio, mic } = await receiving();
    voice.setStreamVolume(participant.identity, 0);
    await voice.toggleDeafen();
    await voice.toggleDeafen();
    expect(audio.track.setVolume).toHaveBeenLastCalledWith(0);
    expect(audio.setSubscribed).toHaveBeenLastCalledWith(false);
    expect(video.setSubscribed).toHaveBeenLastCalledWith(true);
    expect(mic.track.setVolume).toHaveBeenLastCalledWith(1);
    expect(voice.getSnapshot().prefs.streamVolumes[participant.identity]).toBe(0);
    await voice.leave();
  });
  it("never reopens the microphone when returning to conversation audio, while explicit unmute still works", async () => {
    const mic = { mute: vi.fn(async () => {}), unmute: vi.fn(async () => {}), stop: vi.fn(), getProcessor: vi.fn(), setProcessor: vi.fn(async () => {}) };
    vi.mocked(createLocalAudioTrack).mockResolvedValueOnce(mic as unknown as LocalAudioTrack);
    const { voice } = await setup();
    for (let cycle = 0; cycle < 3; cycle++) {
      await voice.toggleDeafen();
      await voice.toggleDeafen();
    }
    expect(voice.getSnapshot()).toMatchObject({ muted: true, deafened: false });
    expect(mic.unmute).not.toHaveBeenCalled();
    await voice.toggleMute();
    expect(mic.unmute).toHaveBeenCalledOnce();
    expect(voice.getSnapshot()).toMatchObject({ muted: false, deafened: false });
    await voice.leave();
  });
  it("reapplies separate levels after a media reconnection", async () => {
    const { voice, room, participant, audio, mic } = await receiving();
    voice.setStreamVolume(participant.identity, 0.25);
    await voice.toggleDeafen();
    audio.track.setVolume(1); mic.track.setVolume(1);
    room.emit(RoomEvent.Reconnecting);
    room.emit(RoomEvent.Reconnected);
    expect(audio.track.setVolume).toHaveBeenLastCalledWith(0.25);
    expect(mic.track.setVolume).toHaveBeenLastCalledWith(0);
    await voice.leave();
  });
  it("keeps screen audio separate after rejoining with a fresh room", async () => {
    vi.useFakeTimers();
    const { voice, room, participant, audio, mic } = await receiving();
    voice.setStreamVolume(participant.identity, 0.3);
    await voice.toggleDeafen();
    room.emit(RoomEvent.Disconnected, DisconnectReason.SIGNAL_CLOSE);
    await vi.advanceTimersByTimeAsync(1000);
    const recovered = fake.rooms.at(-1)!;
    expect(recovered).not.toBe(room);
    recovered.remoteParticipants.set(participant.identity, participant);
    recovered.emit(RoomEvent.ParticipantConnected, participant);
    voice.watch(participant.identity);
    expect(audio.track.setVolume).toHaveBeenLastCalledWith(0.3);
    expect(mic.track.setVolume).toHaveBeenLastCalledWith(0);
    expect(voice.getSnapshot()).toMatchObject({ status: "connected", deafened: true, muted: true });
    await voice.leave();
    vi.useRealTimers();
  });
  it("still cuts screen audio immediately when watching or transmission ends while voices are silenced", async () => {
    const { voice, room, participant, video, audio } = await receiving();
    await voice.toggleDeafen();
    voice.unwatch(participant.identity);
    expect(audio.track.setVolume).toHaveBeenLastCalledWith(0);
    voice.watch(participant.identity);
    expect(audio.track.setVolume).toHaveBeenLastCalledWith(1);
    participant.trackPublications.delete(video.trackSid);
    room.emit(RoomEvent.TrackUnpublished, video, participant);
    expect(audio.setSubscribed).toHaveBeenLastCalledWith(false);
    expect(audio.track.setVolume).toHaveBeenLastCalledWith(0);
    await voice.leave();
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("ending screen capture", () => {
  it("stops the paired audio when the browser ends only the video", async () => {
    const { voice, room } = await setup();
    const video = publication(Track.Source.ScreenShare), audio = publication(Track.Source.ScreenShareAudio);
    room.localParticipant.trackPublications.set(video.trackSid, video);
    room.localParticipant.trackPublications.set(audio.trackSid, audio);
    // The SDK removes this video before forwarding LocalTrackUnpublished.
    await room.localParticipant.unpublishTrack(video.track);
    expect(audio.track.stop).toHaveBeenCalled();
    expect(room.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio)).toBeUndefined();
    expect(voice.getSnapshot().screen).toBe(false);
    await voice.leave();
  });
  it("removes orphaned screen audio when stopping through the app", async () => {
    const { voice, room } = await setup();
    const audio = publication(Track.Source.ScreenShareAudio);
    room.localParticipant.trackPublications.set(audio.trackSid, audio);
    await voice.stopScreen();
    expect(audio.track.stop).toHaveBeenCalled();
    expect(room.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio)).toBeUndefined();
    await voice.leave();
  });
  it("stops a complete screen/audio pair without stopping the microphone", async () => {
    const { voice, room } = await setup();
    const video = publication(Track.Source.ScreenShare), audio = publication(Track.Source.ScreenShareAudio), mic = publication(Track.Source.Microphone);
    for (const pub of [video, audio, mic]) room.localParticipant.trackPublications.set(pub.trackSid, pub);
    await voice.stopScreen();
    expect(video.track.stop).toHaveBeenCalled();
    expect(audio.track.stop).toHaveBeenCalled();
    expect(mic.track.stop).not.toHaveBeenCalled();
    expect(room.localParticipant.getTrackPublication(Track.Source.Microphone)).toBe(mic);
    await voice.leave();
  });
  it("cleans up audio that finishes publishing after the video has ended", async () => {
    const { voice, room } = await setup();
    const video = publication(Track.Source.ScreenShare), audio = publication(Track.Source.ScreenShareAudio);
    room.localParticipant.setScreenShareEnabled.mockImplementationOnce(async () => {
      room.localParticipant.trackPublications.set(video.trackSid, video);
      await room.localParticipant.unpublishTrack(video.track);
      room.localParticipant.trackPublications.set(audio.trackSid, audio);
      room.emit(RoomEvent.LocalTrackPublished, audio, room.localParticipant);
    });
    voice.setScreenAudio(true);
    await voice.startScreen();
    expect(audio.track.stop).toHaveBeenCalled();
    expect(room.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio)).toBeUndefined();
    expect(voice.getSnapshot().screen).toBe(false);
    await voice.leave();
  });
});

async function receiving() {
  const { voice, room } = await setup();
  const participant = new Participant("friend");
  const video = publication(Track.Source.ScreenShare), audio = publication(Track.Source.ScreenShareAudio), mic = publication(Track.Source.Microphone);
  for (const pub of [video, audio, mic]) participant.trackPublications.set(pub.trackSid, pub);
  room.remoteParticipants.set(participant.identity, participant);
  room.emit(RoomEvent.ParticipantConnected, participant);
  voice.watch(participant.identity);
  room.emit(RoomEvent.TrackSubscribed, audio.track, audio, participant);
  return { voice, room, participant, video, audio, mic };
}

describe("receiving screen audio", () => {
  it("silences and detaches audio immediately when only screen video is unpublished", async () => {
    const { voice, room, participant, video, audio, mic } = await receiving();
    participant.trackPublications.delete(video.trackSid);
    room.emit(RoomEvent.TrackUnpublished, video, participant);
    expect(audio.setSubscribed).toHaveBeenLastCalledWith(false);
    expect(audio.track.setVolume).toHaveBeenLastCalledWith(0);
    expect(audio.track.detach).toHaveBeenCalled();
    expect(audio.track.attach.mock.results[0]!.value.remove).toHaveBeenCalled();
    expect(mic.setSubscribed).toHaveBeenLastCalledWith(true);
    expect(mic.track.setVolume).toHaveBeenLastCalledWith(1);
    expect(mic.track.detach).not.toHaveBeenCalled();
    expect(voice.getSnapshot().videos).toEqual([]);
    await voice.leave();
  });
  it("does not attach a late audio subscription after the user stops watching", async () => {
    const { voice, room, participant, audio } = await receiving();
    voice.unwatch(participant.identity);
    audio.track.attach.mockClear();
    room.emit(RoomEvent.TrackSubscribed, audio.track, audio, participant);
    expect(audio.track.attach).not.toHaveBeenCalled();
    expect(audio.track.setVolume).toHaveBeenLastCalledWith(0);
    await voice.leave();
  });
  it("keeps orphaned audio silent through volume changes and a new screen until explicitly watched", async () => {
    const { voice, room, participant, video, audio } = await receiving();
    participant.trackPublications.delete(video.trackSid);
    room.emit(RoomEvent.TrackUnpublished, video, participant);
    voice.setStreamVolume(participant.identity, 0.25);
    expect(audio.track.setVolume).toHaveBeenLastCalledWith(0);
    const next = publication(Track.Source.ScreenShare, "next-screen");
    participant.trackPublications.set(next.trackSid, next);
    room.emit(RoomEvent.TrackPublished, next, participant);
    expect(audio.setSubscribed).toHaveBeenLastCalledWith(false);
    voice.watch(participant.identity);
    expect(audio.setSubscribed).toHaveBeenLastCalledWith(true);
    expect(audio.track.setVolume).toHaveBeenLastCalledWith(0.25);
    await voice.leave();
  });
  it("stops screen audio on mute and does not resume automatically on unmute", async () => {
    const { voice, room, participant, video, audio } = await receiving();
    video.isMuted = true;
    room.emit(RoomEvent.TrackMuted, video, participant);
    expect(audio.setSubscribed).toHaveBeenLastCalledWith(false);
    expect(audio.track.setVolume).toHaveBeenLastCalledWith(0);
    video.isMuted = false;
    room.emit(RoomEvent.TrackUnmuted, video, participant);
    expect(audio.track.setVolume).toHaveBeenLastCalledWith(0);
    voice.watch(participant.identity);
    expect(audio.track.setVolume).toHaveBeenLastCalledWith(1);
    await voice.leave();
  });
  it("reattaches audio if watching resumes before the unsubscribe acknowledgement", async () => {
    const { voice, participant, audio } = await receiving();
    voice.unwatch(participant.identity);
    expect(audio.track.attachedElements).toHaveLength(0);
    voice.watch(participant.identity);
    expect(audio.track.attachedElements).toHaveLength(1);
    expect(audio.track.setVolume).toHaveBeenLastCalledWith(1);
    await voice.leave();
  });
});
