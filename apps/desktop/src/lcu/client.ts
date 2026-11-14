import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { Agent, request } from "node:https";
import { join } from "node:path";
import { parseCommandLine, parseLockfile } from "./logic.js";

/**
 * Conversa com o cliente do League of Legends pela API local dele (LCU), só em 127.0.0.1.
 * Porta e senha vêm da linha de comando do LeagueClientUx (dá também o Riot Client, para o chat)
 * ou, na falta, do `lockfile`. Nada aqui lê memória do jogo nem sai do computador.
 */
export interface LcuResponse { status: number; data: any }
export type Service = "lcu" | "riot";
export interface Lcu {
  /** Acha o cliente (no máximo a cada poucos segundos). false = fechado. */
  connect(): Promise<boolean>;
  request(method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", path: string, body?: unknown, service?: Service, timeoutMs?: number): Promise<LcuResponse>;
  /** Bytes crus (ícones de campeão). */
  bytes(path: string): Promise<Buffer | undefined>;
  /** Esquece a porta/senha (o cliente reiniciou ou fechou). */
  reset(): void;
}

interface Endpoint { port: number; token: string }
interface Creds extends Endpoint { riot: Endpoint | null }

const LOCKFILES = ["C:\\Riot Games\\League of Legends\\lockfile", "D:\\Riot Games\\League of Legends\\lockfile", "/Applications/League of Legends.app/Contents/LoL/lockfile"];
const RETRY_MS = 5000;
/** Lockfile do Riot Client (chat). Serve quando a linha de comando do LoL não veio. */
const riotLockfile = () => process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Riot Games", "Riot Client", "Config", "lockfile") : "";
const agent = new Agent({ keepAlive: true, maxSockets: 4 });

const run = (cmd: string, args: string[], timeout = 8000) =>
  new Promise<string>((resolve) =>
    execFile(cmd, args, { windowsHide: true, timeout, maxBuffer: 4 << 20 }, (err, out) => resolve(err ? "" : String(out))),
  );

/** Linha de comando do LeagueClientUx. No Windows, só chama o PowerShell se o processo existir (tasklist é leve). */
async function commandLine() {
  if (process.platform === "win32") {
    const list = await run("tasklist", ["/fi", "imagename eq LeagueClientUx.exe", "/fo", "csv", "/nh"]);
    if (!/leagueclientux\.exe/i.test(list)) return "";
    // PowerShell frio demora em PC mais lento; WriteLine evita quebra de linha na saída. wmic é o plano B.
    const ps = await run("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command",
      "Get-CimInstance -ClassName Win32_Process -Filter 'Name=''LeagueClientUx.exe''' |ForEach-Object { [Console]::Out.WriteLine($_.CommandLine) }",
    ], 20000);
    if (/--app-port=/.test(ps)) return ps;
    return run("wmic", ["process", "where", "name='LeagueClientUx.exe'", "get", "commandline", "/value"], 15000);
  }
  const all = await run("ps", ["-A", "-o", "args="]);
  return all.split("\n").find((l) => /LeagueClientUx/.test(l)) ?? "";
}

const readLock = async (f: string) => (f ? parseLockfile(await fs.readFile(f, "utf8").catch(() => "")) : null);

/** Porta e senha do Riot Client pelo lockfile dele (Windows). */
export async function findRiotFromLockfile(): Promise<Endpoint | null> {
  const c = await readLock(riotLockfile());
  return c ? { port: c.port, token: c.token } : null;
}

export async function findCredentials(): Promise<Creds | null> {
  const fromCmd = parseCommandLine(await commandLine());
  if (fromCmd) return fromCmd.riot ? fromCmd : { ...fromCmd, riot: await findRiotFromLockfile() };
  for (const f of LOCKFILES) {
    const c = await readLock(f);
    if (c) return { ...c, riot: await findRiotFromLockfile() };
  }
  return null;
}

function call(ep: Endpoint, method: string, path: string, body?: unknown, raw = false, timeout = 5000): Promise<{ status: number; data: any }> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1", port: ep.port, path, method, agent,
        // O cliente usa um certificado próprio (autoassinado) em 127.0.0.1.
        rejectUnauthorized: false, timeout,
        headers: {
          authorization: `Basic ${Buffer.from(`riot:${ep.token}`).toString("base64")}`,
          accept: raw ? "*/*" : "application/json",
          ...(payload !== undefined ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          if (raw) return resolve({ status: res.statusCode ?? 0, data: buf });
          let data: any;
          try { data = buf.length ? JSON.parse(buf.toString("utf8")) : undefined; } catch { data = buf.toString("utf8"); }
          resolve({ status: res.statusCode ?? 0, data });
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

export function createLcu(find: () => Promise<Creds | null> = findCredentials, findRiot: () => Promise<Endpoint | null> = findRiotFromLockfile): Lcu {
  let creds: Creds | null = null;
  let lastTry = 0;
  let finding: Promise<boolean> | undefined;
  const self: Lcu = {
    async connect() {
      if (creds) return true;
      if (finding) return finding;
      if (Date.now() - lastTry < RETRY_MS) return false;
      lastTry = Date.now();
      finding = find().then((c) => { creds = c; return !!c; }).catch(() => false).finally(() => { finding = undefined; });
      return finding;
    },
    async request(method, path, body, service = "lcu", timeoutMs) {
      if (!(await self.connect()) || !creds) throw new Error("cliente fechado");
      // O Riot Client pode ter aberto depois (ou a linha de comando veio sem ele): procura de novo.
      if (service === "riot" && !creds.riot) creds.riot = await findRiot().catch(() => null);
      const ep = service === "riot" ? creds.riot : creds;
      if (!ep) throw new Error("Não achei o Riot Client. Feche e abra o LoL de novo.");
      try {
        return await call(ep, method, path, body, false, timeoutMs);
      } catch (e) {
        self.reset(); // porta mudou ou o cliente fechou: a próxima chamada procura de novo
        throw e;
      }
    },
    async bytes(path) {
      if (!(await self.connect()) || !creds) return undefined;
      const r = await call(creds, "GET", path, undefined, true).catch(() => undefined);
      return r && r.status === 200 ? (r.data as Buffer) : undefined;
    },
    reset() {
      creds = null;
      lastTry = 0;
    },
  };
  return self;
}

/** Um só cliente por app: a rich presence e as automações dividem a mesma descoberta. */
export const sharedLcu = createLcu();
