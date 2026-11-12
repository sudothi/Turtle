// Conexão com a VPS pelo `ssh` do sistema. Só chave (BatchMode): nunca pede nem recebe senha.
import { spawn } from "node:child_process";
import { dim, line } from "./ui.mjs";

/** @param {import("./config.mjs").Config} c */
export function sshArgs(c, /** @type {string} */ remote) {
  return [
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "ConnectTimeout=15",
    "-o", "ServerAliveInterval=30",
    "-p", c.port,
    ...(c.key ? ["-i", c.key, "-o", "IdentitiesOnly=yes"] : []),
    `${c.user}@${c.ip}`,
    remote,
  ];
}

/**
 * Roda um script bash na VPS (`ssh … bash -s`), com a saída ecoada no terminal.
 * @param {import("./config.mjs").Config} c
 * @param {string} script
 * @param {{ quiet?: boolean, input?: NodeJS.ReadableStream, onLine?: (l: string) => void }} [opt]
 * @returns {Promise<{ code: number, out: string }>}
 */
export function run(c, script, opt = {}) {
  return new Promise((done) => {
    // Com `input` (um tar, por exemplo), o script vai como argumento e o stdin fica livre para os dados.
    const remote = opt.input ? `bash -c ${shellQuote(script)}` : "bash -s";
    const child = spawn("ssh", sshArgs(c, remote), { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let rest = "";
    const feed = (/** @type {Buffer} */ b) => {
      const s = b.toString();
      out += s;
      rest += s;
      const parts = rest.split("\n");
      rest = parts.pop() ?? "";
      for (const l of parts) {
        if (!l.trim()) continue;
        opt.onLine?.(l);
        if (!opt.quiet) line(l.length > 160 ? l.slice(0, 157) + "…" : l);
      }
    };
    child.stdout.on("data", feed);
    child.stderr.on("data", feed);
    child.on("error", (/** @type {NodeJS.ErrnoException} */ e) =>
      done({ code: 127, out: e.code === "ENOENT" ? "ssh não encontrado: instale o cliente OpenSSH (no Windows: Configurações > Recursos opcionais)." : String(e) }),
    );
    child.on("close", (code) => {
      if (rest.trim() && !opt.quiet) line(rest);
      done({ code: code ?? 1, out });
    });
    if (opt.input) opt.input.pipe(child.stdin);
    else child.stdin.end(script);
  });
}

/** Aspas simples do shell para um script inteiro. */
export function shellQuote(/** @type {string} */ s) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Mensagem de ajuda quando a chave não entra. */
export const sshHelp = (/** @type {import("./config.mjs").Config} */ c) =>
  [
    `Não consegui entrar em ${c.user}@${c.ip}:${c.port} com chave.`,
    "Confira: o IP e o usuário; se a sua chave pública está em ~/.ssh/authorized_keys na VPS;",
    `e, se a chave não é a padrão, passe --key ${dim("caminho/da/chave")}.`,
    `Teste por fora:  ssh -p ${c.port} ${c.user}@${c.ip}`,
  ].join("\n  ");
