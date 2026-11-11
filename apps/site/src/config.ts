/** Onde ficam a API (fila de espera) e o instalador. Troque no build com VITE_APP_URL. */
export const APP_URL = (import.meta.env.VITE_APP_URL as string | undefined)?.replace(/\/+$/, "") || "https://turtlechat.tech";
export const DESKTOP_BASE = `${APP_URL}/desktop/`;
