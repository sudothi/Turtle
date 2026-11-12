import { BrowserWindow } from "electron";
import { appIcon, asset } from "./paths.js";

/** Janelinha de abertura (tartaruga + estrelas + mar), também usada para mostrar a atualização. */
export class Splash {
  private win: BrowserWindow | undefined;
  private readonly shownAt = Date.now();

  /** `silent`: início automático com o Windows; nada aparece na tela. */
  constructor(silent = false) {
    if (silent) return;
    this.win = new BrowserWindow({
      width: 340,
      height: 400,
      frame: false,
      transparent: true,
      resizable: false,
      movable: true,
      skipTaskbar: false,
      alwaysOnTop: false,
      center: true,
      show: false,
      title: "Turtle",
      icon: appIcon,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    this.win.once("ready-to-show", () => this.win?.show());
    this.win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    this.win.webContents.on("will-navigate", (e) => e.preventDefault());
    this.win.on("closed", () => (this.win = undefined));
    void this.win.loadFile(asset("splash.html"));
  }

  /** Texto embaixo do logo; com `pct`, mostra também a barra de progresso. */
  status(text: string, pct?: number) {
    const js = `window.turtleSplash?.(${JSON.stringify(text)}, ${pct === undefined ? "undefined" : Math.round(pct)})`;
    void this.win?.webContents.executeJavaScript(js).catch(() => {});
  }

  /** Fecha sem piscar: a splash fica pelo menos um instante na tela. */
  async close(minMs = 700) {
    const wait = this.win ? minMs - (Date.now() - this.shownAt) : 0;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.win?.destroy();
    this.win = undefined;
  }
}
