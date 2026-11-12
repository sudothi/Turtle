import { contextBridge, ipcRenderer } from "electron";

export interface PickSource {
  id: string;
  name: string;
  kind: "screen" | "window";
  thumbnail: string;
  icon?: string;
}
export interface PickRequest {
  /** O app pediu o áudio do computador e o sistema consegue capturá-lo. */
  audio: boolean;
  sources: PickSource[];
}

// Ponte mínima e explícita entre o app web e o Electron.
contextBridge.exposeInMainWorld("turtleDesktop", {
  platform: process.platform,
  onPickScreen(cb: (req: PickRequest) => void) {
    const h = (_: unknown, req: PickRequest) => cb(req);
    ipcRenderer.on("screen:pick", h);
    return () => void ipcRenderer.removeListener("screen:pick", h);
  },
  pickScreen(id: string | null) {
    ipcRenderer.send("screen:picked", id);
  },
  /** Áudio da transmissão por processo (Windows): sem o som do Turtle; numa janela, só o daquele programa. */
  shareAudio: {
    supported: (): Promise<boolean> => ipcRenderer.invoke("screen:audio-supported"),
    /** Avisa antes do getDisplayMedia que o áudio virá por aqui (o seletor mostra a dica de áudio). */
    want: (on: boolean): Promise<boolean> => ipcRenderer.invoke("screen:audio-want", on),
    start: (): Promise<{ ok: boolean; mode?: "screen" | "window"; reason?: string }> => ipcRenderer.invoke("screen:audio-start"),
    stop() {
      ipcRenderer.send("screen:audio-stop");
    },
    /** PCM 16 bits, estéreo intercalado, 48 kHz. */
    onData(cb: (chunk: Uint8Array) => void) {
      const h = (_: unknown, chunk: Uint8Array) => cb(chunk);
      ipcRenderer.on("screen:audio", h);
      return () => void ipcRenderer.removeListener("screen:audio", h);
    },
  },
  /** Iniciar com o Windows (só no instalado, Windows). */
  startup: {
    get: (): Promise<{ supported: boolean; on: boolean }> => ipcRenderer.invoke("startup:get"),
    set: (on: boolean): Promise<boolean> => ipcRenderer.invoke("startup:set", on),
  },
  openWebrtcInternals() {
    ipcRenderer.send("debug:webrtc");
  },
  attention() {
    ipcRenderer.send("win:attention");
  },
  focus() {
    ipcRenderer.send("win:focus");
  },
  /** Atalhos globais (funcionam com o jogo em tela cheia). Aceleradores do Electron; "" desliga. */
  setShortcuts(s: { mute: string; deafen: string }) {
    ipcRenderer.send("shortcuts:set", s);
  },
  onShortcut(cb: (which: "mute" | "deafen") => void) {
    const h = (_: unknown, which: "mute" | "deafen") => cb(which);
    ipcRenderer.on("shortcut:fired", h);
    return () => void ipcRenderer.removeListener("shortcut:fired", h);
  },
  /** Liga ou desliga o detector de jogos (lista fixa, a cada 30 s). Ligar reenvia o estado atual. */
  setActivityEnabled(on: boolean) {
    ipcRenderer.send("activity:enable", on);
  },
  onActivity(cb: (a: { game: string; phase: string | null; detail: string | null } | null) => void) {
    const h = (_: unknown, a: { game: string; phase: string | null; detail: string | null } | null) => cb(a);
    ipcRenderer.on("activity:changed", h);
    return () => void ipcRenderer.removeListener("activity:changed", h);
  },
});
