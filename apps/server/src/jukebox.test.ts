import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { createDb, type DbHandle } from "@turtle/db";
import { JUKEBOX_MAX_PER_USER, type JukeboxState, type MusicTrack } from "@turtle/protocol";
import { buildApp } from "./app.js";
import { jukeboxService } from "./jukebox.js";
import { mediaLink, ytdlp, type YtdlpRun } from "./ytdlp.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (ok: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error("tempo esgotado");
    await sleep(15);
  }
};
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(4000, 7)]);
const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(2000)]);

/** yt-dlp de mentira: vídeos conhecidos por id, busca com resultados fixos e download que escreve um arquivo. */
function fakeYt(videos: Record<string, { title: string; duration: number; live?: boolean }>, opts: { fail?: Set<string>; delayMs?: number } = {}) {
  const calls: string[][] = [];
  const run: YtdlpRun = async (args) => {
    calls.push(args);
    const target = args[args.length - 1]!;
    if (target.startsWith("ytsearch5:")) {
      return JSON.stringify({ entries: Object.entries(videos).map(([id, v]) => ({ id, title: v.title, duration: v.duration, live_status: v.live ? "is_live" : "not_live" })) });
    }
    const id = /v=([\w-]{11})/.exec(target)?.[1] ?? target;
    const v = videos[id];
    if (!v) throw new Error("ERROR: Video unavailable");
    if (args.includes("--print")) {
      if (opts.delayMs) await sleep(opts.delayMs);
      if (opts.fail?.has(id)) throw new Error("ERROR: HTTP Error 403");
      const base = args[args.indexOf("-o") + 1]!.replace(".%(ext)s", "");
      writeFileSync(`${base}.webm`, WEBM);
      return `${base}.webm\n`;
    }
    return JSON.stringify({ id, title: v.title, uploader: "Canal - Topic", duration: v.duration, is_live: !!v.live, webpage_url: `https://www.youtube.com/watch?v=${id}`, thumbnails: [{ url: `https://i.ytimg.com/vi/${id}/hq.jpg`, width: 480 }] });
  };
  return { run, calls, downloads: () => calls.filter((a) => a.includes("--print")).length };
}

/** Serviço de música de mentira (faixas do Deezer `dz1`, `dz2`...). */
function fakeMusic(tracks: Record<string, Partial<MusicTrack>>) {
  const full = (id: string): MusicTrack | null => {
    const t = tracks[id];
    return t ? { id, url: `https://open.spotify.com/search/x`, title: "Sem título", artist: null, album: null, durationMs: 200_000, hasCover: true, previewSource: "deezer", ...t } : null;
  };
  return {
    resolve: async (raw: string) => full(`dz${/track\/(\d+)/.exec(raw)?.[1]}`),
    cover: async () => sharp({ create: { width: 320, height: 320, channels: 3, background: "#36c" } }).webp().toBuffer(),
    preview: async (id: string) => (tracks[id] ? MP3 : null),
  };
}

describe("links aceitos na discoteca", () => {
  it("normaliza YouTube, SoundCloud e Bandcamp e tira playlist e rastreio", () => {
    expect(mediaLink("https://youtu.be/dQw4w9WgXcQ?si=abc")).toMatchObject({ source: "youtube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", key: "yt-dQw4w9WgXcQ" });
    expect(mediaLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&index=4")?.url).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(mediaLink("https://m.youtube.com/shorts/dQw4w9WgXcQ")?.key).toBe("yt-dQw4w9WgXcQ");
    expect(mediaLink("https://music.youtube.com/watch?v=dQw4w9WgXcQ&feature=share")?.source).toBe("youtube");
    expect(mediaLink("https://soundcloud.com/Artista/faixa-legal?utm_source=x")).toMatchObject({ url: "https://soundcloud.com/Artista/faixa-legal", key: "sc-artista-faixa-legal" });
    expect(mediaLink("https://banda.bandcamp.com/track/musica")?.source).toBe("bandcamp");
  });
  it("recusa playlist, outros sites e truques de URL", () => {
    for (const u of [
      "https://www.youtube.com/playlist?list=PL123", "https://www.youtube.com/watch?v=curto", "https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ",
      "https://soundcloud.com/artista/sets/album", "https://banda.bandcamp.com/album/disco", "https://user:pw@www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ", "file:///etc/passwd", "http://127.0.0.1/x", "isso não é link",
    ]) expect(mediaLink(u), u).toBeNull();
  });
});

describe("yt-dlp", () => {
  it("recusa ao vivo e longos demais; acha na busca a versão de duração mais próxima", async () => {
    const y = ytdlp(fakeYt({
      aaaaaaaaaaa: { title: "Ao vivo", duration: 100, live: true },
      bbbbbbbbbbb: { title: "Longa", duration: 3600 },
      ccccccccccc: { title: "Clipe com intro", duration: 260 },
      ddddddddddd: { title: "Áudio", duration: 214 },
    }).run);
    expect(await y.info("https://www.youtube.com/watch?v=aaaaaaaaaaa")).toEqual({ error: expect.stringMatching(/ao vivo/) });
    expect(await y.info("https://www.youtube.com/watch?v=bbbbbbbbbbb")).toEqual({ error: expect.stringMatching(/longa demais/) });
    expect(await y.info("https://www.youtube.com/watch?v=zzzzzzzzzzz")).toEqual({ error: expect.any(String) });
    expect(await y.info("https://www.youtube.com/watch?v=ddddddddddd")).toMatchObject({ title: "Áudio", artist: "Canal", durationMs: 214_000, thumbnail: "https://i.ytimg.com/vi/ddddddddddd/hq.jpg" });
    expect((await y.find("Rick", "Música", 213_000))?.id).toBe("ddddddddddd");
    // A única perto de 100 s é ao vivo (fica de fora); nada mais a menos de 20 s.
    expect(await y.find("Rick", "Música", 100_000)).toBeNull();
  });
  it("passa os argumentos fixos e o link depois de --", async () => {
    const fake = fakeYt({ ddddddddddd: { title: "Áudio", duration: 214 } });
    const dir = mkdtempSync(join(tmpdir(), "turtle-yt-"));
    const path = await ytdlp(fake.run).download("https://www.youtube.com/watch?v=ddddddddddd", join(dir, "yt-ddddddddddd"));
    expect(path).toBe(join(dir, "yt-ddddddddddd.webm"));
    const args = fake.calls[0]!;
    expect(args.slice(-2)).toEqual(["--", "https://www.youtube.com/watch?v=ddddddddddd"]);
    expect(args).toContain("--max-filesize");
  });
});

describe("fila e relógio", () => {
  const setup = (opts: { videos?: Record<string, { title: string; duration: number }>; fail?: Set<string>; delayMs?: number; withYt?: boolean; cacheBytes?: number } = {}) => {
    const events: { channelId: string; state: JukeboxState | null }[] = [];
    const yt = fakeYt(opts.videos ?? { ddddddddddd: { title: "Áudio", duration: 214 } }, { fail: opts.fail, delayMs: opts.delayMs });
    const dir = mkdtempSync(join(tmpdir(), "turtle-jb-"));
    const jb = jukeboxService({
      cacheDir: dir, cacheBytes: opts.cacheBytes, yt: opts.withYt === false ? undefined : ytdlp(yt.run),
      music: fakeMusic({ dz1: { title: "Música", artist: "Rick", durationMs: 213_000 }, dz2: { title: "Outra", previewSource: null } }),
      fetchImage: async () => sharp({ create: { width: 480, height: 360, channels: 3, background: "#c33" } }).jpeg().toBuffer(),
      onChange: (channelId, _s, state) => events.push({ channelId, state }),
      leadMs: 50, idleMs: 200,
    });
    return { jb, yt, dir, events, last: () => events[events.length - 1]?.state };
  };

  it("busca do Deezer toca a versão completa do YouTube, com a capa do Deezer", async () => {
    const { jb, last } = setup();
    const r = await jb.add("c1", "s1", "u1", { trackId: "dz1" });
    expect(r).toMatchObject({ item: { title: "Música", artist: "Rick", source: "youtube", preview: false, durationMs: 214_000, addedBy: "u1" } });
    await until(() => last()?.startedAt != null);
    const s = last()!;
    expect(s.current?.status).toBe("ready");
    expect(s.audio).toMatch(/^\/jukebox\/audio\/[\w-]{22}\/yt-ddddddddddd\.webm$/);
    expect(s.startedAt! - s.now).toBeGreaterThan(0); // começa um pouco no futuro (todos carregam juntos)
    await until(() => !!last()?.current?.cover);
    jb.close();
  });

  it("sem yt-dlp: a busca toca a prévia de 30 s e links do YouTube são recusados", async () => {
    const { jb, last } = setup({ withYt: false });
    expect(await jb.add("c1", "s1", "u1", { trackId: "dz1" })).toMatchObject({ item: { source: "deezer", preview: true, durationMs: 30_000 } });
    await until(() => last()?.startedAt != null);
    expect(last()!.audio).toMatch(/dz-dz1-preview\.mp3$/);
    expect(await jb.add("c1", "s1", "u1", { url: "https://youtu.be/ddddddddddd" })).toMatchObject({ code: 422, error: expect.stringMatching(/desligados/) });
    expect(await jb.add("c1", "s1", "u1", { trackId: "dz2" })).toMatchObject({ code: 422 });
    expect(await jb.add("c1", "s1", "u1", { url: "https://example.com/musica.mp3" })).toMatchObject({ code: 422, error: expect.stringMatching(/não suportado/) });
    jb.close();
  });

  it("fila: próxima já baixada, pular, tirar da fila, pausar e continuar", async () => {
    const { jb, yt, last } = setup({ videos: { aaaaaaaaaaa: { title: "Um", duration: 200 }, bbbbbbbbbbb: { title: "Dois", duration: 200 }, ccccccccccc: { title: "Três", duration: 200 } } });
    const a = await jb.add("c1", "s1", "u1", { url: "https://youtu.be/aaaaaaaaaaa" });
    const b = await jb.add("c1", "s1", "u2", { url: "https://youtu.be/bbbbbbbbbbb" });
    const c = await jb.add("c1", "s1", "u2", { url: "https://youtu.be/ccccccccccc" });
    if (!("item" in a) || !("item" in b) || !("item" in c)) throw new Error("falhou");
    await until(() => last()?.queue[0]?.status === "ready");
    expect(yt.downloads()).toBe(2); // a atual e a próxima; a terceira só quando chegar a vez
    expect(last()!.queue.map((i) => i.title)).toEqual(["Dois", "Três"]);
    expect(jb.remove("c1", c.item.id)).toBe(true);
    expect(last()!.queue.map((i) => i.title)).toEqual(["Dois"]);
    // Pausa e continua do mesmo ponto.
    await until(() => last()?.startedAt != null);
    await sleep(120);
    expect(jb.pause("c1")).toBe(true);
    const paused = last()!;
    expect(paused.startedAt).toBeNull();
    expect(paused.pausedAt).toBeGreaterThanOrEqual(30);
    expect(jb.pause("c1")).toBe(false);
    expect(jb.resume("c1")).toBe(true);
    const resumed = last()!;
    expect(resumed.now - resumed.startedAt!).toBeLessThanOrEqual(paused.pausedAt!);
    // Pular com o id de uma faixa que já passou não pula de novo.
    expect(jb.skip("c1", a.item.id)).toBe(true);
    expect(jb.skip("c1", a.item.id)).toBe(false);
    await until(() => last()?.current?.title === "Dois" && last()?.startedAt != null);
    expect(jb.skip("c1")).toBe(true);
    expect(last()!.current).toBeNull();
    jb.close();
  });

  it("acaba a faixa sozinha e passa para a próxima", async () => {
    const { jb, last } = setup({ videos: { aaaaaaaaaaa: { title: "Curta", duration: 0.2 }, bbbbbbbbbbb: { title: "Segunda", duration: 100 } } });
    await jb.add("c1", "s1", "u1", { url: "https://youtu.be/aaaaaaaaaaa" });
    await jb.add("c1", "s1", "u1", { url: "https://youtu.be/bbbbbbbbbbb" });
    await until(() => last()?.current?.title === "Segunda" && last()?.startedAt != null, 4000);
    jb.close();
  });

  it("download que falha avisa e pula; dois pedidos da mesma faixa baixam uma vez", async () => {
    const { jb, yt, last } = setup({ videos: { aaaaaaaaaaa: { title: "Quebrada", duration: 100 }, bbbbbbbbbbb: { title: "Boa", duration: 100 } }, fail: new Set(["aaaaaaaaaaa"]), delayMs: 40 });
    await Promise.all([
      jb.add("c1", "s1", "u1", { url: "https://youtu.be/aaaaaaaaaaa" }),
      jb.add("c2", "s1", "u1", { url: "https://youtu.be/bbbbbbbbbbb" }),
      jb.add("c3", "s1", "u2", { url: "https://youtu.be/bbbbbbbbbbb" }),
    ]);
    await until(() => jb.state("c1")?.notice != null);
    expect(jb.state("c1")!.notice).toMatch(/Quebrada/);
    expect(jb.state("c1")!.current).toBeNull();
    await until(() => jb.state("c2")?.startedAt != null && jb.state("c3")?.startedAt != null);
    expect(yt.calls.filter((a) => a.includes("--print") && a.at(-1)!.includes("bbbbbbbbbbb")).length).toBe(1);
    expect(last()).toBeTruthy();
    jb.close();
  });

  it("busca do Deezer: se o YouTube barra o 1º vídeo, toca o próximo; se barra todos, cai na prévia de 30 s", async () => {
    const two = setup({ videos: { aaaaaaaaaaa: { title: "Barrado", duration: 213 }, bbbbbbbbbbb: { title: "Liberado", duration: 214 } }, fail: new Set(["aaaaaaaaaaa"]) });
    await two.jb.add("c1", "s1", "u1", { trackId: "dz1" });
    await until(() => two.last()?.startedAt != null);
    expect(two.last()!.audio).toMatch(/yt-bbbbbbbbbbb\.webm$/);
    expect(two.last()!.current).toMatchObject({ source: "youtube", preview: false });
    two.jb.close();

    const none = setup({ videos: { aaaaaaaaaaa: { title: "Barrado", duration: 213 }, bbbbbbbbbbb: { title: "Barrado 2", duration: 214 } }, fail: new Set(["aaaaaaaaaaa", "bbbbbbbbbbb"]) });
    await none.jb.add("c1", "s1", "u1", { trackId: "dz1" });
    await until(() => none.last()?.startedAt != null);
    expect(none.last()!.audio).toMatch(/dz-dz1-preview\.mp3$/);
    expect(none.last()!.current).toMatchObject({ source: "deezer", preview: true, durationMs: 30_000 });
    expect(none.last()!.notice).toMatch(/prévia/);
    none.jb.close();
  });

  it("limite por pessoa", async () => {
    const videos = Object.fromEntries(Array.from({ length: JUKEBOX_MAX_PER_USER + 1 }, (_, i) => [`v${String(i).padStart(10, "0")}`, { title: `M${i}`, duration: 100 }]));
    const { jb } = setup({ videos });
    const ids = Object.keys(videos);
    for (const id of ids.slice(0, -1)) expect(await jb.add("c1", "s1", "u1", { url: `https://youtu.be/${id}` })).toHaveProperty("item");
    expect(await jb.add("c1", "s1", "u1", { url: `https://youtu.be/${ids.at(-1)}` })).toMatchObject({ code: 409 });
    expect(await jb.add("c1", "s1", "u2", { url: `https://youtu.be/${ids.at(-1)}` })).toHaveProperty("item");
    jb.close();
  });

  it("chamada vazia pausa; alguém volta e continua; vazia por muito tempo acaba", async () => {
    const { jb, last } = setup();
    await jb.add("c1", "s1", "u1", { trackId: "dz1" });
    await until(() => last()?.startedAt != null);
    jb.occupancy("c1", 0);
    expect(last()!.pausedAt).not.toBeNull();
    jb.occupancy("c1", 1);
    expect(last()!.startedAt).not.toBeNull();
    expect(last()!.pausedAt).toBeNull();
    jb.occupancy("c1", 0);
    await until(() => jb.state("c1") === null);
    expect(last()).toBeNull();
    jb.close();
  });

  it("arquivos só com assinatura; cache apaga o mais antigo que não está na fila", async () => {
    const { jb, dir, last } = setup({ videos: { aaaaaaaaaaa: { title: "Um", duration: 100 }, bbbbbbbbbbb: { title: "Dois", duration: 100 } }, cacheBytes: WEBM.length + 10 });
    await jb.add("c1", "s1", "u1", { url: "https://youtu.be/aaaaaaaaaaa" });
    await until(() => last()?.startedAt != null);
    const [, , , sig, file] = last()!.audio!.split("/");
    expect(jb.file("audio", sig!, file!)).toBe(join(dir, file!));
    expect(jb.file("audio", "x".repeat(22), file!)).toBeNull();
    expect(jb.file("audio", sig!, "../../etc/passwd")).toBeNull();
    expect(jb.file("cover", sig!, file!)).toBeNull();
    // Troca de faixa: a primeira sai da fila e pode ser apagada para caber a segunda.
    await jb.add("c1", "s1", "u1", { url: "https://youtu.be/bbbbbbbbbbb" });
    jb.skip("c1");
    await until(() => last()?.current?.title === "Dois" && last()?.startedAt != null);
    await until(() => !readdirSync(dir).includes("yt-aaaaaaaaaaa.webm"));
    expect(readdirSync(dir)).toContain("yt-bbbbbbbbbbb.webm");
    jb.close();
  });
});

describe("discoteca no app", () => {
  let handle: DbHandle;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let base = "";
  const yt = fakeYt({ ddddddddddd: { title: "Áudio", duration: 214 } });
  beforeAll(async () => {
    handle = await createDb();
    const tmp = mkdtempSync(join(tmpdir(), "turtle-jbapp-"));
    app = await buildApp({
      db: handle.db, bootstrapInvite: "boot", uploadDir: join(tmp, "uploads"),
      authLimit: { perIp: 100_000, perName: 8 }, maxDiskUsageRatio: 1.01,
      jukebox: { cacheDir: join(tmp, "music"), run: yt.run, leadMs: 50, fetchImage: async () => sharp({ create: { width: 480, height: 360, channels: 3, background: "#c33" } }).jpeg().toBuffer() },
    });
    base = await app.listen({ port: 0, host: "127.0.0.1" });
  });
  afterAll(async () => {
    await app.close();
    await handle.close();
  });
  const call = async (method: string, url: string, token?: string, body?: unknown) => {
    const res = await fetch(base + url, {
      method,
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
  };
  const listen = (token: string) =>
    new Promise<{ ws: WebSocket; events: any[] }>((resolve, reject) => {
      const ws = new WebSocket(base.replace("http", "ws") + `/ws?token=${token}`);
      const events: any[] = [];
      ws.on("message", (raw) => events.push(JSON.parse(raw.toString())));
      ws.on("open", () => resolve({ ws, events }));
      ws.on("error", reject);
    });

  it("só quem está na chamada mexe; todo o servidor vê o que toca; áudio com Range", async () => {
    const admin = (await call("POST", "/auth/register", undefined, { inviteCode: "boot", username: "admin", password: "12345678" })).body.token;
    const mk = async (name: string) => {
      const inv = await call("POST", "/invites", admin, {});
      return (await call("POST", "/auth/register", undefined, { inviteCode: inv.body.code, username: name, password: "12345678" })).body.token as string;
    };
    const dono = await mk("jb-dono");
    const membro = await mk("jb-membro");
    const fora = await mk("jb-fora");
    const serverId = (await call("POST", "/servers", dono, { name: "Festa" })).body.id;
    const inv = await call("POST", `/servers/${serverId}/invites`, dono, {});
    await call("POST", `/invites/${inv.body.code}/join`, membro, {});
    const sala = (await call("GET", `/servers/${serverId}/channels`, dono)).body.find((c: any) => c.kind === "voice").id;
    const link = { url: "https://youtu.be/ddddddddddd" };

    // Fora da chamada: 403; fora do servidor: 404; corpo inválido: 400.
    expect((await call("POST", `/jukebox/${sala}/queue`, dono, link)).status).toBe(403);
    expect((await call("POST", `/jukebox/${sala}/queue`, fora, link)).status).toBe(404);
    expect((await call("GET", `/jukebox/${sala}`, fora)).status).toBe(404);
    expect((await call("POST", `/jukebox/${sala}/queue`, dono, { url: 3 })).status).toBe(400);

    const A = await listen(dono);
    const B = await listen(membro); // está no servidor, mas não na chamada
    const C = await listen(fora);
    A.ws.send(JSON.stringify({ t: "voice", channelId: sala, muted: false, deafened: false }));
    await sleep(150);
    const r = await call("POST", `/jukebox/${sala}/queue`, dono, link);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ title: "Áudio", source: "youtube" });
    await until(() => B.events.some((e) => e.t === "jukebox" && e.state?.startedAt != null));
    const state = B.events.filter((e) => e.t === "jukebox").at(-1).state;
    expect(state).toMatchObject({ channelId: sala, serverId, current: { title: "Áudio" } });
    expect(C.events.some((e) => e.t === "jukebox")).toBe(false);
    expect((await call("POST", `/jukebox/${sala}/skip`, membro, {})).status).toBe(403);

    // Áudio sem login, com assinatura; Range para pular para o meio.
    const full = await fetch(base + state.audio);
    expect(full.status).toBe(200);
    expect(full.headers.get("content-type")).toBe("audio/webm");
    expect(Buffer.from(await full.arrayBuffer()).equals(WEBM)).toBe(true);
    const part = await fetch(base + state.audio, { headers: { range: "bytes=100-199" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 100-199/${WEBM.length}`);
    expect((await part.arrayBuffer()).byteLength).toBe(100);
    expect((await fetch(base + state.audio.replace(/audio\/[\w-]{22}/, "audio/aaaaaaaaaaaaaaaaaaaaaa"))).status).toBe(404);
    await until(() => B.events.some((e) => e.t === "jukebox" && e.state?.current?.cover));
    const cover = (await call("GET", `/jukebox/${sala}`, dono)).body.state.current.cover;
    expect((await fetch(base + cover)).headers.get("content-type")).toBe("image/webp");

    // Quem conecta depois recebe o estado na hora.
    const D = await listen(membro);
    await sleep(150);
    expect(D.events.some((e) => e.t === "jukebox" && e.state?.current?.title === "Áudio")).toBe(true);

    // Pausar e continuar pela API.
    expect((await call("POST", `/jukebox/${sala}/pause`, dono, {})).body).toEqual({ ok: true });
    expect((await call("GET", `/jukebox/${sala}`, membro)).body.state.pausedAt).not.toBeNull();
    expect((await call("POST", `/jukebox/${sala}/resume`, dono, {})).body).toEqual({ ok: true });

    // Apagar o canal acaba com a discoteca (e avisa o servidor).
    await call("DELETE", `/channels/${sala}`, dono);
    await until(() => B.events.some((e) => e.t === "jukebox" && e.channelId === sala && e.state === null));
    for (const x of [A, B, C, D]) x.ws.close();
  });
});
