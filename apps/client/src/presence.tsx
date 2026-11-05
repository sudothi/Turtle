import { createContext, useContext } from "react";

export type Presence = "online" | "busy" | "offline";
/** Quem está conectado e quem está em Não perturbe (vem do evento "presence"). */
export const PresenceContext = createContext<{ online: Set<string>; busy: Set<string> }>({ online: new Set(), busy: new Set() });

/** Devolve uma função id -> presença, para a bolinha do avatar. */
export function usePresence() {
  const { online, busy } = useContext(PresenceContext);
  return (id: string | undefined): Presence => (!id || !online.has(id) ? "offline" : busy.has(id) ? "busy" : "online");
}
/** Bolinha só para quem está conectado (nas listas, offline fica sem bolinha). */
export const dot = (p: Presence) => (p === "offline" ? undefined : p);
