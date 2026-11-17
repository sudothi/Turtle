import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { jukeboxService, type Jukebox } from "./jukebox.js";
import { ytdlp } from "./ytdlp.js";

const io = vi.hoisted(() => ({
  beforeScan: undefined as ((path: string) => Promise<void>) | undefined,
  beforeRemove: undefined as ((path: string) => Promise<void>) | undefined,
  afterRemove: undefined as ((path: string) => void) | undefined,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...fs,
    readdir: async (...args: Parameters<typeof fs.readdir>) => {
      await io.beforeScan?.(String(args[0]));
      return fs.readdir(...args);
    },
    rm: async (...args: Parameters<typeof fs.rm>) => {
      await io.beforeRemove?.(String(args[0]));
      await fs.rm(...args);
      io.afterRemove?.(String(args[0]));
    },
  };
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

const until = (assertion: () => void) => vi.waitFor(assertion, { timeout: 5000 });

function pauseScan(dir: string) {
  const entered = deferred();
  const resume = deferred();
  io.beforeScan = async (path) => {
    if (path !== dir) return;
    io.beforeScan = undefined;
    entered.resolve();
    await resume.promise;
  };
  return { entered: entered.promise, resume: resume.resolve };
}

const services: Jukebox[] = [];
const gates: (() => void)[] = [];
afterEach(() => {
  io.beforeScan = undefined;
  io.beforeRemove = undefined;
  io.afterRemove = undefined;
  for (const resume of gates.splice(0)) resume();
  for (const jb of services.splice(0)) jb.close();
});

function setup(preload = false, afterWrite?: (id: string, path: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "turtle-cache-race-"));
  const downloads: string[] = [];
  const removed: string[] = [];
  const audio = Buffer.alloc(100);
  if (preload) {
    for (const [id, year] of [["ccccccccccc", 2000], ["zzzzzzzzzzz", 2030]] as const) {
      const path = join(dir, `yt-${id}.webm`);
      writeFileSync(path, audio);
      const time = new Date(`${year}-01-01T00:00:00Z`);
      utimesSync(path, time, time);
    }
  }
  const jb = jukeboxService({
    cacheDir: dir, cacheBytes: audio.length,
    music: { resolve: async () => null, cover: async () => null, preview: async () => null },
    fetchImage: async () => null, onChange: () => {},
    yt: ytdlp(async (args) => {
      const id = new URL(args.at(-1)!).searchParams.get("v")!;
      if (!args.includes("--print")) return JSON.stringify({ id, title: id, duration: 100 });
      const path = `${args[args.indexOf("-o") + 1]!.replace(".%(ext)s", "")}.webm`;
      writeFileSync(path, audio);
      downloads.push(id);
      await afterWrite?.(id, path);
      return path;
    }),
  });
  services.push(jb);
  io.afterRemove = (path) => { if (dirname(path) === dir) removed.push(basename(path)); };
  const add = (id: string, channelId = "c1") => jb.add(channelId, "s1", "u1", { url: `https://youtu.be/${id}` });
  const ready = (id: string, channelId = "c1") => jb.state(channelId)?.current?.title === id && jb.state(channelId)?.startedAt != null;
  return { jb, dir, downloads, removed, add, ready };
}

describe("limpeza concorrente do cache da jukebox", () => {
  it.each(["atual", "próxima", "outra chamada"])("preserva faixa %s adicionada durante a consulta do disco", async (where) => {
    const { jb, dir, removed, add, ready } = setup(true);
    const scan = pauseScan(dir);
    gates.push(scan.resume);
    await add("aaaaaaaaaaa");
    await scan.entered;
    await until(() => expect(ready("aaaaaaaaaaa")).toBe(true));
    const channel = where === "outra chamada" ? "c2" : "c1";
    await add("ccccccccccc", channel);
    if (where === "atual") {
      jb.skip("c1", "u1", false);
    }
    if (where === "próxima") {
      await until(() => expect(jb.state("c1")?.queue[0]).toMatchObject({ title: "ccccccccccc", status: "ready" }));
    } else await until(() => expect(ready("ccccccccccc", channel)).toBe(true));
    scan.resume();
    // O arquivo órfão é o último por mtime: sua remoção confirma que a limpeza
    // já passou pela faixa protegida, sem depender de um sleep arbitrário.
    await until(() => expect(removed).toContain("yt-zzzzzzzzzzz.webm"));
    expect(removed).not.toContain("yt-ccccccccccc.webm");
    expect(existsSync(join(dir, "yt-ccccccccccc.webm"))).toBe(true);
  });

  it("aguarda a remoção em andamento antes de baixar a mesma faixa novamente", async () => {
    const { jb, dir, downloads, add, ready } = setup(true);
    const entered = deferred();
    const resume = deferred();
    gates.push(resume.resolve);
    io.beforeRemove = async (path) => {
      if (path !== join(dir, "yt-ccccccccccc.webm")) return;
      entered.resolve();
      await resume.promise;
    };
    await add("aaaaaaaaaaa");
    await entered.promise;
    const result = await add("ccccccccccc", "c2");
    expect(result).toMatchObject({ item: { status: "loading" } });
    expect(jb.state("c2")?.audio).toBeNull();
    expect(downloads).not.toContain("ccccccccccc");
    resume.resolve();
    await until(() => expect(ready("ccccccccccc", "c2")).toBe(true));
    expect(downloads.filter((id) => id === "ccccccccccc")).toHaveLength(1);
    expect(existsSync(join(dir, "yt-ccccccccccc.webm"))).toBe(true);
  });

  it.each(["pular", "remover", "encerrar"])("libera espaço ao %s após os downloads terminarem", async (action) => {
    const { jb, dir, removed, add, ready } = setup();
    await add("aaaaaaaaaaa");
    await until(() => expect(ready("aaaaaaaaaaa")).toBe(true));
    const channel = action === "encerrar" ? "c2" : "c1";
    const result = await add("bbbbbbbbbbb", channel);
    if (!("item" in result)) throw new Error("não adicionou a faixa");
    if (action === "encerrar") await until(() => expect(ready("bbbbbbbbbbb", channel)).toBe(true));
    else await until(() => expect(jb.state("c1")?.queue[0]?.status).toBe("ready"));
    expect(existsSync(join(dir, "yt-aaaaaaaaaaa.webm"))).toBe(true);
    expect(existsSync(join(dir, "yt-bbbbbbbbbbb.webm"))).toBe(true);
    if (action === "pular") jb.skip("c1", "u1", false);
    else if (action === "remover") jb.remove("c1", result.item.id, "u1", false);
    else jb.clear("c2");
    const released = action === "pular" ? "aaaaaaaaaaa" : "bbbbbbbbbbb";
    const protectedId = action === "pular" ? "bbbbbbbbbbb" : "aaaaaaaaaaa";
    await until(() => expect(removed).toContain(`yt-${released}.webm`));
    expect(existsSync(join(dir, `yt-${protectedId}.webm`))).toBe(true);
  });

  it("protege um download em andamento mesmo se a chamada encerrar durante a gravação", async () => {
    const written = deferred();
    const finish = deferred();
    gates.push(finish.resolve);
    const { jb, dir, removed, add, ready } = setup(true, async (id, path) => {
      if (id !== "bbbbbbbbbbb") return;
      const time = new Date("2000-01-01T00:00:00Z");
      utimesSync(path, time, time);
      written.resolve();
      await finish.promise;
    });
    const scan = pauseScan(dir);
    gates.push(scan.resume);
    await add("aaaaaaaaaaa");
    await scan.entered;
    await until(() => expect(ready("aaaaaaaaaaa")).toBe(true));
    await add("bbbbbbbbbbb", "c2");
    await written.promise;
    jb.clear("c2");
    scan.resume();
    await until(() => expect(removed).toContain("yt-zzzzzzzzzzz.webm"));
    expect(removed).not.toContain("yt-bbbbbbbbbbb.webm");
    expect(existsSync(join(dir, "yt-bbbbbbbbbbb.webm"))).toBe(true);
    finish.resolve();
  });
});
