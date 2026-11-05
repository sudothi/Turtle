import { createContext, useContext, useSyncExternalStore } from "react";

/** Quando o app vira layout de celular (uma tela por vez): tela estreita, ou celular deitado. */
export const MOBILE_QUERY = "(max-width: 760px), (max-height: 500px) and (pointer: coarse)";

const query = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(MOBILE_QUERY) : undefined);

/** true quando a tela é estreita como um celular; acompanha rotação e redimensionamento. */
export function useMobile() {
  return useSyncExternalStore(
    (cb) => {
      const q = query();
      q?.addEventListener("change", cb);
      return () => q?.removeEventListener("change", cb);
    },
    () => query()?.matches ?? false,
    () => false,
  );
}

/** No celular, o cabeçalho da conversa/chamada mostra "voltar" para a lista de canais. */
export const MobileBack = createContext<(() => void) | undefined>(undefined);
export const useMobileBack = () => useContext(MobileBack);
