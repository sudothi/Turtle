/**
 * Regras puras das automações do LoL (sem rede), para testar sem o cliente aberto.
 * O formato da sessão segue `/lol-champ-select/v1/session` do cliente (LCU).
 */

export interface ChampAction { id: number; actorCellId: number; championId: number; type: string; completed: boolean; isInProgress?: boolean }
export interface ChampPlayer { cellId: number; championId: number; championPickIntent?: number; summonerId?: number | string; nameVisibilityType?: string; gameName?: string; tagLine?: string }
export interface ChampSession {
  localPlayerCellId?: number;
  actions?: ChampAction[][];
  myTeam?: ChampPlayer[];
  theirTeam?: ChampPlayer[];
  bans?: { myTeamBans?: number[]; theirTeamBans?: number[] };
  allowDuplicatePicks?: boolean;
}

/** -1 = campeão aleatório (entre os disponíveis). */
export const RANDOM = -1;

/** Credenciais tiradas da linha de comando do LeagueClientUx (`--app-port=…` etc.). */
export function parseCommandLine(cmd: string) {
  const arg = (name: string) => cmd.match(new RegExp(`--${name}=([^"\\s]+)`))?.[1];
  const port = Number(arg("app-port"));
  const token = arg("remoting-auth-token");
  const riotPort = Number(arg("riotclient-app-port"));
  const riotToken = arg("riotclient-auth-token");
  if (!port || !token) return null;
  return { port, token, riot: riotPort && riotToken ? { port: riotPort, token: riotToken } : null };
}

/** Conteúdo do `lockfile` (nome:pid:porta:senha:protocolo). Só dá o LCU, não o Riot Client. */
export function parseLockfile(text: string) {
  const [, , port, token] = text.trim().split(":");
  return Number(port) && token ? { port: Number(port), token, riot: null } : null;
}

const flat = (s: ChampSession) => (s.actions ?? []).flat().filter((a): a is ChampAction => !!a && typeof a === "object");

/** Minha ação da vez (ou a próxima) de um tipo: a em andamento primeiro, senão a primeira ainda aberta. */
export function myAction(s: ChampSession, type: "pick" | "ban") {
  const me = s.localPlayerCellId;
  if (me === undefined || me === null) return undefined;
  const mine = flat(s).filter((a) => a.actorCellId === me && a.type === type && !a.completed);
  return mine.find((a) => a.isInProgress) ?? mine[0];
}

/** Campeões já fora de alcance: banidos, travados por alguém, ou na mão de um aliado (intenção). */
export function takenChampions(s: ChampSession) {
  const me = s.localPlayerCellId;
  const out = new Set<number>([...(s.bans?.myTeamBans ?? []), ...(s.bans?.theirTeamBans ?? [])]);
  const myCells = new Set((s.myTeam ?? []).map((p) => p.cellId));
  for (const a of flat(s)) {
    if (!a.completed || a.championId <= 0) continue;
    // Ban sempre conta; pick travado só não conta quando o modo deixa repetir campeão entre os times.
    if (a.type === "ban" || !s.allowDuplicatePicks || myCells.has(a.actorCellId)) out.add(a.championId);
  }
  for (const p of s.myTeam ?? []) if (p.cellId !== me && p.championPickIntent && p.championPickIntent > 0) out.add(p.championPickIntent);
  return out;
}

/** O que travar: o principal (ou aleatório), senão a reserva. `undefined` = nenhum dá, a pessoa escolhe. */
export function choosePick(s: ChampSession, pickable: number[], champion: number, fallback: number | null, random = Math.random) {
  const taken = takenChampions(s);
  const free = pickable.filter((id) => id > 0 && !taken.has(id));
  if (champion === RANDOM) {
    const me = (s.myTeam ?? []).find((p) => p.cellId === s.localPlayerCellId);
    const kept = me?.championPickIntent && free.includes(me.championPickIntent) ? me.championPickIntent : undefined;
    if (kept) return kept; // mantém o aleatório já sorteado nesta seleção
    if (free.length) return free[Math.floor(random() * free.length)];
  } else if (free.includes(champion)) return champion;
  if (fallback && free.includes(fallback)) return fallback;
  return undefined;
}

/** Ban automático: não bane o que um aliado quer jogar nem o que já saiu. */
export function chooseBan(s: ChampSession, bannable: number[], champion: number | null) {
  if (!champion || !bannable.includes(champion)) return { id: undefined, reason: "indisponível" as const };
  const me = s.localPlayerCellId;
  const ally = (s.myTeam ?? []).find((p) => p.cellId !== me && p.championPickIntent === champion);
  if (ally) return { id: undefined, reason: "aliado" as const };
  if (takenChampions(s).has(champion)) return { id: undefined, reason: "indisponível" as const };
  return { id: champion, reason: null };
}

export type RevealProvider = "porofessor" | "opgg" | "ugg";
const UGG: Record<string, string> = { br: "br1", eune: "eun1", euw: "euw1", jp: "jp1", kr: "kr", lan: "la1", las: "la2", na: "na1", oce: "oc1", ru: "ru", tr: "tr1", ph: "ph2", sg: "sg2", th: "th2", tw: "tw2", vn: "vn2" };
export const REVEAL_HOSTS = ["porofessor.gg", "www.op.gg", "u.gg"];

/** Links de "multi-busca" do time (igual ao Tiamat). `names` em "Nome#TAG". */
export function revealUrl(provider: RevealProvider, region: string, names: string[]) {
  const r = region.toLowerCase();
  const list = encodeURIComponent(names.join(",")).replace(/%2C/g, ",");
  if (provider === "porofessor") return `https://porofessor.gg/pregame/${r}/${list}/soloqueue/season`;
  if (provider === "opgg") return `https://www.op.gg/multisearch/${r}?summoners=${list}`;
  const ugg = encodeURIComponent(names.map((n) => n.replace(/#([^#]*)$/, "-$1")).join(",")).replace(/%2C/g, ",");
  return `https://u.gg/lol/multisearch?summoners=${ugg}&region=${UGG[r] ?? r}`;
}
