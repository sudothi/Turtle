/** Ponte exposta pelo app desktop (Electron). No navegador comum, `window.turtleDesktop` não existe. */
export interface PickSource {
  id: string;
  name: string;
  kind: "screen" | "window";
  thumbnail: string;
  icon?: string;
}
export interface PickRequest {
  audio: boolean;
  sources: PickSource[];
}
export interface TurtleDesktop {
  platform: string;
  onPickScreen(cb: (req: PickRequest) => void): () => void;
  pickScreen(id: string | null): void;
  openWebrtcInternals(): void;
  /** Pisca o ícone na barra de tarefas até a janela ganhar foco (versões novas do app). */
  attention?(): void;
  /** Mostra e foca a janela (sai da bandeja). */
  focus?(): void;
  /** Atalhos globais de mudo/ensurdecer (versões novas do app). */
  setShortcuts?(s: { mute: string; deafen: string }): void;
  onShortcut?(cb: (which: "mute" | "deafen") => void): () => void;
}

export interface Shortcuts { mute: string; deafen: string }
const SHORTCUT_KEY = "turtle.shortcuts";
export const loadShortcuts = (): Shortcuts => {
  try {
    const v = JSON.parse(localStorage.getItem(SHORTCUT_KEY) ?? "{}");
    return { mute: typeof v.mute === "string" ? v.mute : "", deafen: typeof v.deafen === "string" ? v.deafen : "" };
  } catch {
    return { mute: "", deafen: "" };
  }
};
export const saveShortcuts = (s: Shortcuts) => {
  try { localStorage.setItem(SHORTCUT_KEY, JSON.stringify(s)); } catch { /* sem armazenamento */ }
  window.turtleDesktop?.setShortcuts?.(s);
};
/** Converte a tecla apertada num acelerador do Electron (ex.: "Ctrl+Shift+M"); undefined se for só modificador. */
export function toAccelerator(e: KeyboardEvent): string | undefined {
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return undefined;
  const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super"].filter(Boolean) as string[];
  let key = e.code.startsWith("Key") ? e.code.slice(3) : e.code.startsWith("Digit") ? e.code.slice(5) : e.code;
  if (key.startsWith("Numpad")) key = "num" + key.slice(6).toLowerCase().replace("add", "add").replace("subtract", "sub");
  const names: Record<string, string> = { Space: "Space", Backquote: "`", Minus: "-", Equal: "=", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", Backspace: "Backspace", Enter: "Enter", Tab: "Tab", Escape: "Esc" };
  key = names[key] ?? key;
  return [...mods, key].join("+");
}

declare global {
  interface Window {
    turtleDesktop?: TurtleDesktop;
  }
}

export const desktop = (): TurtleDesktop | undefined => window.turtleDesktop;
