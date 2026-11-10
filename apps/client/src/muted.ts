import { useSyncExternalStore } from "react";

/**
 * Servidores e canais silenciados (só neste computador): não tocam som nem mostram notificação do sistema,
 * mas continuam contando como não lidos.
 */
const KEY = "turtle.muted";
interface Muted {
  servers: string[];
  channels: string[];
}
const empty: Muted = { servers: [], channels: [] };

let cache: Muted | undefined;
const listeners = new Set<() => void>();

function read(): Muted {
  if (cache) return cache;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Muted>;
    cache = { servers: Array.isArray(raw.servers) ? raw.servers : [], channels: Array.isArray(raw.channels) ? raw.channels : [] };
  } catch {
    cache = empty;
  }
  return cache;
}

function write(next: Muted) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // sem storage: vale só nesta sessão
  }
  listeners.forEach((l) => l());
}

const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
export const toggleServerMuted = (id: string) => write({ ...read(), servers: toggle(read().servers, id) });
export const toggleChannelMuted = (id: string) => write({ ...read(), channels: toggle(read().channels, id) });

/** Conversa direta (sem servidor) nunca é silenciada por aqui. */
export const isMuted = (channelId: string, serverId: string | null | undefined) => {
  const m = read();
  return m.channels.includes(channelId) || (!!serverId && m.servers.includes(serverId));
};

export function useMuted(): Muted {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
  );
}
