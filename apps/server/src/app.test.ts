import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createDb, type DbHandle } from "@turtle/db";
import { buildApp } from "./app.js";

let handle: DbHandle;
let app: Awaited<ReturnType<typeof buildApp>>;
let base = "";

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
  app = await buildApp({ db: handle.db, bootstrapInvite: "boot" });
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
    expect((await get("/channels", friendToken)).body.map((c: any) => c.name)).toEqual(["geral", "jogos"]);
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

  it("websocket sem token válido é recusado", async () => {
    const code = await new Promise<number>((resolve) => {
      const ws = new WebSocket(base.replace("http", "ws") + "/ws?token=x");
      ws.on("close", (c) => resolve(c));
      ws.on("error", () => {});
    });
    expect(code).toBe(4401);
  });
});
