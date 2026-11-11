import { beforeEach, describe, expect, it, vi } from "vitest";
const mail = vi.hoisted(() => ({ send: vi.fn(async () => ({})), transport: vi.fn() }));
vi.mock("nodemailer", () => ({ default: { createTransport: mail.transport } }));
import { waitlistMailer } from "./waitlist-mail.js";
beforeEach(() => { vi.clearAllMocks(); mail.transport.mockReturnValue({ sendMail: mail.send }); });
const config = { SMTP_HOST: "smtp.example.test", SMTP_FROM: "Turtle <turtle@example.test>", SMTP_USER: "sender", SMTP_PASS: "test-only", WAITLIST_NOTIFY_TO: "dono@example.test" };
describe("waiting list SMTP", () => {
  it("stays disabled until a service is configured", () => {
    expect(waitlistMailer({})).toBeUndefined();
    expect(mail.transport).not.toHaveBeenCalled();
  });
  it("stays disabled without a recipient", () => {
    expect(waitlistMailer({ ...config, WAITLIST_NOTIFY_TO: "" })).toBeUndefined();
  });
  it("sends the notification to the requested recipient with the signup in the text and reply-to", async () => {
    const notify = waitlistMailer(config)!;
    await notify({ email: "amigo@example.test", createdAt: new Date("2026-11-09T12:00:00Z") });
    expect(mail.send).toHaveBeenCalledWith(expect.objectContaining({ to: "dono@example.test", from: config.SMTP_FROM, replyTo: "amigo@example.test", text: expect.stringContaining("amigo@example.test") }));
    expect(mail.transport).toHaveBeenCalledWith(expect.objectContaining({ port: 587, secure: false, requireTLS: true, disableFileAccess: true, disableUrlAccess: true }));
  });
  it("supports implicit TLS on port 465", () => {
    waitlistMailer({ ...config, SMTP_PORT: "465" });
    expect(mail.transport).toHaveBeenCalledWith(expect.objectContaining({ port: 465, secure: true }));
  });
  it("propagates SMTP failures so delivery remains pending", async () => {
    mail.send.mockRejectedValueOnce(new Error("SMTP unavailable"));
    await expect(waitlistMailer(config)!({ email: "amigo@example.test", createdAt: new Date() })).rejects.toThrow("SMTP unavailable");
  });
  it("rejects partial configuration instead of silently dropping mail", () => {
    expect(() => waitlistMailer({ SMTP_HOST: config.SMTP_HOST })).toThrow();
    expect(() => waitlistMailer({ ...config, SMTP_PASS: "" })).toThrow();
    expect(() => waitlistMailer({ ...config, SMTP_PORT: "invalid" })).toThrow();
    expect(() => waitlistMailer({ ...config, SMTP_SECURE: "invalid" })).toThrow();
  });
});
