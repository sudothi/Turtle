import {
  ConnectionQuality,
  createLocalAudioTrack,
  DisconnectReason,
  type LocalAudioTrack,
  type Participant,
  type RemoteParticipant,
  RemoteTrack,
  type RemoteTrackPublication,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
} from "livekit-client";
import { api } from "../api";
import { loadPrefs, micConstraints, needsAudioProcessor, savePrefs, screenProfiles, usesWasmNoise, type AudioPrefs, type NoiseMode, type ScreenProfileId } from "./prefs";
import { preferHardwareH264 } from "./codec";
import { preloadNoiseWasm, RnnoiseProcessor } from "./rnnoise";

export interface CallParticipant {
  id: string;
  name: string;
  isLocal: boolean;
  speaking: boolean;
  muted: boolean;
  quality: "excellent" | "good" | "poor" | "lost" | "unknown";
}

/** Um vídeo na grade da chamada: a câmera ou a transmissão de tela de alguém. */
export interface VideoTile {
  key: string;
  userId: string;
  name: string;
  source: "camera" | "screen";
  isLocal: boolean;
  /** Pronto para exibir. Ausente numa transmissão que você ainda não escolheu assistir. */
  track?: Track;
  watching: boolean;
  speaking: boolean;
}

/** Diagnóstico da sua própria transmissão, lido do encoder. */
export interface ShareStats {
  width: number;
  height: number;
  fps: number;
  /** Nome do encoder usado pelo Chromium (hardware ou software). */
  encoder: string;
  /** Por que a qualidade caiu: "cpu", "bandwidth" ou "none". */
  limit: string;
  /** Mb/s enviados. */
  mbps: number;
  /** O Chromium diz que o codificador é eficiente em energia, ou seja, de hardware. Indefinido se não informado. */
  hardware?: boolean;
  /** Sem quadros nem bytes saindo: o LiveKit pausa a transmissão quando ninguém está assistindo (ou a aba de quem assiste está oculta). */
  idle: boolean;
}

export interface VoiceSnapshot {
  status: "idle" | "connecting" | "connected" | "reconnecting";
  channelId?: string;
  muted: boolean;
  deafened: boolean;
  participants: CallParticipant[];
  camera: boolean;
  screen: boolean;
  videos: VideoTile[];
  shareStats?: ShareStats;
  /** O navegador bloqueou o som até um clique (autoplay). */
  needsAudioUnlock: boolean;
  error?: string;
  prefs: AudioPrefs;
}

/** Avisa o gateway onde estamos, para a barra lateral de todo mundo. */
export interface VoiceReport {
  channelId: string | null;
  muted: boolean;
  deafened: boolean;
  camera: boolean;
  screen: boolean;
}
export type VoiceReporter = (state: VoiceReport) => void;

const qualityName = (q: ConnectionQuality): CallParticipant["quality"] =>
  q === ConnectionQuality.Excellent ? "excellent" : q === ConnectionQuality.Good ? "good" : q === ConnectionQuality.Poor ? "poor" : q === ConnectionQuality.Lost ? "lost" : "unknown";

/** Navegadores sem H.264 no encoder (alguns Chromium de código aberto) caem para VP8. */
const supportsH264 = () =>
  typeof RTCRtpSender !== "undefined" && (RTCRtpSender.getCapabilities?.("video")?.codecs.some((c) => c.mimeType.toLowerCase() === "video/h264") ?? false);

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
  private snap: VoiceSnapshot = {
    status: "idle", muted: false, deafened: false, participants: [], camera: false, screen: false, videos: [],
    needsAudioUnlock: false, prefs: loadPrefs(),
  };
  private joinSeq = 0;
  /** Quem você escolheu assistir (transmissões de tela só chegam a quem pede). */
  private watching = new Set<string>();
  /** Publicações remotas para as quais já pedimos (ou cancelamos) a assinatura. */
  private asked = new Set<string>();
  private statsTimer?: ReturnType<typeof setInterval>;
  private lastBytes?: { bytes: number; at: number };
  private lastDims = { width: 0, height: 0 };

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

  private reportState(channelId: string | null = this.snap.channelId ?? null) {
    const { muted, deafened, camera, screen } = this.snap;
    this.report({ channelId, muted, deafened, camera, screen });
  }

  /** Reenvia o estado ao gateway (ex.: depois que o WebSocket reconecta). */
  resendState() {
    if (this.snap.channelId && this.snap.status !== "idle") this.reportState();
  }

  async join(channelId: string) {
    if (this.snap.channelId === channelId && this.snap.status !== "idle") return;
    if (this.room) await this.leave();
    const seq = ++this.joinSeq;
    const prefs = this.snap.prefs;
    this.set({ status: "connecting", channelId, error: undefined, participants: [], videos: [], camera: false, screen: false });
    if (usesWasmNoise(prefs.noise)) void preloadNoiseWasm(prefs.noise).catch(() => {});

    preferHardwareH264();
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
      // Sem assinatura automática: voz e câmera entram sozinhas, transmissões de tela só quando você clica em Assistir.
      const connecting = api.voiceToken(channelId).then(({ url, token }) => room.connect(url, token, { autoSubscribe: false }));
      const micPromise = createLocalAudioTrack(micConstraints(prefs)).catch((err: Error) => err);
      await connecting;
      const mic = await micPromise;
      if (seq !== this.joinSeq) {
        if (!(mic instanceof Error)) mic.stop();
        return;
      }
      for (const p of room.remoteParticipants.values()) {
        this.applyVolume(p);
        this.syncSubscriptions(p);
      }
      this.set({ status: "connected" });
      this.reportState(channelId);

      if (mic instanceof Error) {
        this.set({ muted: true, error: `Sem acesso ao microfone (${mic.message}). Confira a permissão e o dispositivo nas configurações.` });
        this.reportState(channelId);
      } else {
        this.mic = mic;
        await room.localParticipant.publishTrack(mic, { source: Track.Source.Microphone });
        if (this.snap.muted) await mic.mute();
        await this.applyNoise();
      }
      this.refresh();
    } catch (err) {
      if (seq !== this.joinSeq) return;
      this.mic?.stop();
      this.mic = undefined;
      this.room = undefined;
      await room.disconnect();
      this.resetCall({ error: `Não deu para entrar na chamada: ${(err as Error).message}` });
      this.reportState(null);
    }
  }

  async leave() {
    this.joinSeq++;
    const room = this.room;
    this.room = undefined;
    this.mic?.stop();
    this.mic = undefined;
    this.resetCall({});
    this.reportState(null);
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
        await this.applyNoise();
        this.set({ error: undefined });
      } catch (err) {
        this.set({ muted: true, error: `Sem acesso ao microfone (${(err as Error).message}).` });
      }
    }
    this.applyVolumes();
    if (this.snap.channelId) this.reportState();
    this.refresh();
  }

  /** Volta ao estado "fora da chamada", mantendo mudo/ensurdecer e as preferências. */
  private resetCall(extra: Partial<VoiceSnapshot>) {
    this.stopStats();
    this.watching.clear();
    this.asked.clear();
    this.set({ status: "idle", channelId: undefined, participants: [], videos: [], camera: false, screen: false, shareStats: undefined, needsAudioUnlock: false, ...extra });
  }

  async toggleCamera() {
    const room = this.room;
    if (!room || this.snap.status === "idle") return;
    const on = !room.localParticipant.isCameraEnabled;
    try {
      const { cameraId } = this.snap.prefs;
      await room.localParticipant.setCameraEnabled(
        on,
        on ? { deviceId: cameraId === "default" ? undefined : { exact: cameraId }, resolution: VideoPresets.h720.resolution } : undefined,
        on ? { simulcast: true } : undefined,
      );
      this.set({ camera: room.localParticipant.isCameraEnabled, error: undefined });
    } catch (err) {
      this.set({ camera: false, error: `Não deu para ligar a câmera (${(err as Error).message}). Confira a permissão e o dispositivo.` });
    }
    this.reportState();
    this.refresh();
  }

  /** Começa a transmitir a tela ou uma janela com o perfil e a opção de áudio salvos. */
  async startScreen() {
    const room = this.room;
    if (!room || this.snap.status === "idle" || room.localParticipant.isScreenShareEnabled) return;
    const { screenProfile, screenAudio } = this.snap.prefs;
    const prof = screenProfiles[screenProfile];
    try {
      await room.localParticipant.setScreenShareEnabled(
        true,
        {
          audio: screenAudio
            ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2, restrictOwnAudio: true }
            : false,
          resolution: { width: prof.width, height: prof.height, frameRate: prof.fps },
          contentHint: prof.degradation === "maintain-framerate" ? "motion" : "detail",
          systemAudio: "include",
          selfBrowserSurface: "exclude",
          surfaceSwitching: "include",
        },
        {
          // H.264: no Windows o Chromium usa o encoder da placa de vídeo (NVENC, QuickSync, AMF).
          videoCodec: supportsH264() ? "h264" : "vp8",
          simulcast: false,
          screenShareEncoding: { maxBitrate: prof.bitrate, maxFramerate: prof.fps, priority: "high" },
          degradationPreference: prof.degradation,
          // Valem só para o áudio da tela: estéreo, sem DTX nem RED, 128 kb/s (música e jogo).
          audioPreset: { maxBitrate: 128_000 },
          forceStereo: true,
          dtx: false,
          red: false,
        },
      );
      this.set({ screen: room.localParticipant.isScreenShareEnabled, error: undefined });
      if (this.snap.screen) this.startStats();
    } catch (err) {
      const e = err as Error;
      // Cancelar o seletor do navegador não é erro.
      this.set({ screen: false, error: e.name === "NotAllowedError" || /Permission denied/i.test(e.message) ? undefined : `Não deu para transmitir a tela (${e.message}).` });
    }
    this.reportState();
    this.refresh();
  }

  async stopScreen() {
    const room = this.room;
    if (!room) return;
    try {
      await room.localParticipant.setScreenShareEnabled(false);
    } finally {
      this.stopStats();
      this.set({ screen: false, shareStats: undefined });
      this.reportState();
      this.refresh();
    }
  }

  setScreenProfile(screenProfile: ScreenProfileId) {
    this.savePrefs({ screenProfile });
  }

  setScreenAudio(screenAudio: boolean) {
    this.savePrefs({ screenAudio });
  }

  async setCamera(cameraId: string) {
    this.savePrefs({ cameraId });
    if (this.room?.localParticipant.isCameraEnabled) {
      await this.room.switchActiveDevice("videoinput", cameraId).catch(() => {});
    }
  }

  watch(userId: string) {
    this.watching.add(userId);
    this.syncAll();
    this.refresh();
  }

  unwatch(userId: string) {
    this.watching.delete(userId);
    this.syncAll();
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
    const prev = this.snap.prefs.noise;
    this.savePrefs({ noise });
    if (usesWasmNoise(noise)) void preloadNoiseWasm(noise).catch(() => {});
    if (!this.mic) return;
    // Só reinicia a captura se a constraint noiseSuppression do navegador mudou.
    if ((prev === "browser") !== (noise === "browser")) {
      await this.mic.restartTrack(micConstraints(this.snap.prefs));
    }
    await this.applyNoise();
  }

  async setNoiseGate(noiseGate: boolean) {
    this.savePrefs({ noiseGate });
    await this.applyNoise();
  }

  async setGateThreshold(gateThreshold: number) {
    this.savePrefs({ gateThreshold });
    await this.applyNoise();
  }

  async setInputGain(inputGain: number) {
    const prevNeeds = needsAudioProcessor(this.snap.prefs);
    this.savePrefs({ inputGain });
    const proc = this.mic?.getProcessor();
    if (proc instanceof RnnoiseProcessor && needsAudioProcessor(this.snap.prefs)) {
      proc.setGain(inputGain);
    } else if (prevNeeds !== needsAudioProcessor(this.snap.prefs)) {
      await this.applyNoise();
    }
  }

  setVolume(userId: string, volume: number) {
    this.savePrefs({ volumes: { ...this.snap.prefs.volumes, [userId]: volume } });
    this.applyVolumes();
  }

  /** Volume do áudio da transmissão de tela de uma pessoa (separado da voz dela). */
  setStreamVolume(userId: string, volume: number) {
    this.savePrefs({ streamVolumes: { ...this.snap.prefs.streamVolumes, [userId]: volume } });
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

  private streamVolumeFor(userId: string) {
    return this.snap.deafened ? 0 : (this.snap.prefs.streamVolumes[userId] ?? 1);
  }

  private applyVolume(p: RemoteParticipant) {
    p.setVolume(this.volumeFor(p.identity), Track.Source.Microphone);
    p.setVolume(this.streamVolumeFor(p.identity), Track.Source.ScreenShareAudio);
  }

  private applyVolumes() {
    if (!this.room) return;
    for (const p of this.room.remoteParticipants.values()) this.applyVolume(p);
  }

  /** Voz e câmera sempre; transmissão de tela (e o áudio dela) só de quem você escolheu assistir. */
  private syncPub(pub: RemoteTrackPublication, userId: string) {
    const isScreen = pub.source === Track.Source.ScreenShare || pub.source === Track.Source.ScreenShareAudio;
    const want = !isScreen || this.watching.has(userId);
    const asked = this.asked.has(pub.trackSid);
    if (want && !asked) {
      this.asked.add(pub.trackSid);
      pub.setSubscribed(true);
    } else if (!want && asked) {
      this.asked.delete(pub.trackSid);
      pub.setSubscribed(false);
    }
  }

  private syncSubscriptions(p: RemoteParticipant) {
    for (const pub of p.trackPublications.values()) this.syncPub(pub as RemoteTrackPublication, p.identity);
  }

  private syncAll() {
    if (!this.room) return;
    for (const p of this.room.remoteParticipants.values()) this.syncSubscriptions(p);
  }

  private startStats() {
    this.stopStats();
    this.lastBytes = undefined;
    void this.pollStats();
    this.statsTimer = setInterval(() => void this.pollStats(), 2000);
  }

  private stopStats() {
    clearInterval(this.statsTimer);
    this.statsTimer = undefined;
    this.lastBytes = undefined;
    this.lastDims = { width: 0, height: 0 };
  }

  /** Lê do encoder resolução, fps, qual encoder está em uso e se a qualidade está caindo. */
  private async pollStats() {
    const pub = this.room?.localParticipant.getTrackPublication(Track.Source.ScreenShare);
    const sender = (pub?.track as { sender?: RTCRtpSender } | undefined)?.sender;
    if (!sender) return;
    const report = await sender.getStats().catch(() => undefined);
    if (!report) return;
    for (const stat of report.values()) {
      if (stat.type !== "outbound-rtp" || stat.kind !== "video") continue;
      const now = performance.now();
      const bytes = (stat.bytesSent as number | undefined) ?? 0;
      const mbps = this.lastBytes ? ((bytes - this.lastBytes.bytes) * 8) / 1e6 / ((now - this.lastBytes.at) / 1000) : 0;
      this.lastBytes = { bytes, at: now };
      if (stat.frameWidth) this.lastDims = { width: stat.frameWidth, height: stat.frameHeight ?? 0 };
      this.set({
        shareStats: {
          width: stat.frameWidth || this.lastDims.width,
          height: stat.frameHeight || this.lastDims.height,
          fps: Math.round(stat.framesPerSecond ?? 0),
          idle: !stat.framesPerSecond && mbps < 0.05,
          encoder: stat.encoderImplementation ?? "desconhecido",
          hardware: stat.powerEfficientEncoder as boolean | undefined,
          limit: stat.qualityLimitationReason ?? "none",
          mbps: Math.max(0, Math.round(mbps * 10) / 10),
        },
      });
      return;
    }
  }

  private async applyNoise() {
    const mic = this.mic;
    if (!mic) return;
    const prefs = this.snap.prefs;
    try {
      if (needsAudioProcessor(prefs)) {
        await mic.setProcessor(new RnnoiseProcessor(prefs));
      } else if (mic.getProcessor()) {
        await mic.stopProcessor();
      }
    } catch (err) {
      // Sem processador a chamada continua com o microfone direto; avisa.
      console.warn("Filtro de áudio falhou", err);
      this.set({ error: "Não deu para ligar o filtro de ruído; usando o microfone direto." });
    }
  }

  private wire(room: Room) {
    const refresh = () => this.room === room && this.refresh();
    room
      .on(RoomEvent.ParticipantConnected, (p) => {
        this.applyVolume(p);
        this.syncSubscriptions(p);
        refresh();
      })
      .on(RoomEvent.ParticipantDisconnected, (p) => {
        this.watching.delete(p.identity);
        refresh();
      })
      .on(RoomEvent.ActiveSpeakersChanged, refresh)
      .on(RoomEvent.TrackMuted, refresh)
      .on(RoomEvent.TrackUnmuted, refresh)
      .on(RoomEvent.TrackPublished, (pub, p) => {
        this.syncPub(pub, p.identity);
        refresh();
      })
      .on(RoomEvent.TrackUnpublished, (pub, p) => {
        this.asked.delete(pub.trackSid);
        // A pessoa parou de transmitir: na próxima vez, o Assistir volta a ser uma escolha.
        if (pub.source === Track.Source.ScreenShare) this.watching.delete(p.identity);
        refresh();
      })
      .on(RoomEvent.LocalTrackPublished, refresh)
      .on(RoomEvent.LocalTrackUnpublished, () => {
        // O botão "Parar compartilhamento" do navegador encerra a captura por fora do app.
        if (this.room !== room) return;
        const lp = room.localParticipant;
        if (this.snap.screen && !lp.isScreenShareEnabled) {
          this.stopStats();
          this.set({ screen: false, shareStats: undefined });
          this.reportState();
        }
        if (this.snap.camera && !lp.isCameraEnabled) {
          this.set({ camera: false });
          this.reportState();
        }
        refresh();
      })
      .on(RoomEvent.ConnectionQualityChanged, refresh)
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, p) => {
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach();
          el.dataset.turtleAudio = track.sid ?? p.identity;
          document.body.appendChild(el);
          this.applyVolume(p);
        }
        // Vídeo não vira elemento aqui: a grade da chamada anexa a track ao <video> de cada cartão.
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
        // Depois de reconectar, as assinaturas podem ter sido perdidas: pede de novo.
        this.asked.clear();
        this.syncAll();
        this.resendState();
      })
      .on(RoomEvent.Disconnected, (reason) => {
        for (const el of document.querySelectorAll("audio[data-turtle-audio]")) el.remove();
        if (this.room !== room) return;
        this.room = undefined;
        this.mic?.stop();
        this.mic = undefined;
        this.resetCall({ error: disconnectMessage(reason) });
        this.reportState(null);
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
    const everyone: [Participant, boolean][] = [[room.localParticipant, true], ...[...room.remoteParticipants.values()].map((p): [Participant, boolean] => [p, false])];
    const videos: VideoTile[] = [];
    for (const [p, isLocal] of everyone) {
      const base = { userId: p.identity, name: p.name || p.identity, isLocal, speaking: p.isSpeaking };
      const cam = p.getTrackPublication(Track.Source.Camera);
      if (cam && !cam.isMuted) videos.push({ ...base, key: `${p.identity}:camera`, source: "camera", track: cam.track, watching: true });
      const scr = p.getTrackPublication(Track.Source.ScreenShare);
      if (scr) {
        const watching = isLocal || this.watching.has(p.identity);
        videos.push({ ...base, key: `${p.identity}:screen`, source: "screen", track: watching ? scr.track : undefined, watching });
      }
    }
    this.set({
      participants: everyone.map(([p, isLocal]) => toCall(p, isLocal)),
      videos,
      camera: room.localParticipant.isCameraEnabled,
      screen: room.localParticipant.isScreenShareEnabled,
    });
  }
}
