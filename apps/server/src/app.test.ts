import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createDb, type DbHandle } from "@turtle/db";
import { TokenVerifier } from "livekit-server-sdk";
import { buildApp, voiceRoomName } from "./app.js";

let handle: DbHandle;
let app: Awaited<ReturnType<typeof buildApp>>;
let base = "";
const LK = { url: "ws://lk.test", apiKey: "devkey", apiSecret: "devsecret-devsecret-devsecret-1234" };

const post = async (url: string, body: unknown, token?: string) => {
  const res = await fetch(base + url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
};
const get = async (url: string, token: string) => {
  const res = await fetch(base + url, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, body: (await res.json()) as any };
};

beforeAll(async () => {
  handle = await createDb();
  app = await buildApp({ db: handle.db, bootstrapInvite: "boot", livekit: LK });
  base = await app.listen({ port: 0, host: "127.0.0.1" });
});
afterAll(async () => {
  await app.close();
  await handle.close();
});

describe("server", () => {
  let adminToken = "";
  let friendToken = "";

  it("GET /health responde ok", async () => {
    expect((await (await fetch(base + "/health")).json())).toEqual({ ok: true });
  });

  it("cadastro exige convite válido; primeiro usuário é admin", async () => {
    expect((await post("/auth/register", { inviteCode: "nope", username: "thiago", password: "12345678" })).status).toBe(403);
    const r = await post("/auth/register", { inviteCode: "boot", username: "thiago", password: "12345678" });
    expect(r.status).toBe(200);
    expect(r.body.user.isAdmin).toBe(true);
    adminToken = r.body.token;
    // convite não pode ser reutilizado
    expect((await post("/auth/register", { inviteCode: "boot", username: "outro", password: "12345678" })).status).toBe(403);
  });

  it("login e rotas protegidas", async () => {
    expect((await post("/auth/login", { username: "thiago", password: "errada123" })).status).toBe(401);
    const l = await post("/auth/login", { username: "thiago", password: "12345678" });
    expect(l.status).toBe(200);
    expect((await get("/me", l.body.token)).body.username).toBe("thiago");
    expect((await get("/me", "token-falso")).status).toBe(401);
  });

  it("admin cria convite e canal; amigo não admin não consegue", async () => {
    const inv = await post("/invites", {}, adminToken);
    const reg = await post("/auth/register", { inviteCode: inv.body.code, username: "amigo", password: "12345678" });
    expect(reg.body.user.isAdmin).toBe(false);
    friendToken = reg.body.token;
    expect((await post("/invites", {}, friendToken)).status).toBe(403);
    expect((await post("/channels", { name: "jogos" }, friendToken)).status).toBe(403);
    expect((await post("/channels", { name: "jogos" }, adminToken)).status).toBe(200);
    expect((await get("/channels", friendToken)).body.map((c: any) => `${c.kind}:${c.name}`)).toEqual(["text:geral", "voice:Sala", "text:jogos"]);
    expect((await post("/channels", { name: "Lobby", kind: "voice" }, adminToken)).body.kind).toBe("voice");
  });

  it("mensagens trafegam em tempo real e ficam no histórico", async () => {
    const channels = (await get("/channels", adminToken)).body;
    const geral = channels[0].id;
    const open = (token: string) =>
      new Promise<WebSocket>((resolve, reject) => {
        const ws = new WebSocket(base.replace("http", "ws") + `/ws?token=${token}`);
        ws.on("open", () => resolve(ws));
        ws.on("error", reject);
      });
    const a = await open(adminToken);
    const b = await open(friendToken);
    const received = new Promise<any>((resolve) => {
      b.on("message", (raw) => {
        const evt = JSON.parse(raw.toString());
        if (evt.t === "message") resolve(evt.message);
      });
    });
    a.send(JSON.stringify({ t: "send", channelId: geral, content: "oi, tartarugas" }));
    const msg = await received;
    expect(msg.content).toBe("oi, tartarugas");
    expect(msg.username).toBe("thiago");
    const history = (await get(`/channels/${geral}/messages`, friendToken)).body;
    expect(history.map((m: any) => m.content)).toEqual(["oi, tartarugas"]);
    a.close();
    b.close();
  });

  it("emite token LiveKit só para canal de voz, com identidade do usuário", async () => {
    const channels = (await get("/channels", friendToken)).body;
    const sala = channels.find((c: any) => c.name === "Sala");
    const geral = channels.find((c: any) => c.name === "geral");
    expect((await post(`/voice/${geral.id}/token`, {}, friendToken)).status).toBe(404);
    expect((await post(`/voice/${sala.id}/token`, {})).status).toBe(401);
    const r = await post(`/voice/${sala.id}/token`, {}, friendToken);
    expect(r.status).toBe(200);
    expect(r.body.url).toBe(LK.url);
    const claims = await new TokenVerifier(LK.apiKey, LK.apiSecret).verify(r.body.token);
    expect(claims.name).toBe("amigo");
    expect(claims.video?.room).toBe(voiceRoomName(sala.id));
    expect(claims.video?.roomJoin).toBe(true);
  });

  it("estado de voz é compartilhado e some quando a conexão cai", async () => {
    const sala = (await get("/channels", adminToken)).body.find((c: any) => c.name === "Sala");
    const open = (token: string) =>
      new Promise<{ ws: WebSocket; next: (pred: (e: any) => boolean) => Promise<any> }>((resolve, reject) => {
        const ws = new WebSocket(base.replace("http", "ws") + `/ws?token=${token}`);
        const events: any[] = [];
        const waiters: { pred: (e: any) => boolean; resolve: (e: any) => void }[] = [];
        ws.on("message", (raw) => {
          const evt = JSON.parse(raw.toString());
          const w = waiters.findIndex((x) => x.pred(evt));
          if (w >= 0) waiters.splice(w, 1)[0]!.resolve(evt);
          else events.push(evt);
        });
        const next = (pred: (e: any) => boolean) => {
          const i = events.findIndex(pred);
          if (i >= 0) return Promise.resolve(events.splice(i, 1)[0]);
          return new Promise<any>((r) => waiters.push({ pred, resolve: r }));
        };
        ws.on("open", () => resolve({ ws, next }));
        ws.on("error", reject);
      });
    const a = await open(adminToken);
    const b = await open(friendToken);
    await b.next((e) => e.t === "voiceStates");
    a.ws.send(JSON.stringify({ t: "voice", channelId: sala.id, muted: false, deafened: false }));
    let evt = await b.next((e) => e.t === "voiceStates" && e.states.length === 1);
    expect(evt.states[0]).toMatchObject({ username: "thiago", channelId: sala.id, muted: false });
    a.ws.send(JSON.stringify({ t: "voice", channelId: sala.id, muted: true, deafened: true }));
    evt = await b.next((e) => e.t === "voiceStates" && e.states[0]?.deafened);
    expect(evt.states[0].muted).toBe(true);
    a.ws.close();
    evt = await b.next((e) => e.t === "voiceStates" && e.states.length === 0);
    expect(evt.states).toEqual([]);
    b.ws.close();
  });

  it("websocket sem token válido é recusado", async () => {
    const code = await new Promise<number>((resolve) => {
      const ws = new WebSocket(base.replace("http", "ws") + "/ws?token=x");
      ws.on("close", (c) => resolve(c));
      ws.on("error", () => {});
    });
    expect(code).toBe(4401);
  });
});
