export interface AudioInterruption { id: number; interrupted: boolean; held: boolean }
export interface CallAudio {
  snapshot(): Promise<AudioInterruption>;
  setCallActive(active: boolean): Promise<void>;
  acknowledge(id: number): Promise<boolean>;
  addListener(event: "onInterruption", listener: (state: AudioInterruption) => void): { remove(): void };
}
interface LifecycleOwner {
  resume(): void;
  chat: { flush(): Promise<void> };
  voice: {
    getSnapshot(): { status: string };
    subscribe(listener: () => void): () => void;
    background(): Promise<void>;
    foreground(): void;
    interrupt(): Promise<void>;
    interruptionEnded(): void;
  };
}

/** App visibility never owns the audio call. Native interruptions require a muted track before release. */
export class CallLifecycle {
  private stopped = false;
  private appState: string;
  private interruptionTask = Promise.resolve();
  private removeVoice: () => void;
  private listener: { remove(): void };
  private callActive?: boolean;

  constructor(private readonly owner: LifecycleOwner, private readonly audio: CallAudio, initialState: string) {
    this.appState = initialState;
    this.listener = audio.addListener("onInterruption", state => this.interruption(state));
    this.removeVoice = owner.voice.subscribe(this.syncCall);
    this.syncCall();
    this.readInterruption();
    if (initialState !== "active") void owner.voice.background();
  }

  private syncCall = () => {
    const status = this.owner.voice.getSnapshot().status;
    const active = status !== "idle";
    if (active === this.callActive) return;
    this.callActive = active;
    void this.audio.setCallActive(active).then(() => this.readInterruption()).catch(() => {});
  };

  private readInterruption() {
    if (!this.stopped) void this.audio.snapshot().then(state => this.interruption(state)).catch(() => {});
  }

  private interruption(state: AudioInterruption) {
    if (this.stopped || !this.callActive || !state.held) return;
    // Set the capture guard synchronously, including while a mic/rejoin request is in flight.
    const muted = this.owner.voice.interrupt();
    this.interruptionTask = this.interruptionTask.catch(() => {}).then(async () => {
      await muted;
      if (this.stopped || state.interrupted) return;
      if (await this.audio.acknowledge(state.id)) this.owner.voice.interruptionEnded();
    }).catch(() => { /* Keep the native hold if muting failed; retry from the next snapshot. */ });
  }

  change = (state: string) => {
    if (this.stopped || state === this.appState) return;
    this.appState = state;
    if (state === "active") {
      this.readInterruption();
      this.owner.resume();
      this.owner.voice.foreground();
    } else {
      void this.owner.chat.flush().catch(() => {});
      void this.owner.voice.background();
    }
  };

  stop() {
    this.stopped = true;
    this.removeVoice();
    this.listener.remove();
    // The owner disconnects media before releasing a held native audio session.
  }
}
