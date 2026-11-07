import { execFile } from "node:child_process";
import { join } from "node:path";
import type { WebContents } from "electron";

/**
 * Áudio da transmissão de tela no Windows, capturado por processo (WASAPI process loopback):
 * - tela inteira: todo o som do PC menos o próprio Turtle (sem eco das vozes da chamada);
 * - janela: só o som do programa dono daquela janela (e dos processos filhos dele).
 * O loopback do Electron ("loopback") pega tudo que sai nos alto-falantes, inclusive a chamada.
 * O PCM (16 bits, estéreo, 48 kHz) vai para o app web, que o publica como ScreenShareAudio.
 */

interface Capture {
  start(processId: number, onData: (chunk: Buffer) => void): void;
  startSystemAudio(onData: (chunk: Buffer) => void, excludeProcessId?: number): void;
  stop(): void;
}
type Addon = { LoopbackCapture: new () => Capture };

export type ShareAudioResult =
  | { ok: true; mode: "screen" | "window" }
  | { ok: false; reason: "unsupported" | "no-source" | "no-process" | "own-window" | "failed" };

let addon: Addon | null | undefined;
let active: Capture | undefined;
/** Fonte escolhida no último pedido de captura (id do desktopCapturer). */
let picked: string | undefined;

/** Addon nativo (loopback-capture), copiado para dist/native no build e fora do asar no instalador. */
function load(): Addon | null {
  if (addon !== undefined) return addon;
  addon = null;
  if (process.platform !== "win32" || process.arch !== "x64") return addon;
  try {
    const file = join(__dirname, "native", "loopback_capture_addon.node").replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
    const mod = { exports: {} as Addon };
    process.dlopen(mod, file);
    addon = mod.exports;
  } catch (err) {
    console.warn("[turtle] áudio por processo indisponível:", (err as Error).message);
  }
  return addon;
}

export const shareAudioSupported = () => !!load();

export function rememberPicked(id: string | undefined) {
  picked = id;
}

/** Processo dono de uma janela (HWND). Sem addon extra: uma chamada a user32 pelo PowerShell. */
function windowPid(hwnd: string): Promise<number | undefined> {
  const script =
    "Add-Type -Namespace T -Name W -MemberDefinition '[DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);';" +
    `$p = [uint32]0; [void][T.W]::GetWindowThreadProcessId([IntPtr]${hwnd}, [ref]$p); $p`;
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 8000, windowsHide: true }, (err, out) => {
      const pid = Number(String(out).trim());
      resolve(!err && Number.isInteger(pid) && pid > 0 ? pid : undefined);
    });
  });
}

export function stopShareAudio() {
  const cap = active;
  active = undefined;
  try {
    cap?.stop();
  } catch {
    /* já parado */
  }
}

/** Começa a mandar o áudio da fonte escolhida para a janela do app (canal "screen:audio"). */
export async function startShareAudio(wc: WebContents): Promise<ShareAudioResult> {
  stopShareAudio();
  const lib = load();
  if (!lib) return { ok: false, reason: "unsupported" };
  const id = picked;
  if (!id) return { ok: false, reason: "no-source" };
  const cap = new lib.LoopbackCapture();
  const send = (chunk: Buffer) => {
    if (active !== cap) return;
    if (wc.isDestroyed()) return stopShareAudio();
    wc.send("screen:audio", chunk);
  };
  try {
    if (id.startsWith("screen:")) {
      // Exclui a árvore de processos do Turtle (o áudio da chamada sai de um processo filho do principal).
      active = cap;
      cap.startSystemAudio(send, process.pid);
      return { ok: true, mode: "screen" };
    }
    // "window:<HWND>:0"
    const hwnd = id.split(":")[1];
    if (!hwnd || !/^\d+$/.test(hwnd)) return { ok: false, reason: "no-process" };
    const pid = await windowPid(hwnd);
    if (!pid) return { ok: false, reason: "no-process" };
    if (pid === process.pid) return { ok: false, reason: "own-window" };
    if (picked !== id) return { ok: false, reason: "no-source" }; // trocou de fonte enquanto procurava
    active = cap;
    cap.start(pid, send);
    return { ok: true, mode: "window" };
  } catch (err) {
    console.warn("[turtle] falha ao capturar o áudio da transmissão:", (err as Error).message);
    if (active === cap) active = undefined;
    return { ok: false, reason: "failed" };
  }
}
