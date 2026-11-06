import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { request } from "node:https";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Detector de jogos leve: a cada 30 s olha a lista de processos (tasklist/ps) contra uma lista fixa de
 * executáveis. Só quando um jogo da lista está aberto ele faz algo a mais: no LoL, pergunta a fase à API
 * local do cliente (LCU); no Roblox, lê o log mais novo para saber em qual jogo a pessoa entrou.
 * Nada sai do computador além de { game, phase, detail }, e só quando muda.
 */
export type GameId = "lol" | "valorant" | "cs2" | "dota2" | "fortnite" | "minecraft" | "roblox" | "gta5" | "rocketleague" | "apex";
export type Phase = "lobby" | "queue" | "champSelect" | "inGame" | null;
export interface Activity { game: GameId; phase: Phase; detail: string | null }

/** Nomes de executável (minúsculos, sem .exe) -> jogo. A ordem decide quando há mais de um aberto. */
const EXES: [string, GameId][] = [
  ["league of legends", "lol"], ["leagueclientux", "lol"], ["leagueclient", "lol"],
  ["valorant-win64-shipping", "valorant"],
  ["cs2", "cs2"],
  ["dota2", "dota2"],
  ["fortniteclient-win64-shipping", "fortnite"],
  ["robloxplayerbeta", "roblox"],
  ["gta5", "gta5"], ["gta5_enhanced", "gta5"],
  ["rocketleague", "rocketleague"],
  ["r5apex", "apex"], ["r5apex_dx12", "apex"],
  ["minecraft.windows", "minecraft"], ["minecraftlauncher", "minecraft"],
];
export const INTERVAL_MS = 30_000;

function processNames(): Promise<Set<string>> {
  const win = process.platform === "win32";
  return new Promise((resolve) => {
    execFile(win ? "tasklist" : "ps", win ? ["/fo", "csv", "/nh"] : ["-A", "-o", "comm="], { windowsHide: true, maxBuffer: 4 << 20, timeout: 10_000 }, (err, out) => {
      if (err) return resolve(new Set());
      const names = new Set<string>();
      for (const line of out.split(/\r?\n/)) {
        const raw = win ? line.split('","')[0]?.replace(/^"/, "") : line.trim().split("/").pop();
        if (raw) names.add(raw.toLowerCase().replace(/\.exe$/, ""));
      }
      resolve(names);
    });
  });
}

/** GET numa API local (127.0.0.1) com certificado próprio do jogo. */
function local(port: number, path: string, auth?: string): Promise<any> {
  return new Promise((resolve) => {
    const req = request(
      { host: "127.0.0.1", port, path, rejectUnauthorized: false, timeout: 3000, headers: auth ? { authorization: `Basic ${auth}` } : {} },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => { try { resolve(JSON.parse(body)); } catch { resolve(undefined); } });
      },
    );
    req.on("error", () => resolve(undefined));
    req.on("timeout", () => req.destroy());
    req.end();
  });
}

const LOL_LOCKFILES = ["C:\\Riot Games\\League of Legends\\lockfile", "D:\\Riot Games\\League of Legends\\lockfile", "/Applications/League of Legends.app/Contents/LoL/lockfile"];
async function lolState(): Promise<{ phase: Phase; detail: string | null }> {
  for (const file of LOL_LOCKFILES) {
    const text = await fs.readFile(file, "utf8").catch(() => "");
    const [, , port, password] = text.split(":");
    if (!port || !password) continue;
    const auth = Buffer.from(`riot:${password}`).toString("base64");
    const raw: unknown = await local(Number(port), "/lol-gameflow/v1/gameflow-phase", auth);
    const phase: Phase =
      raw === "Lobby" ? "lobby"
      : raw === "Matchmaking" || raw === "ReadyCheck" ? "queue"
      : raw === "ChampSelect" ? "champSelect"
      : raw === "GameStart" || raw === "InProgress" || raw === "Reconnect" ? "inGame"
      : null;
    if (!phase) return { phase: null, detail: null };
    const session = await local(Number(port), "/lol-gameflow/v1/session", auth);
    const queue = session?.gameData?.queue?.description;
    return { phase, detail: typeof queue === "string" && queue ? queue.slice(0, 60) : null };
  }
  return { phase: null, detail: null };
}

const robloxNames = new Map<string, string | null>();
function getJson(url: string): Promise<any> {
  return new Promise((resolve) => {
    const req = request(url, { timeout: 5000 }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => { try { resolve(JSON.parse(body)); } catch { resolve(undefined); } });
    });
    req.on("error", () => resolve(undefined));
    req.on("timeout", () => req.destroy());
    req.end();
  });
}
/** Nome do jogo do Roblox a partir do placeId (API pública), com cache para não repetir. */
async function robloxName(placeId: string) {
  if (robloxNames.has(placeId)) return robloxNames.get(placeId)!;
  const u = await getJson(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`);
  const g = u?.universeId ? await getJson(`https://games.roblox.com/v1/games?universeIds=${u.universeId}`) : undefined;
  const name = typeof g?.data?.[0]?.name === "string" ? (g.data[0].name as string).slice(0, 60) : null;
  robloxNames.set(placeId, name);
  return name;
}
async function robloxDetail(): Promise<string | null> {
  const dir = process.platform === "win32" ? join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "Roblox", "logs") : join(homedir(), "Library", "Logs", "Roblox");
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  let newest: { f: string; t: number } | undefined;
  for (const f of files) {
    if (!f.endsWith(".log")) continue;
    const t = (await fs.stat(join(dir, f)).catch(() => undefined))?.mtimeMs ?? 0;
    if (!newest || t > newest.t) newest = { f, t };
  }
  if (!newest) return null;
  // Só o fim do arquivo: o log pode ser grande.
  const fh = await fs.open(join(dir, newest.f), "r").catch(() => undefined);
  if (!fh) return null;
  try {
    const { size } = await fh.stat();
    const len = Math.min(size, 256 * 1024);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, size - len);
    const ids = [...buf.toString("utf8").matchAll(/place(?:Id=|\s+)(\d{3,15})/gi)];
    const id = ids.at(-1)?.[1];
    return id ? await robloxName(id) : null;
  } finally {
    await fh.close();
  }
}

export async function detect(): Promise<Activity | null> {
  const names = await processNames();
  const game = EXES.find(([exe]) => names.has(exe))?.[1];
  if (!game) return null;
  if (game === "lol") {
    const s = await lolState();
    // Cliente aberto parado no menu: mostra só "Jogando League of Legends"; o processo da partida conta como em partida.
    return { game, phase: s.phase ?? (names.has("league of legends") ? "inGame" : null), detail: s.detail };
  }
  if (game === "roblox") return { game, phase: null, detail: await robloxDetail() };
  return { game, phase: null, detail: null };
}

/** Roda o detector a cada 30 s enquanto ligado; chama `onChange` só quando o resultado muda. */
export function watchGames(onChange: (a: Activity | null) => void) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let last = "null";
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const a = await detect().catch(() => null);
      const key = JSON.stringify(a);
      if (key !== last) {
        last = key;
        onChange(a);
      }
    } finally {
      busy = false;
    }
  };
  return {
    set(on: boolean) {
      if (on && !timer) {
        void tick();
        timer = setInterval(tick, INTERVAL_MS);
        timer.unref?.();
      } else if (!on && timer) {
        clearInterval(timer);
        timer = undefined;
        if (last !== "null") (last = "null"), onChange(null);
      }
    },
    /** Reenvia o estado atual (ex.: a página recarregou ou o WebSocket reconectou). */
    replay() {
      onChange(JSON.parse(last));
    },
  };
}
