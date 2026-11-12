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
/** Game Automations do LoL (espelha apps/desktop/src/lcu/automations.ts). */
export type RevealProvider = "porofessor" | "opgg" | "ugg";
export interface AutoConfig {
  accept: { on: boolean; delayMs: number };
  /** champion: id do campeão ou -1 (aleatório). */
  pick: { on: boolean; champion: number | null; fallback: number | null; delayMs: number };
  ban: { on: boolean; champion: number | null; delayMs: number };
  reveal: { provider: RevealProvider };
}
export interface AutoLogLine { at: number; kind: "ok" | "info" | "warn" | "error"; text: string }
export interface AutoStatus { client: "closed" | "open"; phase: string | null; me: { name: string; icon: number } | null; log: AutoLogLine[] }
export interface Champion { id: number; name: string; alias: string }
export interface RevealResult { players: string[]; region: string; links: Record<RevealProvider, string> }
export type ToolResult<T = unknown> = { ok: true; result: T } | { ok: false; error: string };
export interface DesktopAutomations {
  get(): Promise<{ config: AutoConfig; status: AutoStatus } | null>;
  set(patch: { [K in keyof AutoConfig]?: Partial<AutoConfig[K]> }): Promise<AutoConfig | null>;
  watch(on: boolean): void;
  /** Acompanha o cliente devagar (faixa fora da chamada). Versões novas do app. */
  background?(on: boolean): void;
  champions(): Promise<Champion[]>;
  icon(id: number): Promise<string | null>;
  tool(which: "reveal"): Promise<ToolResult<RevealResult>>;
  tool(which: "dodge" | "restart"): Promise<ToolResult>;
  open(url: string): Promise<boolean>;
  onStatus(cb: (s: AutoStatus) => void): () => void;
}

export interface TurtleDesktop {
  platform: string;
  onPickScreen(cb: (req: PickRequest) => void): () => void;
  pickScreen(id: string | null): void;
  openWebrtcInternals(): void;
  /** Iniciar com o Windows (versões novas do app instalado). */
  startup?: {
    get(): Promise<{ supported: boolean; on: boolean }>;
    set(on: boolean): Promise<boolean>;
  };
  /** Áudio da transmissão por processo (versões novas do app, Windows). */
  shareAudio?: {
    supported(): Promise<boolean>;
    want(on: boolean): Promise<boolean>;
    start(): Promise<{ ok: boolean; mode?: "screen" | "window"; reason?: string }>;
    stop(): void;
    onData(cb: (chunk: Uint8Array) => void): () => void;
  };
  /** Pisca o ícone na barra de tarefas até a janela ganhar foco (versões novas do app). */
  attention?(): void;
  /** Mostra e foca a janela (sai da bandeja). */
  focus?(): void;
  /** Atalhos globais de mudo/ensurdecer (versões novas do app). */
  setShortcuts?(s: { mute: string; deafen: string }): void;
  onShortcut?(cb: (which: "mute" | "deafen") => void): () => void;
  /** Detector de jogos (versões novas do app): ligar reenvia o estado atual. */
  setActivityEnabled?(on: boolean): void;
  onActivity?(cb: (a: { game: string; phase: string | null; detail: string | null } | null) => void): () => void;
  /** Game Automations do LoL (versões novas do app). */
  automations?: DesktopAutomations;
}

/** Mostrar o jogo que estou jogando (só o desktop detecta). Começa ligado. */
const ACTIVITY_KEY = "turtle.showGame";
export const loadShowGame = () => {
  try { return localStorage.getItem(ACTIVITY_KEY) !== "0"; } catch { return true; }
};
export const saveShowGame = (on: boolean) => {
  try { localStorage.setItem(ACTIVITY_KEY, on ? "1" : "0"); } catch { /* sem armazenamento */ }
  window.turtleDesktop?.setActivityEnabled?.(on);
};

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
