import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });

describe("servidores e canais silenciados", () => {
  beforeEach(() => {
    store.clear();
    vi.resetModules();
  });

  it("silencia o canal ou o servidor inteiro, e a conversa direta nunca", async () => {
    const m = await import("./muted");
    expect(m.isMuted("c1", "s1")).toBe(false);
    m.toggleChannelMuted("c1");
    expect(m.isMuted("c1", "s1")).toBe(true);
    expect(m.isMuted("c2", "s1")).toBe(false);
    m.toggleServerMuted("s1");
    expect(m.isMuted("c2", "s1")).toBe(true);
    expect(m.isMuted("dm1", null)).toBe(false);
    m.toggleServerMuted("s1");
    m.toggleChannelMuted("c1");
    expect(m.isMuted("c1", "s1")).toBe(false);
  });

  it("lembra entre sessões", async () => {
    (await import("./muted")).toggleServerMuted("s9");
    vi.resetModules();
    expect((await import("./muted")).isMuted("x", "s9")).toBe(true);
  });
});
