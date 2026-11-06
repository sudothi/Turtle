import type { Message } from "@turtle/protocol";

const time = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const date = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
const longDate = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", year: "numeric" });

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

export const shortTime = (iso: string) => time.format(new Date(iso));
export const dayLabel = (iso: string) => longDate.format(new Date(iso));

/** "Hoje às 20:53", "Ontem às 09:10" ou "03/11/2026 20:53", como no Discord. */
export function stamp(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return `Hoje às ${time.format(d)}`;
  if (sameDay(d, yesterday)) return `Ontem às ${time.format(d)}`;
  return `${date.format(d)} ${time.format(d)}`;
}

export type Row =
  | { kind: "day"; key: string; label: string }
  | { kind: "msg"; key: string; message: Message; head: boolean };

/** Agrupa mensagens seguidas do mesmo autor (até 7 min, sem ser resposta) e insere divisores de dia. */
export function toRows(messages: Message[]): Row[] {
  const rows: Row[] = [];
  let prev: Message | undefined;
  for (const m of messages) {
    const d = new Date(m.createdAt);
    const pd = prev && new Date(prev.createdAt);
    const newDay = !pd || !sameDay(pd, d);
    if (newDay) rows.push({ kind: "day", key: `day-${m.id}`, label: dayLabel(m.createdAt) });
    // Resposta sempre abre um bloco novo (a linha da mensagem citada fica em cima do nome).
    const head = newDay || !prev || !!m.replyToId || prev.userId !== m.userId || d.getTime() - pd!.getTime() > 7 * 60_000;
    rows.push({ kind: "msg", key: m.id, message: m, head });
    prev = m;
  }
  return rows;
}
