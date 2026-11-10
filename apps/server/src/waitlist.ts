import type { FastifyInstance } from "fastify";
import { and, asc, eq, isNull, lt, or, waitlistEntries, type Db } from "@turtle/db";
import { waitlistBody } from "@turtle/protocol";
import { attemptLimiter } from "./limiter.js";

export type WaitlistNotice = (entry: { email: string; createdAt: Date }) => Promise<void>;
const RETRY_MS = 5 * 60_000;

/** A persisted claim prevents simultaneous requests/workers from sending the same notice. */
export async function deliverWaitlistNotices(db: Db, notify: WaitlistNotice, failed: () => void, now = new Date()) {
  const pending = () => and(isNull(waitlistEntries.notificationSentAt), or(isNull(waitlistEntries.notificationAttemptedAt), lt(waitlistEntries.notificationAttemptedAt, new Date(now.getTime() - RETRY_MS))));
  const entries = await db.select().from(waitlistEntries).where(pending()).orderBy(asc(waitlistEntries.createdAt)).limit(10);
  for (const entry of entries) {
    const [claimed] = await db.update(waitlistEntries).set({ notificationAttemptedAt: now }).where(and(eq(waitlistEntries.email, entry.email), pending())).returning();
    if (!claimed) continue;
    try {
      await notify(claimed);
      await db.update(waitlistEntries).set({ notificationSentAt: new Date() }).where(eq(waitlistEntries.email, claimed.email));
    } catch {
      failed();
    }
  }
}

export function registerWaitlist(app: FastifyInstance, db: Db, notify?: WaitlistNotice) {
  const limit = attemptLimiter({ max: 5, windowMs: 10 * 60_000 });
  let running: Promise<void> | undefined;
  const flush = () => {
    if (!notify) return Promise.resolve();
    return running ??= deliverWaitlistNotices(db, notify, () => app.log.warn("Falha ao encaminhar cadastro da waiting list; nova tentativa será feita."))
      .catch(() => app.log.error("Falha ao processar notificações da waiting list."))
      .finally(() => { running = undefined; });
  };
  let timer: ReturnType<typeof setInterval> | undefined;
  app.addHook("onReady", async () => {
    if (!notify) return;
    void flush();
    timer = setInterval(() => { void flush(); }, 30_000);
    timer.unref();
  });
  app.addHook("onClose", async () => { clearInterval(timer); await running; });

  app.post("/waitlist", { bodyLimit: 1024 }, async (request, reply) => {
    const blocked = limit.blockedFor(request.ip);
    if (blocked) return reply.header("retry-after", blocked).code(429).send({ error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." });
    limit.hit(request.ip);
    const result = waitlistBody.safeParse(request.body);
    if (!result.success) return reply.code(400).send({ error: "Informe um e-mail válido." });
    await db.insert(waitlistEntries).values({ email: result.data.email }).onConflictDoNothing();
    void flush();
    return reply.code(202).send({ ok: true });
  });
}
