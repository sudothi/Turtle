import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, waitlistEntries, type DbHandle } from "@turtle/db";
import { buildApp } from "./app.js";
import { deliverWaitlistNotices } from "./waitlist.js";

let handle: DbHandle;
let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => { handle = await createDb(); app = await buildApp({ db: handle.db }); });
beforeEach(async () => { await handle.db.delete(waitlistEntries); });
afterAll(async () => { await app.close(); await handle.close(); });
const signup = (body: unknown, remoteAddress = "203.0.113.1") => app.inject({ method: "POST", url: "/waitlist", payload: body as object, remoteAddress });

describe("public waiting list", () => {
  it("persists a normalized address without authentication or an SMTP provider", async () => {
    const response = await signup({ email: "  Amigo@Example.TEST " });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ ok: true });
    const rows = await handle.db.select().from(waitlistEntries);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: "amigo@example.test", notificationSentAt: null, notificationAttemptedAt: null });
  });
  it("deduplicates retries without revealing whether the address was already registered", async () => {
    const first = await signup({ email: "amigo@example.test" }, "203.0.113.2");
    const second = await signup({ email: "AMIGO@example.test" }, "203.0.113.2");
    expect(first.statusCode).toBe(202);
    expect(second.json()).toEqual(first.json());
    expect(await handle.db.select().from(waitlistEntries)).toHaveLength(1);
  });
  it("rejects invalid addresses and header injection without persisting them", async () => {
    for (const [index, email] of ["", "not-an-email", "a@b.test\r\nBcc: other@example.test", "x".repeat(255) + "@example.test"].entries()) {
      expect((await signup({ email }, `203.0.113.${10 + index}`)).statusCode).toBe(400);
    }
    expect(await handle.db.select().from(waitlistEntries)).toEqual([]);
  });
  it("limits submissions by IP and returns a retry time", async () => {
    for (let i = 0; i < 5; i++) expect((await signup({ email: "same@example.test" }, "203.0.113.20")).statusCode).toBe(202);
    const blocked = await signup({ email: "same@example.test" }, "203.0.113.20");
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    expect((await signup({ email: "other@example.test" }, "203.0.113.21")).statusCode).toBe(202);
  });
  it("does not expose a public list of addresses", async () => {
    expect((await app.inject({ method: "GET", url: "/waitlist" })).statusCode).toBe(404);
  });
});

describe("persisted waitlist notifications", () => {
  it("delivers pending signups once even when two workers claim the same row", async () => {
    await handle.db.insert(waitlistEntries).values({ email: "amigo@example.test" });
    const notify = vi.fn(async () => {});
    const failed = vi.fn();
    await Promise.all([deliverWaitlistNotices(handle.db, notify, failed), deliverWaitlistNotices(handle.db, notify, failed)]);
    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ email: "amigo@example.test", createdAt: expect.any(Date) }));
    expect(failed).not.toHaveBeenCalled();
    expect((await handle.db.select().from(waitlistEntries))[0]!.notificationSentAt).toBeInstanceOf(Date);
    await deliverWaitlistNotices(handle.db, notify, failed);
    expect(notify).toHaveBeenCalledOnce();
  });
  it("keeps failed delivery pending and retries after the backoff", async () => {
    await handle.db.insert(waitlistEntries).values({ email: "amigo@example.test" });
    const notify = vi.fn(async () => {}).mockRejectedValueOnce(new Error("SMTP unavailable"));
    const failed = vi.fn();
    const now = new Date();
    await deliverWaitlistNotices(handle.db, notify, failed, now);
    expect(failed).toHaveBeenCalledOnce();
    expect((await handle.db.select().from(waitlistEntries))[0]!.notificationSentAt).toBeNull();
    await deliverWaitlistNotices(handle.db, notify, failed, new Date(now.getTime() + 60_000));
    expect(notify).toHaveBeenCalledOnce();
    await deliverWaitlistNotices(handle.db, notify, failed, new Date(now.getTime() + 5 * 60_000 + 1));
    expect(notify).toHaveBeenCalledTimes(2);
    expect((await handle.db.select().from(waitlistEntries))[0]!.notificationSentAt).toBeInstanceOf(Date);
  });
  it("resumes an interrupted claim after a restart without requiring signup again", async () => {
    await handle.db.insert(waitlistEntries).values({ email: "amigo@example.test", notificationAttemptedAt: new Date(Date.now() - 6 * 60_000) });
    const notify = vi.fn(async () => {});
    await deliverWaitlistNotices(handle.db, notify, vi.fn());
    expect(notify).toHaveBeenCalledOnce();
  });
});
