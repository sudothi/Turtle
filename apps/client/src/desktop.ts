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
}

declare global {
  interface Window {
    turtleDesktop?: TurtleDesktop;
  }
}

export const desktop = (): TurtleDesktop | undefined => window.turtleDesktop;
