import nodemailer from "nodemailer";
import type { WaitlistNotice } from "./waitlist.js";

export function waitlistMailer(env: NodeJS.ProcessEnv): WaitlistNotice | undefined {
  if (!env.SMTP_HOST) return undefined;
  const from = env.SMTP_FROM;
  const port = Number(env.SMTP_PORT || 587);
  if (!from || !Number.isInteger(port) || port < 1 || port > 65535 || !!env.SMTP_USER !== !!env.SMTP_PASS || env.SMTP_SECURE && !["true", "false"].includes(env.SMTP_SECURE)) throw new Error("Configuração SMTP incompleta ou inválida.");
  const secure = env.SMTP_SECURE ? env.SMTP_SECURE === "true" : port === 465;
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST, port, secure, requireTLS: !secure,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS! } : undefined,
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 10_000,
    disableFileAccess: true, disableUrlAccess: true,
  });
  return async entry => {
    await transport.sendMail({
      from, to: env.WAITLIST_NOTIFY_TO || "tchemello@ucs.br", replyTo: entry.email,
      subject: "Turtle: novo cadastro na lista de espera",
      text: `Novo cadastro na lista de espera do Turtle.\n\nE-mail: ${entry.email}\nData: ${entry.createdAt.toISOString()}\n`,
    });
  };
}
