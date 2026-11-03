import { describe, expect, it } from "vitest";
import { clientEvent } from "./index.js";

describe("protocol", () => {
  it("aceita ping", () => {
    expect(clientEvent.parse({ t: "ping" })).toEqual({ t: "ping" });
  });
  it("rejeita evento desconhecido", () => {
    expect(() => clientEvent.parse({ t: "nope" })).toThrow();
  });
});
