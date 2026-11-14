import { describe, expect, it } from "vitest";
import { createLcu } from "./client.js";

describe("Riot Client (chat)", () => {
  it("procura o Riot Client de novo quando a linha de comando veio sem ele", async () => {
    let tries = 0;
    const lcu = createLcu(async () => ({ port: 1, token: "x", riot: null }), async () => { tries++; return null; });
    await expect(lcu.request("GET", "/chat/v1/session", undefined, "riot")).rejects.toThrow("Riot Client");
    await expect(lcu.request("GET", "/chat/v1/session", undefined, "riot")).rejects.toThrow("Riot Client");
    expect(tries).toBe(2);
  });
});
