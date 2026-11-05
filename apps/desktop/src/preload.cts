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
});
