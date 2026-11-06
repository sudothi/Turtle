/**
 * Limite de tentativas em memória (um processo só basta para o Turtle): guarda os horários
 * das últimas tentativas por chave e recusa quando passam de `max` dentro de `windowMs`.
 */
export function attemptLimiter({ max, windowMs }: { max: number; windowMs: number }) {
  const hits = new Map<string, number[]>();
  const recent = (key: string, now: number) => (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  /** Limpa chaves velhas de vez em quando para o mapa não crescer sem fim. */
  const prune = (now: number) => {
    if (hits.size < 5000) return;
    for (const [k, list] of hits) if (!list.some((t) => now - t < windowMs)) hits.delete(k);
  };
  return {
    /** Segundos até poder tentar de novo, ou 0 se ainda pode. */
    blockedFor(key: string, now = Date.now()) {
      const list = recent(key, now);
      return list.length >= max ? Math.ceil((list[0]! + windowMs - now) / 1000) : 0;
    },
    hit(key: string, now = Date.now()) {
      prune(now);
      const list = recent(key, now);
      list.push(now);
      hits.set(key, list);
    },
    reset(key: string) {
      hits.delete(key);
    },
  };
}
