import {
  ConnectionQuality,
  createLocalAudioTrack,
  DisconnectReason,
  type LocalAudioTrack,
  type LocalVideoTrack,
  type Participant,
  type RemoteParticipant,
  RemoteTrack,
  type RemoteTrackPublication,
  Room,
  RoomEvent,
  Track,
  VideoPreset,
  VideoPresets,
  VideoQuality,
} from "livekit-client";
import { api } from "../api";
import { loadPrefs, micConstraints, needsAudioProcessor, savePrefs, screenProfiles, usesWasmNoise, type AudioPrefs, type NoiseMode, type ScreenProfileId } from "./prefs";
import { preferHardwareH264 } from "./codec";
import { preloadNoiseWasm, publishAsMono, RnnoiseProcessor } from "./rnnoise";
import { loadSoundPrefs, playSound, type SoundName } from "../sounds";
import { desktop } from "../desktop";
import { DesktopShareAudio, desktopShareAudioSupported } from "./screen-audio";

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
  /** A transmissão tem áudio (do computador de quem transmite). */
  hasAudio?: boolean;
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
  /** Câmera do celular em uso: frontal (espelhada) ou traseira. */
  facing: "user" | "environment";
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

/** Quedas em que vale tentar voltar sozinho (não foi a pessoa que saiu, nem foi removida ou entrou em outro lugar). */
const NO_RETRY = new Set<DisconnectReason | undefined>([
  DisconnectReason.CLIENT_INITIATED,
  DisconnectReason.DUPLICATE_IDENTITY,
  DisconnectReason.PARTICIPANT_REMOVED,
  DisconnectReason.ROOM_DELETED,
  (DisconnectReason as unknown as Record<string, DisconnectReason | undefined>).ROOM_CLOSED,
].filter((r) => r !== undefined));
/** Esperas entre as tentativas de voltar (somam pouco mais de 2 minutos). */
const REJOIN_DELAYS = [1000, 2000, 4000, 8000, 15_000, 30_000, 30_000, 30_000];

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
    needsAudioUnlock: false, facing: "user", prefs: loadPrefs(),
  };
  private joinSeq = 0;
  /** Quem você escolheu assistir (transmissões de tela só chegam a quem pede). */
  private watching = new Set<string>();
  /** Publicações remotas para as quais já pedimos (ou cancelamos) a assinatura. */
  private asked = new Set<string>();
  private statsTimer?: ReturnType<typeof setInterval>;
  private lastBytes?: { bytes: number; at: number };
  private lastDims = { width: 0, height: 0 };
  /** Voltando sozinho para a chamada depois de uma queda. */
  private rejoin?: { channelId: string; attempt: number; timer?: ReturnType<typeof setTimeout> };
  /** Até quando ignorar entradas e saídas dos outros (logo depois de reconectar o LiveKit reanuncia todo mundo). */
  private presenceQuietUntil = 0;
  private lastPresenceSound = 0;
  /** Áudio da transmissão vindo do app desktop (por processo, sem o som do Turtle). */
  private shareAudio?: DesktopShareAudio;

  constructor(private report: VoiceReporter) {
    // A rede voltou: tenta já, sem esperar a vez.
    if (typeof window !== "undefined") window.addEventListener("online", () => {
      if (!this.rejoin) return;
      clearTimeout(this.rejoin.timer);
      void this.join(this.rejoin.channelId, true);
    });
  }

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

  /** Sons de entrar e sair da chamada, se a pessoa não desligou nas configurações. */
  private callSound(name: SoundName) {
    if (loadSoundPrefs().callPresence) playSound(name);
  }

  /** Alguém entrou ou saiu da sua chamada: só com a chamada estável, sem ensurdecer, e um som por rajada. */
  private presenceSound(name: "userJoin" | "userLeave") {
    const now = Date.now();
    if (this.snap.status !== "connected" || this.snap.deafened || now < this.presenceQuietUntil || now - this.lastPresenceSound < 300) return;
    this.lastPresenceSound = now;
    this.callSound(name);
  }

  /** Reenvia o estado ao gateway (ex.: depois que o WebSocket reconecta). */
  resendState() {
    if (this.snap.channelId && this.snap.status !== "idle") this.reportState();
  }

  /** `retrying`: tentativa automática de voltar depois de uma queda (mantém "Reconectando…"). */
  async join(channelId: string, retrying = false) {
    if (!retrying && this.snap.channelId === channelId && this.snap.status !== "idle") return;
    if (!retrying) this.stopRejoin();
    if (this.room) await this.leave();
    const seq = ++this.joinSeq;
    const prefs = this.snap.prefs;
    this.set({ status: retrying ? "reconnecting" : "connecting", channelId, error: undefined, participants: [], videos: [], camera: false, screen: false });
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
      this.rejoin = undefined;
      this.set({ status: "connected" });
      this.presenceQuietUntil = Date.now() + 1500;
      this.callSound("callJoin");
      this.reportState(channelId);

      if (mic instanceof Error) {
        this.set({ muted: true, error: `Sem acesso ao microfone (${mic.message}). Confira a permissão e o dispositivo nas configurações.` });
        this.reportState(channelId);
      } else {
        this.mic = mic;
        publishAsMono(mic);
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
      // Voltando de uma queda: tenta de novo mais tarde, até desistir.
      if (retrying && this.rejoin?.channelId === channelId) return this.scheduleRejoin(channelId, this.rejoin.attempt + 1);
      this.resetCall({ error: `Não deu para entrar na chamada: ${(err as Error).message}` });
      this.reportState(null);
    }
  }

  private stopRejoin() {
    clearTimeout(this.rejoin?.timer);
    this.rejoin = undefined;
  }

  /**
   * A chamada caiu sem a pessoa sair (rede trocou, Wi-Fi voltou, servidor reiniciou): tenta voltar sozinho,
   * com espera crescente, mantendo mudo/ensurdecer e as transmissões que estava assistindo. A câmera e a tela
   * não voltam sozinhas.
   */
  private scheduleRejoin(channelId: string, attempt: number) {
    clearTimeout(this.rejoin?.timer);
    const delay = REJOIN_DELAYS[attempt];
    if (delay === undefined) {
      this.rejoin = undefined;
      this.resetCall({ error: "A chamada caiu e não deu para voltar. Confira a internet e entre de novo." });
      this.reportState(null);
      return;
    }
    this.stopStats();
    this.stopShareAudio();
    this.asked.clear();
    this.set({ status: "reconnecting", channelId, participants: [], videos: [], camera: false, screen: false, shareStats: undefined, needsAudioUnlock: false });
    const timer = setTimeout(() => void this.join(channelId, true), delay);
    this.rejoin = { channelId, attempt, timer };
  }

  async leave() {
    this.stopRejoin();
    this.joinSeq++;
    const room = this.room;
    const wasIn = this.snap.status !== "idle";
    this.room = undefined;
    this.mic?.stop();
    this.mic = undefined;
    if (wasIn) this.callSound("callLeave");
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
        publishAsMono(mic);
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
    this.stopShareAudio();
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
      // No celular, "padrão" = câmera frontal (ou a traseira, se a pessoa virou).
      const device = cameraId === "default" ? { facingMode: this.snap.facing } : { deviceId: { exact: cameraId } };
      await room.localParticipant.setCameraEnabled(
        on,
        on ? { ...device, resolution: VideoPresets.h720.resolution } : undefined,
        on ? { simulcast: true } : undefined,
      );
      this.set({ camera: room.localParticipant.isCameraEnabled, error: undefined });
    } catch (err) {
      this.set({ camera: false, error: `Não deu para ligar a câmera (${(err as Error).message}). Confira a permissão e o dispositivo.` });
    }
    this.reportState();
    this.refresh();
  }

  /** Troca entre câmera frontal e traseira (celular), sem desligar a câmera. */
  async flipCamera() {
    const facing = this.snap.facing === "user" ? "environment" : "user";
    const track = this.room?.localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack as LocalVideoTrack | undefined;
    try {
      if (track) await track.restartTrack({ facingMode: facing, resolution: VideoPresets.h720.resolution });
      this.set({ facing, error: undefined });
    } catch (err) {
      this.set({ error: `Não deu para trocar de câmera (${(err as Error).message}).` });
    }
    this.refresh();
  }

  /** Começa a transmitir a tela ou uma janela com o perfil e a opção de áudio salvos. */
  async startScreen() {
    const room = this.room;
    if (!room || this.snap.status === "idle" || room.localParticipant.isScreenShareEnabled) return;
    const { screenProfile, screenAudio, screenSimulcast } = this.snap.prefs;
    const prof = screenProfiles[screenProfile];
    // App desktop novo (Windows): o vídeo vem sem áudio e o áudio vem por processo, sem o som do Turtle
    // (quem está na chamada não se escuta) e, numa janela, só o som daquele programa.
    // O AudioContext nasce aqui, ainda dentro do clique.
    let ctx = screenAudio && desktop()?.shareAudio ? DesktopShareAudio.context() : undefined;
    const native = !!ctx && (await desktopShareAudioSupported()) && (await desktop()!.shareAudio!.want(true).catch(() => false));
    if (!native && ctx) {
      void ctx.close().catch(() => {});
      ctx = undefined;
    }
    try {
      await room.localParticipant.setScreenShareEnabled(
        true,
        {
          // No navegador, restrictOwnAudio tira o som da própria aba (Chrome); o Electron antigo ignora.
          audio: screenAudio && !native
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
          // Opcional (Configurações da transmissão): camada extra pequena para quem assiste com rede fraca.
          simulcast: screenSimulcast,
          screenShareSimulcastLayers: screenSimulcast ? [new VideoPreset(960, 540, 800_000, 15)] : [],
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
      if (ctx && this.snap.screen) {
        const c = ctx;
        ctx = undefined;
        await this.publishShareAudio(room, c);
      }
    } catch (err) {
      const e = err as Error;
      // Cancelar o seletor do navegador não é erro.
      this.set({ screen: false, error: e.name === "NotAllowedError" || /Permission denied/i.test(e.message) ? undefined : `Não deu para transmitir a tela (${e.message}).` });
    } finally {
      if (native) void desktop()?.shareAudio?.want(false).catch(() => {});
      if (ctx) void ctx.close().catch(() => {});
    }
    this.reportState();
    this.refresh();
  }

  /** Publica o áudio por processo da fonte escolhida. Se falhar, a transmissão segue sem som. */
  private async publishShareAudio(room: Room, ctx: AudioContext) {
    const res = await DesktopShareAudio.start(ctx).catch((err: Error) => ({ reason: err.message }));
    if (!(res instanceof DesktopShareAudio)) {
      const why = res.reason === "own-window" ? "a janela é do próprio Turtle" : res.reason === "no-process" ? "não achei o programa dessa janela" : res.reason;
      this.set({ error: `A transmissão está sem áudio (${why}).` });
      return;
    }
    // Parou de transmitir enquanto o áudio começava.
    if (this.room !== room || !room.localParticipant.isScreenShareEnabled) return res.stop();
    this.shareAudio = res;
    try {
      await room.localParticipant.publishTrack(res.track, {
        source: Track.Source.ScreenShareAudio,
        // Igual ao áudio de tela do navegador: estéreo, sem DTX nem RED, 128 kb/s (música e jogo).
        audioPreset: { maxBitrate: 128_000 },
        forceStereo: true,
        dtx: false,
        red: false,
      });
    } catch (err) {
      this.stopShareAudio();
      this.set({ error: `A transmissão está sem áudio (${(err as Error).message}).` });
    }
  }

  /** Para o áudio da transmissão e tira a publicação dele (o LiveKit não tira sozinho quando o vídeo acaba por fora). */
  private stopShareAudio() {
    const a = this.shareAudio;
    this.shareAudio = undefined;
    a?.stop();
    const pub = this.room?.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio);
    if (pub?.track) void this.room?.localParticipant.unpublishTrack(pub.track).catch(() => {});
  }

  async stopScreen() {
    const room = this.room;
    if (!room) return;
    try {
      await room.localParticipant.setScreenShareEnabled(false);
    } finally {
      this.stopShareAudio();
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

  setScreenSimulcast(screenSimulcast: boolean) {
    this.savePrefs({ screenSimulcast });
  }

  /** Quem assiste escolhe a qualidade da transmissão de outra pessoa (só muda algo se ela publicou a camada pequena). */
  setWatchQuality(userId: string, quality: "auto" | "high" | "low") {
    const p = this.room?.remoteParticipants.get(userId);
    const pub = p?.getTrackPublication(Track.Source.ScreenShare) as RemoteTrackPublication | undefined;
    pub?.setVideoQuality(quality === "low" ? VideoQuality.LOW : VideoQuality.HIGH);
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

  /** Silenciar uma pessoa só para mim (os outros continuam ouvindo). */
  setLocalMute(userId: string, muted: boolean) {
    const localMutes = { ...this.snap.prefs.localMutes };
    if (muted) localMutes[userId] = true;
    else delete localMutes[userId];
    this.savePrefs({ localMutes });
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
    return this.snap.deafened || this.snap.prefs.localMutes[userId] ? 0 : (this.snap.prefs.volumes[userId] ?? 1);
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
        if (this.room === room) this.presenceSound("userJoin");
        refresh();
      })
      .on(RoomEvent.ParticipantDisconnected, (p) => {
        this.watching.delete(p.identity);
        if (this.room === room) this.presenceSound("userLeave");
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
        if (pub.source === Track.Source.ScreenShare) {
          this.watching.delete(p.identity);
          // Sem o vídeo, o áudio da tela dela não fica tocando (cancela a assinatura se ainda estiver publicado).
          this.syncSubscriptions(p);
        }
        refresh();
      })
      .on(RoomEvent.LocalTrackPublished, refresh)
      .on(RoomEvent.LocalTrackUnpublished, () => {
        // O botão "Parar compartilhamento" do navegador encerra a captura por fora do app.
        if (this.room !== room) return;
        const lp = room.localParticipant;
        if (!lp.isScreenShareEnabled && (this.shareAudio || lp.getTrackPublication(Track.Source.ScreenShareAudio))) this.stopShareAudio();
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
        this.presenceQuietUntil = Date.now() + 2000;
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
        const channelId = this.snap.channelId;
        if (channelId && !NO_RETRY.has(reason)) return this.scheduleRejoin(channelId, 0);
        this.callSound("callLeave");
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
        const hasAudio = !!p.getTrackPublication(Track.Source.ScreenShareAudio);
        videos.push({ ...base, key: `${p.identity}:screen`, source: "screen", track: watching ? scr.track : undefined, watching, hasAudio });
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
