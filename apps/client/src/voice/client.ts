import {
  ConnectionQuality,
  createLocalAudioTrack,
  DisconnectReason,
  type LocalAudioTrack,
  type Participant,
  RemoteTrack,
  Room,
  RoomEvent,
  Track,
} from "livekit-client";
import { api } from "../api";
import { loadPrefs, micConstraints, savePrefs, type AudioPrefs, type NoiseMode } from "./prefs";
import { preloadRnnoise, RnnoiseProcessor } from "./rnnoise";

export interface CallParticipant {
  id: string;
  name: string;
  isLocal: boolean;
  speaking: boolean;
  muted: boolean;
  quality: "excellent" | "good" | "poor" | "lost" | "unknown";
}

export interface VoiceSnapshot {
  status: "idle" | "connecting" | "connected" | "reconnecting";
  channelId?: string;
  muted: boolean;
  deafened: boolean;
  participants: CallParticipant[];
  /** O navegador bloqueou o som até um clique (autoplay). */
  needsAudioUnlock: boolean;
  error?: string;
  prefs: AudioPrefs;
}

/** Avisa o gateway onde estamos, para a barra lateral de todo mundo. */
export type VoiceReporter = (channelId: string | null, muted: boolean, deafened: boolean) => void;

const qualityName = (q: ConnectionQuality): CallParticipant["quality"] =>
  q === ConnectionQuality.Excellent ? "excellent" : q === ConnectionQuality.Good ? "good" : q === ConnectionQuality.Poor ? "poor" : q === ConnectionQuality.Lost ? "lost" : "unknown";

const disconnectMessage = (reason?: DisconnectReason) => {
  switch (reason) {
    case DisconnectReason.DUPLICATE_IDENTITY:
      return "Você entrou na chamada em outro lugar.";
    case DisconnectReason.PARTICIPANT_REMOVED:
      return "Você foi removido da chamada.";
    case DisconnectReason.SERVER_SHUTDOWN:
      return "O servidor de voz reiniciou.";
    case DisconnectReason.JOIN_FAILURE:
    case DisconnectReason.SIGNAL_CLOSE:
      return "Conexão com o servidor de voz caiu.";
    default:
      return undefined;
  }
};

/**
 * Uma chamada de voz por vez. A UI lê o estado com useSyncExternalStore.
 * Áudio: Opus 48 kHz mono, 64 kb/s, DTX (não manda nada no silêncio) e RED (redundância contra perda de pacote).
 */
export class VoiceClient {
  private room?: Room;
  private mic?: LocalAudioTrack;
  private listeners = new Set<() => void>();
  private snap: VoiceSnapshot = { status: "idle", muted: false, deafened: false, participants: [], needsAudioUnlock: false, prefs: loadPrefs() };
  private joinSeq = 0;

  constructor(private report: VoiceReporter) {}

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.snap;

  private set(patch: Partial<VoiceSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    for (const fn of this.listeners) fn();
  }

  /** Reenvia o estado ao gateway (ex.: depois que o WebSocket reconecta). */
  resendState() {
    const { channelId, status, muted, deafened } = this.snap;
    if (channelId && status !== "idle") this.report(channelId, muted, deafened);
  }

  async join(channelId: string) {
    if (this.snap.channelId === channelId && this.snap.status !== "idle") return;
    if (this.room) await this.leave();
    const seq = ++this.joinSeq;
    const prefs = this.snap.prefs;
    this.set({ status: "connecting", channelId, error: undefined, participants: [] });
    if (prefs.noise === "rnnoise") void preloadRnnoise().catch(() => {});

    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      disconnectOnPageLeave: true,
      audioCaptureDefaults: micConstraints(prefs),
      audioOutput: { deviceId: prefs.outputId },
      publishDefaults: { audioPreset: { maxBitrate: 64_000 }, dtx: true, red: true, forceStereo: false },
    });
    this.room = room;
    this.wire(room);

    try {
      // Token + conexão e microfone em paralelo: entrar fica abaixo de ~1 s numa rede boa.
      const connecting = api.voiceToken(channelId).then(({ url, token }) => room.connect(url, token));
      const micPromise = createLocalAudioTrack(micConstraints(prefs)).catch((err: Error) => err);
      await connecting;
      const mic = await micPromise;
      if (seq !== this.joinSeq) {
        if (!(mic instanceof Error)) mic.stop();
        return;
      }
      for (const p of room.remoteParticipants.values()) p.setVolume(this.volumeFor(p.identity));
      this.set({ status: "connected" });
      this.report(channelId, this.snap.muted, this.snap.deafened);

      if (mic instanceof Error) {
        this.set({ muted: true, error: `Sem acesso ao microfone (${mic.message}). Confira a permissão e o dispositivo nas configurações.` });
        this.report(channelId, true, this.snap.deafened);
      } else {
        this.mic = mic;
        await room.localParticipant.publishTrack(mic, { source: Track.Source.Microphone });
        if (this.snap.muted) await mic.mute();
        await this.applyNoise(prefs.noise);
      }
      this.refresh();
    } catch (err) {
      if (seq !== this.joinSeq) return;
      this.mic?.stop();
      this.mic = undefined;
      this.room = undefined;
      await room.disconnect();
      this.set({ status: "idle", channelId: undefined, participants: [], error: `Não deu para entrar na chamada: ${(err as Error).message}` });
      this.report(null, this.snap.muted, this.snap.deafened);
    }
  }

  async leave() {
    this.joinSeq++;
    const room = this.room;
    this.room = undefined;
    this.mic?.stop();
    this.mic = undefined;
    this.set({ status: "idle", channelId: undefined, participants: [], needsAudioUnlock: false });
    this.report(null, this.snap.muted, this.snap.deafened);
    await room?.disconnect();
  }

  async toggleMute() {
    // Desmutar também tira o ensurdecer, como no Discord.
    const muted = !this.snap.muted;
    const deafened = muted ? this.snap.deafened : false;
    await this.setMuteDeaf(muted, deafened);
  }

  async toggleDeafen() {
    // Ensurdecer também muta; sair do ensurdecer volta a falar.
    const deafened = !this.snap.deafened;
    await this.setMuteDeaf(deafened, deafened);
  }

  private async setMuteDeaf(muted: boolean, deafened: boolean) {
    this.set({ muted, deafened });
    if (this.mic) await (muted ? this.mic.mute() : this.mic.unmute());
    else if (!muted && this.room) {
      // Entrou sem microfone: tenta de novo agora.
      try {
        const mic = await createLocalAudioTrack(micConstraints(this.snap.prefs));
        this.mic = mic;
        await this.room.localParticipant.publishTrack(mic, { source: Track.Source.Microphone });
        await this.applyNoise(this.snap.prefs.noise);
        this.set({ error: undefined });
      } catch (err) {
        this.set({ muted: true, error: `Sem acesso ao microfone (${(err as Error).message}).` });
      }
    }
    this.applyVolumes();
    if (this.snap.channelId) this.report(this.snap.channelId, this.snap.muted, this.snap.deafened);
    this.refresh();
  }

  async setInput(inputId: string) {
    this.savePrefs({ inputId });
    if (this.mic) await this.mic.restartTrack(micConstraints(this.snap.prefs));
  }

  async setOutput(outputId: string) {
    this.savePrefs({ outputId });
    if (this.room) await this.room.switchActiveDevice("audiooutput", outputId);
  }

  async setNoise(noise: NoiseMode) {
    this.savePrefs({ noise });
    if (!this.mic) return;
    await this.mic.restartTrack(micConstraints(this.snap.prefs));
    await this.applyNoise(noise);
  }

  setVolume(userId: string, volume: number) {
    this.savePrefs({ volumes: { ...this.snap.prefs.volumes, [userId]: volume } });
    this.applyVolumes();
  }

  async unlockAudio() {
    await this.room?.startAudio();
  }

  private savePrefs(patch: Partial<AudioPrefs>) {
    const prefs = { ...this.snap.prefs, ...patch };
    savePrefs(prefs);
    this.set({ prefs });
  }

  private volumeFor(userId: string) {
    return this.snap.deafened ? 0 : (this.snap.prefs.volumes[userId] ?? 1);
  }

  private applyVolumes() {
    if (!this.room) return;
    for (const p of this.room.remoteParticipants.values()) p.setVolume(this.volumeFor(p.identity));
  }

  private async applyNoise(noise: NoiseMode) {
    const mic = this.mic;
    if (!mic) return;
    try {
      if (noise === "rnnoise") await mic.setProcessor(new RnnoiseProcessor());
      else if (mic.getProcessor()) await mic.stopProcessor();
    } catch (err) {
      // Sem RNNoise a chamada continua com a supressão do navegador desligada; avisa.
      console.warn("RNNoise falhou", err);
      this.set({ error: "Não deu para ligar o RNNoise; usando o microfone sem filtro." });
    }
  }

  private wire(room: Room) {
    const refresh = () => this.room === room && this.refresh();
    room
      .on(RoomEvent.ParticipantConnected, (p) => {
        p.setVolume(this.volumeFor(p.identity));
        refresh();
      })
      .on(RoomEvent.ParticipantDisconnected, refresh)
      .on(RoomEvent.ActiveSpeakersChanged, refresh)
      .on(RoomEvent.TrackMuted, refresh)
      .on(RoomEvent.TrackUnmuted, refresh)
      .on(RoomEvent.TrackPublished, refresh)
      .on(RoomEvent.TrackUnpublished, refresh)
      .on(RoomEvent.LocalTrackPublished, refresh)
      .on(RoomEvent.ConnectionQualityChanged, refresh)
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, p) => {
        if (track.kind !== Track.Kind.Audio) return;
        const el = track.attach();
        el.dataset.turtleAudio = track.sid ?? p.identity;
        document.body.appendChild(el);
        p.setVolume(this.volumeFor(p.identity));
        refresh();
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        // Quando a pessoa sai, o LiveKit já desanexou o elemento; remove pelo sid também.
        for (const el of track.detach()) el.remove();
        for (const el of document.querySelectorAll(`audio[data-turtle-audio="${track.sid}"]`)) el.remove();
        refresh();
      })
      .on(RoomEvent.AudioPlaybackStatusChanged, () => {
        if (this.room === room) this.set({ needsAudioUnlock: !room.canPlaybackAudio });
      })
      .on(RoomEvent.Reconnecting, () => this.room === room && this.set({ status: "reconnecting" }))
      .on(RoomEvent.Reconnected, () => {
        if (this.room !== room) return;
        this.set({ status: "connected" });
        this.resendState();
      })
      .on(RoomEvent.Disconnected, (reason) => {
        for (const el of document.querySelectorAll("audio[data-turtle-audio]")) el.remove();
        if (this.room !== room) return;
        this.room = undefined;
        this.mic?.stop();
        this.mic = undefined;
        this.set({ status: "idle", channelId: undefined, participants: [], needsAudioUnlock: false, error: disconnectMessage(reason) });
        this.report(null, this.snap.muted, this.snap.deafened);
      });
  }

  private refresh() {
    const room = this.room;
    if (!room) return;
    const toCall = (p: Participant, isLocal: boolean): CallParticipant => ({
      id: p.identity,
      name: p.name || p.identity,
      isLocal,
      speaking: p.isSpeaking,
      muted: isLocal ? this.snap.muted : (p.getTrackPublication(Track.Source.Microphone)?.isMuted ?? true),
      quality: qualityName(p.connectionQuality),
    });
    this.set({
      participants: [toCall(room.localParticipant, true), ...[...room.remoteParticipants.values()].map((p) => toCall(p, false))],
    });
  }
}
