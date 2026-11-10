import { AudioSession, type VideoTrackProps } from "@livekit/react-native";
import { ConnectionQuality, DisconnectReason, RemoteAudioTrack, Room, RoomEvent, Track, LocalVideoTrack, type Participant } from "livekit-client";
import type { Api } from "./api";
import type { VoiceReport } from "./gateway";

export interface CallMember { id: string; name: string; muted: boolean; speaking: boolean; quality: string; local: boolean; volume: number; video?: VideoTrackProps["trackRef"] }
export interface SharedScreen { id: string; name: string; participantId: string; watching: boolean; video?: VideoTrackProps["trackRef"]; volume: number }
export interface VoiceSnapshot {
  status: "idle" | "connecting" | "connected" | "reconnecting" | "leaving";
  channelId: string | null;
  channelName: string;
  muted: boolean;
  deafened: boolean;
  members: CallMember[];
  error?: string;
  busy: boolean;
  camera: boolean;
  facing: "user" | "environment";
  screens: SharedScreen[];
}
const initial = (): VoiceSnapshot => ({ status: "idle", channelId: null, channelName: "", muted: true, deafened: false, members: [], busy: false, camera: false, facing: "user", screens: [] });

/** Owned by the session, never by the visible call screen. Native SDK manages AVAudioSession. */
export class Voice {
  private room?: Room;
  private videoVisible = false;
  private watching = new Set<string>();
  private volumes = new Map<string, { voice: number; screen: number }>();
  private generation = 0;
  private captureGeneration = 0;
  private interrupted = false;
  private retry?: ReturnType<typeof setTimeout>;
  private recoveringSince = 0;
  private attempts = 0;
  private recoveryMicrophone = false;
  private joining?: Promise<void>;
  private leaving?: Promise<void>;
  private state = initial();
  private listeners = new Set<() => void>();
  constructor(private readonly api: Pick<Api, "voiceToken">, private readonly report: (value: VoiceReport) => void, private readonly active: () => boolean, private readonly expired: (error: unknown) => void = () => {}) {}
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = () => this.state;
  clearError = () => this.set({ error: undefined });
  private set(patch: Partial<VoiceSnapshot>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(fn => fn());
    this.report({ t: "voice", channelId: this.state.status === "connected" || this.state.status === "reconnecting" ? this.state.channelId : null, muted: this.state.muted, deafened: this.state.deafened, camera: this.state.camera, screen: false });
  }
  private refresh = () => {
    if (!this.room) return;
    const room = this.room;
    const members = [room.localParticipant, ...room.remoteParticipants.values()].map((p: Participant): CallMember => ({
      video: this.videoReference(p, Track.Source.Camera),
      volume: this.volumes.get(p.identity)?.voice ?? 1,
      id: p.identity,
      name: p.name || p.identity,
      local: p === room.localParticipant,
      muted: !p.isMicrophoneEnabled,
      speaking: p.isSpeaking,
      quality: p.connectionQuality === ConnectionQuality.Poor ? "Sinal fraco" : p.connectionQuality === ConnectionQuality.Lost ? "Sem sinal" : "",
    }));
    const screens = [...room.remoteParticipants.values()].flatMap(p => {
      const publication = p.getTrackPublication(Track.Source.ScreenShare);
      if (!publication || publication.isMuted) return [];
      return [{ id: publication.trackSid, name: p.name || p.identity, participantId: p.identity, watching: this.watching.has(publication.trackSid), video: this.videoReference(p, Track.Source.ScreenShare), volume: this.volumes.get(p.identity)?.screen ?? 1 }];
    });
    this.set({ members, screens, muted: !room.localParticipant.isMicrophoneEnabled, camera: room.localParticipant.isCameraEnabled });
  };

  join(channelId: string, channelName: string, microphone: boolean) {
    if (this.state.status !== "idle") return Promise.resolve();
    const generation = ++this.generation;
    this.set({ ...initial(), status: "connecting", channelId, channelName });
    const task = this.connect(generation, channelId, microphone);
    this.joining = task;
    return task;
  }

  private async connect(generation: number, channelId: string, microphone: boolean, recovering = false) {
    const captureGeneration = this.captureGeneration;
    let room: Room | undefined;
    try {
      const token = await this.api.voiceToken(channelId);
      if (generation !== this.generation) return;
      await AudioSession.configureAudio({ ios: { defaultOutput: "speaker" } });
      await AudioSession.setDefaultRemoteAudioTrackVolume(this.state.deafened ? 0 : 1);
      await AudioSession.startAudioSession();
      if (generation !== this.generation) return;
      room = new Room({ adaptiveStream: true, dynacast: true, audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, videoCaptureDefaults: { facingMode: "user", resolution: { width: 1280, height: 720, frameRate: 30 } }, publishDefaults: { dtx: true, videoCodec: "h264" } });
      this.room = room;
      for (const event of [RoomEvent.ActiveSpeakersChanged, RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished, RoomEvent.TrackUnsubscribed, RoomEvent.ConnectionQualityChanged]) room.on(event, this.refresh);
      for (const event of [RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted, RoomEvent.TrackPublished, RoomEvent.TrackUnpublished, RoomEvent.TrackSubscribed]) room.on(event, () => {
        if (this.room !== room) return;
        this.syncSubscriptions();
        this.refresh();
      });
      room.on(RoomEvent.Reconnecting, () => this.set({ status: "reconnecting" }));
      room.on(RoomEvent.Reconnected, () => { this.set({ status: "connected" }); this.refresh(); });
      room.on(RoomEvent.Disconnected, reason => {
        if (generation !== this.generation || this.state.status === "connecting") return;
        const terminal = [DisconnectReason.CLIENT_INITIATED, DisconnectReason.PARTICIPANT_REMOVED, DisconnectReason.DUPLICATE_IDENTITY, DisconnectReason.ROOM_DELETED].includes(reason!);
        if (terminal) { void this.leave(reason === DisconnectReason.DUPLICATE_IDENTITY ? "Sua conta entrou na chamada em outro aparelho." : "A chamada foi encerrada."); return; }
        room?.removeAllListeners();
        this.room = undefined;
        if (!this.recoveringSince) { this.recoveryMicrophone = !this.state.muted && !this.state.deafened; this.recoveringSince = Date.now(); this.attempts = 0; }
        this.scheduleRecovery(generation, channelId);
      });
      await room.connect(token.url, token.token, { autoSubscribe: false });
      if (generation !== this.generation) return;
      this.syncSubscriptions();
      this.recoveringSince = 0;
      this.set({ status: "connected", error: undefined });
      if (microphone && this.active() && !this.interrupted && captureGeneration === this.captureGeneration) {
        try { await room.localParticipant.setMicrophoneEnabled(true); }
        catch { this.set({ error: "Microfone indisponível. Você está só ouvindo. Confira a permissão do Turtle nos Ajustes." }); }
        if (captureGeneration !== this.captureGeneration) await room.localParticipant.setMicrophoneEnabled(false);
      }
      if (generation === this.generation) this.refresh();
    } catch (error) {
      if (generation !== this.generation) return;
      room?.removeAllListeners();
      await room?.disconnect().catch(() => {});
      this.room = undefined;
      await AudioSession.stopAudioSession().catch(() => {});
      // Backend errors are handled by the caller (including a revoked session).
      this.set(recovering ? { status: "reconnecting", busy: false, members: [] } : { ...initial(), error: "Não foi possível entrar na chamada. Confira sua conexão e tente novamente." });
      throw error;
    }
  }

  private scheduleRecovery(generation: number, channelId: string) {
    if (generation !== this.generation || this.retry) return;
    this.set({ status: "reconnecting", members: [], busy: false, camera: false, facing: "user", screens: [] });
    const remaining = 120_000 - (Date.now() - this.recoveringSince);
    if (remaining <= 0) { void this.leave("Não foi possível recuperar a chamada. Entre novamente para continuar."); return; }
    this.retry = setTimeout(() => {
      this.retry = undefined;
      if (generation !== this.generation) return;
      if (Date.now() - this.recoveringSince >= 120_000) { void this.leave("Não foi possível recuperar a chamada. Entre novamente para continuar."); return; }
      const task = this.connect(generation, channelId, this.recoveryMicrophone, true);
      this.joining = task;
      void task.catch(error => {
        if (generation !== this.generation) return;
        if (typeof error === "object" && error && "status" in error && [401, 403, 404].includes(Number(error.status))) {
          void this.leave("Você não tem mais acesso à chamada. Entre novamente para conferir sua sessão.");
          if (Number(error.status) === 401) this.expired(error);
        } else this.scheduleRecovery(generation, channelId);
      });
    }, Math.min(remaining, 1_000 * 2 ** Math.min(this.attempts++, 4)));
  }

  leave(error?: string): Promise<void> {
    if (this.leaving) return this.leaving;
    ++this.generation;
    ++this.captureGeneration;
    this.interrupted = false;
    this.watching.clear(); this.volumes.clear();
    clearTimeout(this.retry); this.retry = undefined;
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

  private videoReference(participant: Participant, source: Track.Source): VideoTrackProps["trackRef"] {
    const publication = participant.getTrackPublication(source);
    return publication?.videoTrack ? { participant, publication, source } : undefined;
  }

  private syncSubscriptions() {
    const activeScreens = new Set([...(this.room?.remoteParticipants.values() ?? [])].flatMap(participant => {
      const screen = participant.getTrackPublication(Track.Source.ScreenShare);
      return screen && !screen.isMuted ? [screen.trackSid] : [];
    }));
    for (const id of this.watching) if (!activeScreens.has(id)) this.watching.delete(id);
    for (const participant of this.room?.remoteParticipants.values() ?? []) {
      for (const publication of participant.trackPublications.values()) {
        const subscribed = publication.source === Track.Source.Microphone || this.videoVisible && this.active() && (
          publication.source === Track.Source.Camera || (publication.source === Track.Source.ScreenShare || publication.source === Track.Source.ScreenShareAudio) && this.isWatching(participant)
        );
        publication.setSubscribed(subscribed);
      }
    }
    this.applyVolumes();
  }
  private isWatching(participant: Participant) {
    const screen = participant.getTrackPublication(Track.Source.ScreenShare);
    return this.videoVisible && this.active() && !!screen && !screen.isMuted && this.watching.has(screen.trackSid);
  }
  foreground() { this.syncSubscriptions(); }
  setVideoVisible(visible: boolean) { this.videoVisible = visible; this.syncSubscriptions(); }
  watchScreen(id: string, watching: boolean) {
    if (this.state.status !== "connected") return;
    if (watching) this.watching.add(id); else this.watching.delete(id);
    this.syncSubscriptions(); this.refresh();
  }
  private applyVolumes() {
    for (const participant of this.room?.remoteParticipants.values() ?? []) for (const publication of participant.audioTrackPublications.values()) {
      if (publication.track instanceof RemoteAudioTrack) {
        const values = this.volumes.get(participant.identity);
        const screenAudio = publication.source === Track.Source.ScreenShareAudio;
        publication.track.setVolume(this.state.deafened || screenAudio && !this.isWatching(participant) ? 0 : screenAudio ? values?.screen ?? 1 : values?.voice ?? 1);
      }
    }
  }
  setVolume(id: string, kind: "voice" | "screen", value: number) {
    const volumes = this.volumes.get(id) ?? { voice: 1, screen: 1 };
    this.volumes.set(id, { ...volumes, [kind]: Math.max(0, Math.min(2, value)) });
    this.applyVolumes(); this.refresh();
  }
  async toggleCamera() {
    const room = this.room;
    if (!room || this.state.busy || this.state.status !== "connected" || !this.active() || this.interrupted) return;
    this.set({ busy: true, error: undefined });
    const captureGeneration = this.captureGeneration;
    try {
      await room.localParticipant.setCameraEnabled(!this.state.camera, { facingMode: this.state.facing });
      if (!this.active() || captureGeneration !== this.captureGeneration) await room.localParticipant.setCameraEnabled(false);
    } catch { this.set({ error: "Não foi possível abrir a câmera. Confira a permissão do Turtle nos Ajustes." }); }
    finally { if (this.room === room) { this.refresh(); this.set({ busy: false }); } }
  }
  async flipCamera() {
    const room = this.room;
    const track = room?.localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack;
    if (!room || !(track instanceof LocalVideoTrack) || this.state.busy || !this.active() || this.interrupted) return;
    const facing = this.state.facing === "user" ? "environment" : "user";
    const captureGeneration = this.captureGeneration;
    this.set({ busy: true, error: undefined });
    try { await track.restartTrack({ facingMode: facing }); this.set({ facing }); }
    catch { this.set({ error: "Não foi possível trocar a câmera." }); }
    finally { if (this.room === room) { if (!this.active() || captureGeneration !== this.captureGeneration) await room.localParticipant.setCameraEnabled(false).catch(() => {}); this.refresh(); this.set({ busy: false }); } }
  }
  async background() {
    ++this.captureGeneration;
    this.watching.clear();
    this.syncSubscriptions();
    const room = this.room;
    if (room?.localParticipant.isCameraEnabled) {
      await room.localParticipant.setCameraEnabled(false).catch(() => {});
      if (this.room === room) this.refresh();
    }
  }

  async interrupt() {
    this.interrupted = true;
    ++this.captureGeneration;
    this.recoveryMicrophone = false;
    const room = this.room;
    this.set({ muted: true, error: "Áudio interrompido pelo iOS. Ao retornar, o microfone continuará fechado." });
    await this.background();
    if (room) await room.localParticipant.setMicrophoneEnabled(false);
    if (this.room === room) this.refresh();
  }

  interruptionEnded() { this.interrupted = false; }

  async toggleMute() {
    const room = this.room;
    if (!room || this.state.status !== "connected" || this.state.busy || this.state.deafened || !this.active() || this.interrupted) return;
    this.set({ busy: true, error: undefined });
    const captureGeneration = this.captureGeneration;
    try {
      await room.localParticipant.setMicrophoneEnabled(this.state.muted);
      if (this.interrupted || captureGeneration !== this.captureGeneration) await room.localParticipant.setMicrophoneEnabled(false);
    }
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
      this.set({ deafened });
      this.applyVolumes();
    } catch { this.set({ error: "Não foi possível alterar o áudio. Tente novamente." }); }
    finally { if (this.room === room) { this.refresh(); this.set({ busy: false }); } }
  }
}
