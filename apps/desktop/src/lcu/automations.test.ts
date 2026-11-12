import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Lcu, LcuResponse } from "./client.js";
import { createAutomations, sanitize, type AutoStatus } from "./automations.js";
import type { ChampSession } from "./logic.js";

/** Cliente do LoL de mentira: guarda a fase e a sessão, e anota cada pedido. */
function fakeLol() {
  const calls: string[] = [];
  const state = {
    open: true,
    phase: "Lobby",
    ready: { state: "InProgress", playerResponse: "None" },
    session: {
      localPlayerCellId: 1,
      myTeam: [{ cellId: 0, championId: 0 }, { cellId: 1, championId: 0 }],
      theirTeam: [],
      actions: [[{ id: 10, actorCellId: 1, championId: 0, type: "ban", completed: false, isInProgress: true }], [{ id: 20, actorCellId: 1, championId: 0, type: "pick", completed: false, isInProgress: false }]],
      bans: {},
    } as ChampSession,
  };
  const ok = (data?: unknown): LcuResponse => ({ status: 200, data });
  const lcu: Lcu = {
    connect: async () => state.open,
    reset: () => undefined,
    bytes: async () => undefined,
    async request(method, path, body) {
      calls.push(`${method} ${path}${body ? " " + JSON.stringify(body) : ""}`);
      if (path === "/lol-gameflow/v1/gameflow-phase") return ok(state.phase);
      if (path === "/lol-matchmaking/v1/ready-check") return ok(state.ready);
      if (path === "/lol-matchmaking/v1/ready-check/accept") { state.ready = { state: "InProgress", playerResponse: "Accepted" }; return { status: 204, data: undefined }; }
      if (path === "/lol-champ-select/v1/session") return ok(state.session);
      if (path.endsWith("pickable-champion-ids")) return ok([7, 8]);
      if (path.endsWith("bannable-champion-ids")) return ok([7, 8, 9]);
      if (method === "PATCH") {
        const id = Number(path.split("/").pop());
        const a = state.session.actions!.flat().find((x) => x.id === id)!;
        Object.assign(a, body);
        return { status: 204, data: undefined };
      }
      return { status: 404, data: undefined };
    },
  };
  return { lcu, state, calls };
}

function setup() {
  const lol = fakeLol();
  let t = 1000;
  const seen: AutoStatus[] = [];
  const auto = createAutomations({ lcu: lol.lcu, dir: mkdtempSync(join(tmpdir(), "turtle-auto-")), onStatus: (s) => seen.push(s), now: () => t });
  return { ...lol, auto, seen, advance: (ms: number) => (t += ms) };
}

describe("sanitize", () => {
  it("ignora lixo e limita o atraso", () => {
    const c = sanitize({ accept: { on: "sim", delayMs: 99_999 }, pick: { champion: 7, fallback: 7 }, reveal: { provider: "x" } });
    expect(c.accept).toEqual({ on: false, delayMs: 2000 });
    expect(c.pick.fallback).toBeNull(); // reserva igual ao principal não faz sentido
    expect(c.reveal.provider).toBe("porofessor");
  });
});

describe("automações", () => {
  it("aceita a partida depois do atraso, uma vez", async () => {
    const { auto, state, calls, advance } = setup();
    auto.setConfig({ accept: { on: true, delayMs: 500 } });
    state.phase = "ReadyCheck";
    await auto.tick();
    expect(calls.filter((c) => c.includes("accept"))).toHaveLength(0);
    advance(600);
    await auto.tick();
    await auto.tick();
    expect(calls.filter((c) => c.startsWith("POST /lol-matchmaking/v1/ready-check/accept"))).toHaveLength(1);
    expect(auto.getStatus().log[0]!.text).toBe("Partida aceita");
    auto.stop();
  });

  it("não faz nada desligado", async () => {
    const { auto, state, calls } = setup();
    state.phase = "ReadyCheck";
    await auto.tick();
    expect(calls.some((c) => c.includes("accept"))).toBe(false);
    auto.stop();
  });

  it("bane, mostra a intenção e trava o pick na vez", async () => {
    const { auto, state, calls, advance } = setup();
    auto.setConfig({ ban: { on: true, champion: 9, delayMs: 0 }, pick: { on: true, champion: 7, fallback: 8, delayMs: 0 } });
    state.phase = "ChampSelect";
    await auto.tick();
    expect(calls).toContain('PATCH /lol-champ-select/v1/session/actions/10 {"championId":9,"completed":true}');
    expect(calls).toContain('PATCH /lol-champ-select/v1/session/actions/20 {"championId":7}'); // hover antes da vez
    // Chega a minha vez, e o inimigo baniu o 7: vai a reserva.
    const pick = state.session.actions![1]![0]!;
    pick.isInProgress = true;
    state.session.bans = { theirTeamBans: [7] };
    advance(100);
    await auto.tick();
    expect(calls).toContain('PATCH /lol-champ-select/v1/session/actions/20 {"championId":8,"completed":true}');
    expect(auto.getStatus().log.map((l) => l.text)).toContain("#8 travado (reserva)");
    auto.stop();
  });

  it("não bane o campeão que um aliado quer jogar", async () => {
    const { auto, state, calls } = setup();
    auto.setConfig({ ban: { on: true, champion: 9, delayMs: 0 } });
    state.session.myTeam![0]!.championPickIntent = 9;
    state.phase = "ChampSelect";
    await auto.tick();
    expect(calls.some((c) => c.startsWith("PATCH"))).toBe(false);
    expect(auto.getStatus().log[0]!.kind).toBe("warn");
    auto.stop();
  });

  it("ferramentas exigem a seleção de campeões", async () => {
    const { auto } = setup();
    await expect(auto.dodge()).rejects.toThrow("seleção");
    await expect(auto.reveal()).rejects.toThrow("seleção");
  });

  it("cliente fechado aparece como fechado", async () => {
    const { auto, state } = setup();
    state.open = false;
    await auto.tick();
    expect(auto.getStatus().client).toBe("closed");
  });
});
