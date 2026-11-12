import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { Lcu } from "./client.js";
import { type ChampSession, type RevealProvider, RANDOM, chooseBan, choosePick, myAction, revealUrl } from "./logic.js";

/**
 * Game Automations do LoL (estilo Tiamat): aceitar partida, pick e ban automáticos, e as ferramentas
 * de seleção (revelar lobby, esquivar, reiniciar o cliente). Roda no processo principal; o site só
 * recebe o estado e manda configurações. Tudo começa desligado e fica guardado neste computador.
 */
export interface AutoConfig {
  accept: { on: boolean; delayMs: number };
  /** champion: id do campeão ou -1 (aleatório). */
  pick: { on: boolean; champion: number | null; fallback: number | null; delayMs: number };
  ban: { on: boolean; champion: number | null; delayMs: number };
  reveal: { provider: RevealProvider };
}
export type ClientState = "closed" | "open";
export interface LogLine { at: number; kind: "ok" | "info" | "warn" | "error"; text: string }
export interface AutoStatus { client: ClientState; phase: string | null; me: { name: string; icon: number } | null; log: LogLine[] }
export interface Champion { id: number; name: string; alias: string }
export interface RevealResult { players: string[]; region: string; links: Record<RevealProvider, string> }

export const DEFAULT_CONFIG: AutoConfig = {
  accept: { on: false, delayMs: 0 },
  pick: { on: false, champion: null, fallback: null, delayMs: 300 },
  ban: { on: false, champion: null, delayMs: 300 },
  reveal: { provider: "porofessor" },
};
const MAX_DELAY = 2000;
const LOG_MAX = 30;

const clampDelay = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(MAX_DELAY, Math.round(v))) : d);
const champ = (v: unknown, allowRandom = false) => (typeof v === "number" && Number.isInteger(v) && (v > 0 || (allowRandom && v === RANDOM)) ? v : null);
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);

/** Aceita só campos conhecidos com valores válidos (vale para o arquivo salvo e para o que vem do site). */
export function sanitize(input: unknown, base: AutoConfig = DEFAULT_CONFIG): AutoConfig {
  const i = (input && typeof input === "object" ? input : {}) as Record<string, any>;
  const pick = i.pick ?? {};
  const ban = i.ban ?? {};
  const accept = i.accept ?? {};
  const provider = i.reveal?.provider;
  const out: AutoConfig = {
    accept: { on: bool(accept.on, base.accept.on), delayMs: clampDelay(accept.delayMs, base.accept.delayMs) },
    pick: {
      on: bool(pick.on, base.pick.on),
      champion: "champion" in pick ? champ(pick.champion, true) : base.pick.champion,
      fallback: "fallback" in pick ? champ(pick.fallback) : base.pick.fallback,
      delayMs: clampDelay(pick.delayMs, base.pick.delayMs),
    },
    ban: { on: bool(ban.on, base.ban.on), champion: "champion" in ban ? champ(ban.champion) : base.ban.champion, delayMs: clampDelay(ban.delayMs, base.ban.delayMs) },
    reveal: { provider: provider === "opgg" || provider === "ugg" || provider === "porofessor" ? provider : base.reveal.provider },
  };
  if (out.pick.fallback === out.pick.champion) out.pick.fallback = null;
  return out;
}

const PHASE_FAST = new Set(["ReadyCheck", "ChampSelect"]);

export function createAutomations(opts: { lcu: Lcu; dir: string; onStatus: (s: AutoStatus) => void; now?: () => number }) {
  const { lcu, dir } = opts;
  const now = opts.now ?? Date.now;
  const file = join(dir, "game-automations.json");
  const iconDir = join(dir, "lol-icons");
  let config: AutoConfig = DEFAULT_CONFIG;
  let status: AutoStatus = { client: "closed", phase: null, me: null, log: [] };
  let watching = false;
  /** Faixa fora da chamada: quer saber quando o cliente abre, mas sem pressa. */
  let background = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let champions: Champion[] | null = null;
  /** Ações (pick/ban) já resolvidas nesta seleção, e quando cada uma ficou "minha vez". */
  const handled = new Set<number>();
  const hovered = new Set<number>();
  const turnSince = new Map<number, number>();
  const warned = new Set<string>();
  let acceptedAt = 0;
  let readyFound = 0;

  const emit = () => opts.onStatus(status);
  const log = (kind: LogLine["kind"], text: string) => {
    status = { ...status, log: [{ at: now(), kind, text }, ...status.log].slice(0, LOG_MAX) };
    emit();
  };
  const set = (patch: Partial<AutoStatus>) => {
    const next = { ...status, ...patch };
    if (JSON.stringify(next) === JSON.stringify(status)) return;
    status = next;
    emit();
  };
  const nameOf = (id: number | null) => champions?.find((c) => c.id === id)?.name ?? (id === RANDOM ? "aleatório" : `#${id}`);
  const anyOn = () => config.accept.on || config.pick.on || config.ban.on;

  async function load() {
    const text = await fs.readFile(file, "utf8").catch(() => "");
    try { config = sanitize(JSON.parse(text)); } catch { config = DEFAULT_CONFIG; }
    try { champions = JSON.parse(await fs.readFile(join(dir, "lol-champions.json"), "utf8")); } catch { champions = null; }
  }
  const save = () => fs.mkdir(dir, { recursive: true }).then(() => fs.writeFile(file, JSON.stringify(config, null, 2))).catch(() => undefined);

  function resetSelect() {
    handled.clear();
    hovered.clear();
    turnSince.clear();
    warned.clear();
  }

  async function loadMe() {
    const r = await lcu.request("GET", "/lol-summoner/v1/current-summoner").catch(() => undefined);
    const d = r?.status === 200 ? r.data : undefined;
    return d ? { name: [d.gameName ?? d.displayName, d.tagLine].filter(Boolean).join("#"), icon: Number(d.profileIconId) || 0 } : null;
  }

  async function acceptTick() {
    const r = await lcu.request("GET", "/lol-matchmaking/v1/ready-check");
    const rc = r.status === 200 ? r.data : undefined;
    if (!rc || rc.state !== "InProgress" || rc.playerResponse !== "None") { readyFound = 0; return; }
    if (!readyFound) readyFound = now();
    if (now() - readyFound < config.accept.delayMs || now() - acceptedAt < 1500) return;
    const res = await lcu.request("POST", "/lol-matchmaking/v1/ready-check/accept");
    if (res.status >= 200 && res.status < 300) {
      acceptedAt = now();
      log("ok", "Partida aceita");
    }
  }

  async function lock(actionId: number, championId: number, completed: boolean) {
    const r = await lcu.request("PATCH", `/lol-champ-select/v1/session/actions/${actionId}`, completed ? { championId, completed: true } : { championId });
    return r.status >= 200 && r.status < 300;
  }

  async function selectTick() {
    const r = await lcu.request("GET", "/lol-champ-select/v1/session");
    if (r.status !== 200 || !r.data) return;
    const s = r.data as ChampSession;
    const t = now();
    const ids = async (path: string) => {
      const x = await lcu.request("GET", path);
      return Array.isArray(x.data) ? (x.data as number[]) : [];
    };
    const warnOnce = (key: string, text: string) => { if (!warned.has(key)) { warned.add(key); log("warn", text); } };

    if (config.ban.on && config.ban.champion) {
      const a = myAction(s, "ban");
      if (a && a.isInProgress && !handled.has(a.id)) {
        if (!turnSince.has(a.id)) turnSince.set(a.id, t);
        if (t - turnSince.get(a.id)! >= config.ban.delayMs) {
          const ban = chooseBan(s, await ids("/lol-champ-select/v1/bannable-champion-ids"), config.ban.champion);
          if (ban.id) {
            if (await lock(a.id, ban.id, true)) { handled.add(a.id); log("ok", `${nameOf(ban.id)} banido`); }
          } else {
            handled.add(a.id);
            warnOnce(`ban${a.id}`, ban.reason === "aliado" ? `Não bani ${nameOf(config.ban.champion)}: um aliado quer jogar com ele. Escolha o ban.` : `${nameOf(config.ban.champion)} não pode ser banido agora. Escolha o ban.`);
          }
        }
      }
    }

    if (config.pick.on && config.pick.champion) {
      const a = myAction(s, "pick");
      if (a && !handled.has(a.id)) {
        const pickable = await ids("/lol-champ-select/v1/pickable-champion-ids");
        const id = choosePick(s, pickable, config.pick.champion, config.pick.fallback);
        if (!id) {
          if (a.isInProgress) warnOnce(`pick${a.id}`, "Nenhum dos campeões escolhidos está disponível. Escolha na mão.");
        } else if (!a.isInProgress) {
          // Antes da vez: só mostra a intenção ao time (o "hover"), uma vez por campeão.
          if (!hovered.has(id) && a.championId !== id && (await lock(a.id, id, false))) hovered.add(id);
        } else {
          if (!turnSince.has(a.id)) turnSince.set(a.id, t);
          if (t - turnSince.get(a.id)! >= config.pick.delayMs && (await lock(a.id, id, true))) {
            handled.add(a.id);
            log("ok", `${nameOf(id)} travado${id === config.pick.fallback ? " (reserva)" : ""}`);
          }
        }
      }
    }
  }

  async function tick() {
    if (!(await lcu.connect())) {
      if (status.client !== "closed") resetSelect();
      set({ client: "closed", phase: null, me: null });
      return watching ? 5000 : 15000;
    }
    const p = await lcu.request("GET", "/lol-gameflow/v1/gameflow-phase").catch(() => undefined);
    if (!p || p.status !== 200) {
      lcu.reset();
      set({ client: "closed", phase: null, me: null });
      return 3000;
    }
    const phase = typeof p.data === "string" ? p.data : null;
    if (status.client !== "open") {
      set({ client: "open", phase, me: await loadMe() });
      void champs(); // atualiza a lista e os nomes guardados
    }
    if (phase !== status.phase) {
      if (phase !== "ChampSelect") resetSelect();
      set({ phase });
    }
    if (phase === "ReadyCheck" && config.accept.on) await acceptTick();
    if (phase === "ChampSelect" && (config.pick.on || config.ban.on)) await selectTick();
    return phase && PHASE_FAST.has(phase) ? 400 : 1500;
  }

  function schedule(ms: number) {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (!watching && !background && !anyOn()) return;
    timer = setTimeout(loop, ms);
    timer.unref?.();
  }
  async function loop() {
    if (running) return;
    running = true;
    let next = 2000;
    try { next = await tick(); } catch { next = 2000; } finally { running = false; }
    schedule(next);
  }

  async function champs(): Promise<Champion[]> {
    const r = await lcu.request("GET", "/lol-game-data/assets/v1/champion-summary.json").catch(() => undefined);
    if (r?.status === 200 && Array.isArray(r.data)) {
      const list = (r.data as any[])
        .filter((c) => Number(c.id) > 0 && typeof c.name === "string")
        .map((c) => ({ id: Number(c.id), name: String(c.name), alias: String(c.alias ?? "") }))
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
      if (list.length) {
        champions = list;
        await fs.mkdir(dir, { recursive: true }).then(() => fs.writeFile(join(dir, "lol-champions.json"), JSON.stringify(list))).catch(() => undefined);
      }
    }
    return champions ?? [];
  }

  /** Ícone quadrado do campeão (data URL), guardado em disco para aparecer com o cliente fechado. */
  async function icon(id: number): Promise<string | null> {
    if (!Number.isInteger(id) || id <= 0) return null;
    const path = join(iconDir, `${id}.png`);
    let buf: Buffer | undefined = await fs.readFile(path).catch(() => undefined);
    if (!buf) {
      buf = await lcu.bytes(`/lol-game-data/assets/v1/champion-icons/${id}.png`);
      if (buf) await fs.mkdir(iconDir, { recursive: true }).then(() => fs.writeFile(path, buf!)).catch(() => undefined);
    }
    return buf ? `data:image/png;base64,${buf.toString("base64")}` : null;
  }

  async function needSelect() {
    if (!(await lcu.connect())) throw new Error("Abra o cliente do League of Legends.");
    const p = await lcu.request("GET", "/lol-gameflow/v1/gameflow-phase");
    if (p.data !== "ChampSelect") throw new Error("Só funciona na seleção de campeões.");
  }

  /** Nomes do meu time (igual ao Tiamat: na ranqueada os nomes ficam ocultos e vêm do chat do Riot Client). */
  async function reveal(): Promise<RevealResult> {
    await needSelect();
    const s = (await lcu.request("GET", "/lol-champ-select/v1/session")).data as ChampSession;
    const team = s?.myTeam ?? [];
    let players: string[] = [];
    if (team.some((p) => p.nameVisibilityType === "HIDDEN")) {
      const r = await lcu.request("GET", "/chat/v5/participants", undefined, "riot").catch(() => undefined);
      players = ((r?.data?.participants ?? []) as any[])
        .filter((p) => typeof p.cid === "string" && p.cid.includes("champ-select") && p.game_name)
        .map((p) => `${p.game_name}#${p.game_tag}`);
    } else {
      for (const p of team) {
        if (p.gameName) { players.push(`${p.gameName}#${p.tagLine}`); continue; }
        if (!p.summonerId || p.summonerId === "0") continue;
        const r = await lcu.request("GET", `/lol-summoner/v1/summoners/${p.summonerId}`).catch(() => undefined);
        if (r?.status === 200 && r.data?.gameName) players.push(`${r.data.gameName}#${r.data.tagLine}`);
      }
    }
    players = [...new Set(players)];
    const reg = await lcu.request("GET", "/riotclient/region-locale").catch(() => undefined);
    const region = String(reg?.data?.webRegion ?? "");
    if (!region || !players.length) throw new Error("Não consegui ler os nomes do lobby.");
    const links = { porofessor: revealUrl("porofessor", region, players), opgg: revealUrl("opgg", region, players), ugg: revealUrl("ugg", region, players) };
    log("info", `Lobby revelado (${players.length} jogadores)`);
    return { players, region, links };
  }

  /** Sai da seleção sem fechar o cliente (a penalidade de esquiva continua valendo). */
  async function dodge() {
    await needSelect();
    // Mesmo pedido do Tiamat/KBotExt (o "quitV2" do teambuilder), sem codificar a query.
    const path = '/lol-login/v1/session/invoke?destination=lcdsServiceProxy&method=call&args=["","teambuilder-draft","quitV2",""]';
    for (let i = 0; i < 3; i++) {
      const r = await lcu.request("POST", path).catch(() => undefined);
      if (r && r.status >= 200 && r.status < 300) { log("info", "Você esquivou da seleção"); return; }
    }
    throw new Error("Não consegui esquivar.");
  }

  async function restartUx() {
    if (!(await lcu.connect())) throw new Error("Abra o cliente do League of Legends.");
    const r = await lcu.request("POST", "/riotclient/kill-and-restart-ux");
    if (r.status < 200 || r.status >= 300) throw new Error("Não consegui reiniciar o cliente.");
    lcu.reset();
    resetSelect();
    log("info", "Cliente reiniciando");
  }

  return {
    async init() {
      await load();
      schedule(0);
    },
    getConfig: () => config,
    getStatus: () => status,
    setConfig(patch: unknown) {
      const p = (patch && typeof patch === "object" ? patch : {}) as Partial<Record<keyof AutoConfig, object>>;
      const merged = sanitize({ accept: { ...config.accept, ...p.accept }, pick: { ...config.pick, ...p.pick }, ban: { ...config.ban, ...p.ban }, reveal: { ...config.reveal, ...p.reveal } }, config);
      config = merged;
      void save();
      schedule(0);
      return config;
    },
    /** O painel aberto quer o estado ao vivo mesmo sem automação ligada. */
    watch(on: boolean) {
      watching = on;
      if (on) { emit(); schedule(0); }
    },
    /** Acompanha o cliente devagar (a cada 15 s com ele fechado) para a faixa saber quando o LoL abre. */
    background(on: boolean) {
      background = on;
      if (on) { emit(); schedule(0); }
    },
    champions: () => champs(),
    icon,
    reveal,
    dodge,
    restartUx,
    /** Para os testes: roda um ciclo agora. */
    tick,
    stop() {
      watching = false;
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
  };
}
export type Automations = ReturnType<typeof createAutomations>;
