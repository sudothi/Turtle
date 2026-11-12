import { describe, expect, it } from "vitest";
import { RANDOM, chooseBan, choosePick, myAction, parseCommandLine, parseLockfile, revealUrl, takenChampions, type ChampSession } from "./logic.js";

const session = (over: Partial<ChampSession> = {}): ChampSession => ({
  localPlayerCellId: 1,
  myTeam: [{ cellId: 0, championId: 0 }, { cellId: 1, championId: 0 }],
  theirTeam: [{ cellId: 5, championId: 0 }],
  actions: [[
    { id: 10, actorCellId: 1, championId: 0, type: "ban", completed: false, isInProgress: true },
    { id: 11, actorCellId: 5, championId: 0, type: "ban", completed: false, isInProgress: true },
  ], [
    { id: 20, actorCellId: 1, championId: 0, type: "pick", completed: false, isInProgress: false },
  ]],
  bans: { myTeamBans: [], theirTeamBans: [] },
  ...over,
});

describe("credenciais", () => {
  it("lê porta e senhas da linha de comando do LeagueClientUx", () => {
    const cmd = '"C:/Riot Games/League of Legends/LeagueClientUx.exe" "--riotclient-auth-token=AbC_1" "--riotclient-app-port=50001" "--remoting-auth-token=xyz-9" "--app-port=61234"';
    expect(parseCommandLine(cmd)).toEqual({ port: 61234, token: "xyz-9", riot: { port: 50001, token: "AbC_1" } });
    expect(parseCommandLine("notepad.exe")).toBeNull();
  });
  it("lê o lockfile", () => {
    expect(parseLockfile("LeagueClient:1234:61234:senha:https")).toEqual({ port: 61234, token: "senha", riot: null });
    expect(parseLockfile("")).toBeNull();
  });
});

describe("seleção de campeões", () => {
  it("acha minha ação da vez", () => {
    expect(myAction(session(), "ban")?.id).toBe(10);
    expect(myAction(session(), "pick")?.id).toBe(20);
    expect(myAction(session({ localPlayerCellId: undefined }), "pick")).toBeUndefined();
  });

  it("tira banidos, travados e o que um aliado quer jogar", () => {
    const s = session({
      bans: { myTeamBans: [1], theirTeamBans: [2] },
      myTeam: [{ cellId: 0, championId: 0, championPickIntent: 3 }, { cellId: 1, championId: 0, championPickIntent: 4 }],
      actions: [[{ id: 30, actorCellId: 5, championId: 5, type: "pick", completed: true }]],
    });
    expect([...takenChampions(s)].sort()).toEqual([1, 2, 3, 5]); // 4 é a minha intenção: não conta
  });

  it("pick: principal, senão reserva, senão nada", () => {
    expect(choosePick(session(), [7, 8], 7, 8)).toBe(7);
    expect(choosePick(session({ bans: { myTeamBans: [7] } }), [7, 8], 7, 8)).toBe(8);
    expect(choosePick(session({ bans: { myTeamBans: [7, 8] } }), [7, 8], 7, 8)).toBeUndefined();
    expect(choosePick(session(), [8], 7, null)).toBeUndefined(); // não tenho o 7
  });

  it("pick aleatório mantém o já sorteado", () => {
    expect(choosePick(session(), [7, 8, 9], RANDOM, null, () => 0.99)).toBe(9);
    const s = session({ myTeam: [{ cellId: 1, championId: 0, championPickIntent: 8 }] });
    expect(choosePick(s, [7, 8, 9], RANDOM, null, () => 0)).toBe(8);
  });

  it("ban não tira o campeão que um aliado quer", () => {
    expect(chooseBan(session(), [7], 7)).toEqual({ id: 7, reason: null });
    const s = session({ myTeam: [{ cellId: 0, championId: 0, championPickIntent: 7 }, { cellId: 1, championId: 0 }] });
    expect(chooseBan(s, [7], 7).reason).toBe("aliado");
    expect(chooseBan(session(), [8], 7).reason).toBe("indisponível");
  });
});

describe("revelar lobby", () => {
  const names = ["Tartaruga#BR1", "Peixe Gato#777"];
  it("monta os links de multi-busca", () => {
    expect(revealUrl("porofessor", "BR", names)).toBe("https://porofessor.gg/pregame/br/Tartaruga%23BR1,Peixe%20Gato%23777/soloqueue/season");
    expect(revealUrl("opgg", "br", names)).toBe("https://www.op.gg/multisearch/br?summoners=Tartaruga%23BR1,Peixe%20Gato%23777");
    expect(revealUrl("ugg", "br", names)).toBe("https://u.gg/lol/multisearch?summoners=Tartaruga-BR1,Peixe%20Gato-777&region=br1");
  });
});
