import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

describe("server", () => {
  it("GET /health responde ok", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });
});
