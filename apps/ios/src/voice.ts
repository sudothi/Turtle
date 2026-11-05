import { AudioSession } from "@livekit/react-native";
import { ConnectionQuality, DisconnectReason, RemoteAudioTrack, Room, RoomEvent, Track, type Participant } from "livekit-client";
import type { Api } from "./api";
import type { VoiceReport } from "./gateway";

export interface CallMember { id: string; name: string; muted: boolean; speaking: boolean; quality: string; local: boolean }
export interface VoiceSnapshot {
  status: "idle" | "connecting" | "connected" | "reconnecting" | "leaving";
  channelId: string | null;
  channelName: string;
  muted: boolean;
  deafened: boolean;
  members: CallMember[];
  error?: string;
  busy: boolean;
}
const initial = (): VoiceSnapshot => ({ status: "idle", channelId: null, channelName: "", muted: true, deafened: false, members: [], busy: false });

/** Owned by the session, never by the visible call screen. Native SDK manages AVAudioSession. */
export class Voice {
  private room?: Room;
  private generation = 0;
  private joining?: Promise<void>;
  private leaving?: Promise<void>;
  private state = initial();
  private listeners = new Set<() => void>();
  constructor(private readonly api: Pick<Api, "voiceToken">, private readonly report: (value: VoiceReport) => void, private readonly active: () => boolean) {}
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = () => this.state;
  private set(patch: Partial<VoiceSnapshot>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(fn => fn());
    this.report({ t: "voice", channelId: this.state.status === "connected" || this.state.status === "reconnecting" ? this.state.channelId : null, muted: this.state.muted, deafened: this.state.deafened, camera: false, screen: false });
  }
  private refresh = () => {
    if (!this.room) return;
    const room = this.room;
    const members = [room.localParticipant, ...room.remoteParticipants.values()].map((p: Participant): CallMember => ({
      id: p.identity,
      name: p.name || p.identity,
      local: p === room.localParticipant,
      muted: !p.isMicrophoneEnabled,
      speaking: p.isSpeaking,
      quality: p.connectionQuality === ConnectionQuality.Poor ? "Sinal fraco" : p.connectionQuality === ConnectionQuality.Lost ? "Sem sinal" : "",
    }));
    this.set({ members, muted: !room.localParticipant.isMicrophoneEnabled });
  };

  join(channelId: string, channelName: string, microphone: boolean) {
    if (this.state.status !== "idle") return Promise.resolve();
    const generation = ++this.generation;
    this.set({ ...initial(), status: "connecting", channelId, channelName });
    const task = this.connect(generation, channelId, microphone);
    this.joining = task;
    return task;
  }

  private async connect(generation: number, channelId: string, microphone: boolean) {
    let room: Room | undefined;
    try {
      const token = await this.api.voiceToken(channelId);
      if (generation !== this.generation) return;
      await AudioSession.configureAudio({ ios: { defaultOutput: "speaker" } });
      await AudioSession.setDefaultRemoteAudioTrackVolume(1);
      await AudioSession.startAudioSession();
      if (generation !== this.generation) return;
      room = new Room({ adaptiveStream: true, dynacast: true, audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, publishDefaults: { dtx: true } });
      this.room = room;
      for (const event of [RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.ActiveSpeakersChanged, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted, RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished, RoomEvent.ConnectionQualityChanged]) room.on(event, this.refresh);
      room.on(RoomEvent.TrackSubscribed, track => {
        if (track.kind === Track.Kind.Audio && track instanceof RemoteAudioTrack) track.setVolume(this.state.deafened ? 0 : 1);
        this.refresh();
      });
      room.on(RoomEvent.TrackPublished, publication => {
        if (publication.kind === Track.Kind.Audio && publication.source === Track.Source.Microphone) publication.setSubscribed(true);
      });
      room.on(RoomEvent.Reconnecting, () => this.set({ status: "reconnecting" }));
      room.on(RoomEvent.Reconnected, () => { this.set({ status: "connected" }); this.refresh(); });
      room.on(RoomEvent.Disconnected, reason => {
        if (generation !== this.generation) return;
        const message = reason === DisconnectReason.DUPLICATE_IDENTITY ? "Sua conta entrou na chamada em outro aparelho." : "A chamada foi encerrada. Entre novamente para continuar.";
        void this.leave(message);
      });
      await room.connect(token.url, token.token, { autoSubscribe: false });
      if (generation !== this.generation) return;
      for (const participant of room.remoteParticipants.values()) for (const publication of participant.trackPublications.values()) {
        if (publication.kind === Track.Kind.Audio && publication.source === Track.Source.Microphone) publication.setSubscribed(true);
      }
      this.set({ status: "connected" });
      if (microphone && this.active()) {
        try { await room.localParticipant.setMicrophoneEnabled(true); }
        catch { this.set({ error: "Microfone indisponível. Você está só ouvindo. Confira a permissão do Turtle nos Ajustes." }); }
      }
      if (generation === this.generation) this.refresh();
    } catch (error) {
      if (generation !== this.generation) return;
      room?.removeAllListeners();
      await room?.disconnect().catch(() => {});
      this.room = undefined;
      await AudioSession.stopAudioSession().catch(() => {});
      // Backend errors are handled by the caller (including a revoked session).
      this.set({ ...initial(), error: "Não foi possível entrar na chamada. Confira sua conexão e tente novamente." });
      throw error;
    }
  }

  leave(error?: string): Promise<void> {
    if (this.leaving) return this.leaving;
    ++this.generation;
    this.set({ status: "leaving", muted: true, error });
    const room = this.room;
    this.room = undefined;
    room?.removeAllListeners();
    const task = (async () => {
      await room?.disconnect().catch(() => {});
      await this.joining?.catch(() => {});
      await AudioSession.stopAudioSession().catch(() => {});
      this.set({ ...initial(), error });
    })();
    this.leaving = task;
    void task.finally(() => { this.leaving = undefined; });
    return task;
  }

  async toggleMute() {
    const room = this.room;
    if (!room || this.state.status !== "connected" || this.state.busy || this.state.deafened || !this.active()) return;
    this.set({ busy: true, error: undefined });
    try { await room.localParticipant.setMicrophoneEnabled(this.state.muted); }
    catch { this.set({ error: "Não foi possível mudar o microfone. Confira a permissão nos Ajustes." }); }
    finally { if (this.room === room) { this.refresh(); this.set({ busy: false }); } }
  }

  async toggleDeafened() {
    const room = this.room;
    if (!room || this.state.status !== "connected" || this.state.busy) return;
    const deafened = !this.state.deafened;
    this.set({ busy: true, error: undefined });
    try {
      // Deafening always mutes capture; returning to listening never reopens the mic.
      if (deafened) await room.localParticipant.setMicrophoneEnabled(false);
      await AudioSession.setDefaultRemoteAudioTrackVolume(deafened ? 0 : 1);
      for (const participant of room.remoteParticipants.values()) for (const publication of participant.audioTrackPublications.values()) {
        if (publication.track instanceof RemoteAudioTrack) publication.track.setVolume(deafened ? 0 : 1);
      }
      this.set({ deafened });
    } catch { this.set({ error: "Não foi possível alterar o áudio. Tente novamente." }); }
    finally { if (this.room === room) { this.refresh(); this.set({ busy: false }); } }
  }
}
