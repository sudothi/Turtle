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
