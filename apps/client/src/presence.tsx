import { createContext, useContext, useEffect, useState } from "react";
import { gamePhaseLabel, games, type Activity } from "@turtle/protocol";

export type Presence = "online" | "busy" | "offline";
/**
 * Quem está conectado e em Não perturbe (evento "presence"), o jogo de cada um e,
 * para quem está numa chamada que você enxerga, onde ela é ("#sala · Servidor").
 */
export const PresenceContext = createContext<{ online: Set<string>; busy: Set<string>; activities?: Record<string, Activity>; calls?: Record<string, string> }>({
  online: new Set(),
  busy: new Set(),
});

/** Devolve uma função id -> presença, para a bolinha do avatar. */
export function usePresence() {
  const { online, busy } = useContext(PresenceContext);
  return (id: string | undefined): Presence => (!id || !online.has(id) ? "offline" : busy.has(id) ? "busy" : "online");
}
/** Bolinha só para quem está conectado (nas listas, offline fica sem bolinha). */
export const dot = (p: Presence) => (p === "offline" ? undefined : p);

const minutes = (since?: string) => {
  const m = since ? Math.floor((Date.now() - Date.parse(since)) / 60_000) : NaN;
  return Number.isFinite(m) && m >= 1 ? (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`) : "";
};
/** Texto curto da atividade: "Jogando League of Legends · Na fila · Ranqueada", ou "Em chamada em #sala". */
export function activityText(a: Activity | undefined, call: string | undefined) {
  if (a) return [`Jogando ${games[a.game]}`, a.phase && gamePhaseLabel[a.phase], a.detail, minutes(a.since)].filter(Boolean).join(" · ");
  return call ? `Em chamada em ${call}` : undefined;
}

/** Linha de atividade (jogo ou chamada) abaixo do nome; não renderiza nada se a pessoa não está fazendo nada. */
export function ActivityLine({ userId, className = "" }: { userId: string; className?: string }) {
  const { activities, calls } = useContext(PresenceContext);
  const a = activities?.[userId];
  // Atualiza o "há X min" uma vez por minuto, só enquanto há jogo na tela.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!a) return;
    const t = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, [a]);
  const text = activityText(a, calls?.[userId]);
  return text ? <span className={`activity-line ${className}`} title={text}>{text}</span> : null;
}
