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

/**
 * Altura visível de verdade (descontando o teclado) em --vvh. O iPhone não encolhe a página quando o
 * teclado abre, então sem isso o compositor fica escondido atrás dele e o cabeçalho sobe.
 */
export function trackVisualViewport() {
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  if (!vv) return () => {};
  const root = document.documentElement;
  const apply = () => {
    root.style.setProperty("--vvh", `${Math.round(vv.height)}px`);
    // O iPhone rola a página inteira para mostrar o campo; volta para o topo (o app tem a própria rolagem).
    if (window.scrollY !== 0) window.scrollTo(0, 0);
  };
  apply();
  vv.addEventListener("resize", apply);
  vv.addEventListener("scroll", apply);
  return () => {
    vv.removeEventListener("resize", apply);
    vv.removeEventListener("scroll", apply);
    root.style.removeProperty("--vvh");
  };
}
