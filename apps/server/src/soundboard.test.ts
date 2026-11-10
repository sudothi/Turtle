import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type DbHandle } from "@turtle/db";
import { MAX_SOUNDS_PER_SERVER } from "@turtle/protocol";
import { buildApp } from "./app.js";
import { processSound } from "./sound.js";

/** WAV PCM 16 bits com `ms` milissegundos de um tom. */
function wav(ms: number, { rate = 48000, channels = 1, bits = 16, format = 1 } = {}) {
  const frames = Math.round((rate * ms) / 1000);
  const block = channels * (bits / 8);
  const data = Buffer.alloc(frames * block);
  for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) if (bits === 16) data.writeInt16LE(Math.round(Math.sin(i / 10) * 8000), (i * channels + c) * 2);
  const head = Buffer.alloc(44);
  head.write("RIFF", 0, "ascii");
  head.writeUInt32LE(36 + data.length, 4);
  head.write("WAVE", 8, "ascii");
  head.write("fmt ", 12, "ascii");
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(format, 20);
  head.writeUInt16LE(channels, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * block, 28);
  head.writeUInt16LE(block, 32);
  head.writeUInt16LE(bits, 34);
  head.write("data", 36, "ascii");
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

describe("processSound", () => {
  it("aceita WAV PCM 16 bits e mede a duração", () => {
    const r = processSound(wav(1500));
    expect("error" in r).toBe(false);
    if (!("error" in r)) expect(r.durationMs).toBe(1500);
  });
  it("tira blocos extras (metadados) antes dos dados", () => {
    const src = wav(500);
    const list = Buffer.concat([Buffer.from("LIST"), Buffer.from([6, 0, 0, 0]), Buffer.from("abcdef")]);
    const withList = Buffer.concat([src.subarray(0, 36), list, src.subarray(36)]);
    const r = processSound(withList);
    if ("error" in r) throw new Error(r.error);
    expect(r.data.length).toBe(src.length);
    expect(r.data.includes(Buffer.from("LIST"))).toBe(false);
  });
  it("recusa longo demais, formato errado e lixo", () => {
    expect(processSound(wav(5200))).toHaveProperty("error");
    expect(processSound(wav(500, { format: 3, bits: 32 }))).toHaveProperty("error");
    expect(processSound(wav(500, { bits: 8 }))).toHaveProperty("error");
    expect(processSound(wav(500, { channels: 6 }))).toHaveProperty("error");
    expect(processSound(Buffer.from("isso não é um áudio de verdade, só texto qualquer aqui"))).toHaveProperty("error");
  });
});

let handle: DbHandle;
let app: Awaited<ReturnType<typeof buildApp>>;
let base = "";
beforeAll(async () => {
  handle = await createDb();
  app = await buildApp({
    db: handle.db, bootstrapInvite: "boot", uploadDir: mkdtempSync(join(tmpdir(), "turtle-snd-")),
    authLimit: { perIp: 100_000, perName: 8 }, maxDiskUsageRatio: 1.01,
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
const upload = async (serverId: string, token: string, data: Buffer, query = "name=Buzina&icon=horn&volume=0.5") => {
  const form = new FormData();
  form.append("file", new Blob([data as BlobPart], { type: "audio/wav" }), "som.wav");
  const res = await fetch(`${base}/servers/${serverId}/sounds?${query}`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
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
const settle = () => new Promise((r) => setTimeout(r, 150));

describe("soundboard", () => {
  let dono = "";
  let membro = "";
  let membroId = "";
  let fora = "";
  let serverId = "";
  let sala = "";
  let soundId = "";

  it("prepara contas e servidor", async () => {
    const admin = (await call("POST", "/auth/register", undefined, { inviteCode: "boot", username: "admin", password: "12345678" })).body.token;
    const mk = async (name: string) => {
      const inv = await call("POST", "/invites", admin, {});
      const r = await call("POST", "/auth/register", undefined, { inviteCode: inv.body.code, username: name, password: "12345678" });
      return { token: r.body.token as string, id: r.body.user.id as string };
    };
    dono = (await mk("snd-dono")).token;
    ({ token: membro, id: membroId } = await mk("snd-membro"));
    fora = (await mk("snd-fora")).token;
    serverId = (await call("POST", "/servers", dono, { name: "Sons" })).body.id;
    const inv = await call("POST", `/servers/${serverId}/invites`, dono, {});
    await call("POST", `/invites/${inv.body.code}/join`, membro, {});
    sala = (await call("GET", `/servers/${serverId}/channels`, dono)).body.find((c: any) => c.kind === "voice").id;
  });

  it("membro envia som; quem não é do servidor não vê nem envia", async () => {
    const watcher = await listen(dono);
    const r = await upload(serverId, membro, wav(1200));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ name: "Buzina", icon: "horn", volume: 0.5, durationMs: 1200, userId: membroId });
    soundId = r.body.id;
    await settle();
    expect(watcher.events.some((e) => e.t === "sounds" && e.serverId === serverId)).toBe(true);
    watcher.ws.close();
    expect((await call("GET", `/servers/${serverId}/sounds`, dono)).body.map((s: any) => s.name)).toEqual(["Buzina"]);
    expect((await call("GET", `/servers/${serverId}/sounds`, fora)).status).toBe(404);
    expect((await upload(serverId, fora, wav(500))).status).toBe(404);
    // o arquivo é servido como áudio
    const file = await fetch(`${base}/files/${r.body.key}`);
    expect(file.headers.get("content-type")).toBe("audio/wav");
    expect(Buffer.from(await file.arrayBuffer()).length).toBe(44 + 48000 * 1.2 * 2);
  });

  it("valida nome, ícone, formato e duração", async () => {
    expect((await upload(serverId, membro, wav(500), "name=&icon=horn")).status).toBe(400);
    expect((await upload(serverId, membro, wav(500), "name=x&icon=foguete")).status).toBe(400);
    expect((await upload(serverId, membro, wav(6000))).status).toBe(413);
    expect((await upload(serverId, membro, wav(4900, { rate: 8000, channels: 2 }))).status).toBe(200);
    expect((await upload(serverId, membro, Buffer.from("texto texto texto texto texto texto texto texto"))).status).toBe(415);
  });

  it("editar e apagar: quem enviou ou dono/admin", async () => {
    const outro = (await upload(serverId, dono, wav(300), "name=Do%20dono&icon=cat")).body.id;
    expect((await call("PATCH", `/sounds/${outro}`, membro, { name: "meu" })).status).toBe(403);
    expect((await call("DELETE", `/sounds/${outro}`, membro)).status).toBe(403);
    expect((await call("PATCH", `/sounds/${soundId}`, membro, { name: "Buzinão", volume: 0.8 })).body).toMatchObject({ name: "Buzinão", volume: 0.8, icon: "horn" });
    expect((await call("PATCH", `/sounds/${soundId}`, dono, { icon: "duck" })).body.icon).toBe("duck");
    expect((await call("PATCH", `/sounds/${soundId}`, fora, { icon: "duck" })).status).toBe(404);
    const gone = (await call("GET", `/servers/${serverId}/sounds`, dono)).body.find((s: any) => s.id === outro);
    expect((await call("DELETE", `/sounds/${outro}`, dono)).status).toBe(200);
    expect((await fetch(`${base}/files/${gone.key}`)).status).toBe(404);
  });

  it("só admins adicionam quando o servidor pede", async () => {
    expect((await call("PUT", `/servers/${serverId}/soundboard`, membro, { adminsOnly: true })).status).toBe(403);
    expect((await call("PUT", `/servers/${serverId}/soundboard`, dono, { adminsOnly: true })).status).toBe(200);
    expect((await call("GET", "/servers", membro)).body[0].soundboardAdminsOnly).toBe(true);
    expect((await upload(serverId, membro, wav(300))).status).toBe(403);
    expect((await upload(serverId, dono, wav(300), "name=Ok")).status).toBe(200);
    await call("PUT", `/servers/${serverId}/soundboard`, dono, { adminsOnly: false });
  });

  it("limite de sons por servidor", async () => {
    const n = (await call("GET", `/servers/${serverId}/sounds`, dono)).body.length;
    // Sobe até o limite com o dono (o limite de envios é por conta: 40 a cada 10 min).
    for (let i = n; i < MAX_SOUNDS_PER_SERVER; i++) expect((await upload(serverId, dono, wav(100), `name=s${i}`)).status).toBe(200);
    expect((await upload(serverId, dono, wav(100), "name=demais")).status).toBe(409);
  });

  it("tocar: só quem está na chamada ouve; ensurdecido não toca; cooldown", async () => {
    const A = await listen(membro);
    const B = await listen(dono);
    const C = await listen(fora);
    A.ws.send(JSON.stringify({ t: "soundboardPlay", soundId }));
    await settle();
    expect(A.events.some((e) => e.t === "error" && /chamada/.test(e.error))).toBe(true);
    A.ws.send(JSON.stringify({ t: "voice", channelId: sala, muted: true, deafened: false }));
    B.ws.send(JSON.stringify({ t: "voice", channelId: sala, muted: false, deafened: false }));
    await settle();
    A.ws.send(JSON.stringify({ t: "soundboardPlay", soundId }));
    await settle();
    for (const x of [A, B]) expect(x.events.filter((e) => e.t === "soundboardPlay")).toEqual([
      expect.objectContaining({ channelId: sala, userId: membroId, sound: expect.objectContaining({ id: soundId, icon: "duck" }) }),
    ]);
    expect(C.events.some((e) => e.t === "soundboardPlay")).toBe(false);
    // cooldown de 3 s
    A.ws.send(JSON.stringify({ t: "soundboardPlay", soundId }));
    await settle();
    expect(A.events.some((e) => e.t === "error" && /espere/.test(e.error))).toBe(true);
    expect(B.events.filter((e) => e.t === "soundboardPlay").length).toBe(1);
    // ensurdecido não toca
    B.ws.send(JSON.stringify({ t: "voice", channelId: sala, muted: false, deafened: true }));
    await settle();
    B.ws.send(JSON.stringify({ t: "soundboardPlay", soundId }));
    await settle();
    expect(B.events.some((e) => e.t === "error" && /ensurdecer/.test(e.error))).toBe(true);
    // som de outro servidor não toca
    const outroServer = (await call("POST", "/servers", fora, { name: "Outro" })).body.id;
    const alheio = (await upload(outroServer, fora, wav(100), "name=alheio")).body.id;
    B.ws.send(JSON.stringify({ t: "voice", channelId: sala, muted: false, deafened: false }));
    await settle();
    B.ws.send(JSON.stringify({ t: "soundboardPlay", soundId: alheio }));
    await settle();
    expect(B.events.some((e) => e.t === "error" && e.error === "som não existe")).toBe(true);
    for (const x of [A, B, C]) x.ws.close();
  });

  it("apagar o servidor apaga os sons", async () => {
    const key = (await call("GET", `/servers/${serverId}/sounds`, dono)).body[0].key;
    expect((await call("DELETE", `/servers/${serverId}`, dono, { name: "Sons" })).status).toBe(200);
    expect((await fetch(`${base}/files/${key}`)).status).toBe(404);
  });
});
