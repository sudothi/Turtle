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

const channelsOf = async (serverId: string, token: string) => (await get(`/servers/${serverId}/channels`, token)).body;

describe("server", () => {
  let adminToken = "";
  let friendToken = "";
  let turtleId = "";

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
    // convite de conta: o amigo entra no servidor mais antigo, "Turtle", como membro
    const servers = (await get("/servers", friendToken)).body;
    expect(servers.map((x: any) => `${x.name}:${x.role}`)).toEqual(["Turtle:member"]);
    turtleId = servers[0].id;
    expect((await get("/servers", adminToken)).body[0]).toMatchObject({ id: turtleId, role: "owner" });
    expect((await post("/invites", {}, friendToken)).status).toBe(403);
    expect((await post(`/servers/${turtleId}/channels`, { name: "jogos" }, friendToken)).status).toBe(403);
    expect((await post(`/servers/${turtleId}/channels`, { name: "jogos" }, adminToken)).status).toBe(200);
    expect((await channelsOf(turtleId, friendToken)).map((c: any) => `${c.kind}:${c.name}`)).toEqual(["text:geral", "voice:Sala", "text:jogos"]);
    expect((await post(`/servers/${turtleId}/channels`, { name: "Lobby", kind: "voice" }, adminToken)).body.kind).toBe("voice");
  });

  it("mensagens trafegam em tempo real e ficam no histórico", async () => {
    const channels = await channelsOf(turtleId, adminToken);
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
    const channels = await channelsOf(turtleId, friendToken);
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
    expect(claims.video?.canPublishSources).toEqual(["microphone", "camera", "screen_share", "screen_share_audio"]);
  });

  it("estado de voz é compartilhado e some quando a conexão cai", async () => {
    const sala = (await channelsOf(turtleId, adminToken)).find((c: any) => c.name === "Sala");
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
    expect(evt.states[0]).toMatchObject({ username: "thiago", channelId: sala.id, serverId: turtleId, muted: false });
    a.ws.send(JSON.stringify({ t: "voice", channelId: sala.id, muted: true, deafened: true, screen: true }));
    evt = await b.next((e) => e.t === "voiceStates" && e.states[0]?.deafened);
    expect(evt.states[0]).toMatchObject({ muted: true, screen: true, camera: false });
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


/** Abre um WebSocket que guarda os eventos para consulta (para testar o que cada pessoa recebe). */
const listen = (token: string) =>
  new Promise<{ ws: WebSocket; events: any[]; close: () => void }>((resolve, reject) => {
    const ws = new WebSocket(base.replace("http", "ws") + `/ws?token=${token}`);
    const events: any[] = [];
    ws.on("message", (raw) => events.push(JSON.parse(raw.toString())));
    ws.on("open", () => resolve({ ws, events, close: () => ws.close() }));
    ws.on("error", reject);
  });
const settle = () => new Promise((r) => setTimeout(r, 150));
const del = async (url: string, token: string, body?: unknown) => {
  const res = await fetch(base + url, {
    method: "DELETE",
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
};
const patch = async (url: string, body: unknown, token: string) => {
  const res = await fetch(base + url, {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
};

describe("servidores", () => {
  let ana = "";
  let bia = "";
  let caio = "";
  let anaId = "";
  let biaId = "";
  let caioId = "";
  let lagoa = "";

  it("registra pessoas por convite de conta (entram no Turtle) e cada uma cria seu servidor", async () => {
    // thiago (primeiro admin) já existe; novos convites de conta
    const login = (await post("/auth/login", { username: "thiago", password: "12345678" })).body.token;
    const mk = async (name: string) => {
      const inv = await post("/invites", {}, login);
      const r = await post("/auth/register", { inviteCode: inv.body.code, username: name, password: "12345678" });
      return { token: r.body.token as string, id: r.body.user.id as string };
    };
    ({ token: ana, id: anaId } = await mk("ana"));
    ({ token: bia, id: biaId } = await mk("bia"));
    ({ token: caio, id: caioId } = await mk("caio"));
    const created = await post("/servers", { name: "Lagoa dos Amigos" }, ana);
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ name: "Lagoa dos Amigos", ownerId: anaId, role: "owner" });
    lagoa = created.body.id;
    // vem com um canal de texto e um de voz
    expect((await channelsOf(lagoa, ana)).map((c: any) => `${c.kind}:${c.name}`)).toEqual(["text:geral", "voice:Sala"]);
    expect((await post("/servers", { name: "x" }, ana)).status).toBe(400);
  });

  it("limita a 2 servidores como dono; sair de um liberaria a vaga, apagar também", async () => {
    expect((await post("/servers", { name: "Segundo" }, ana)).status).toBe(200);
    const third = await post("/servers", { name: "Terceiro" }, ana);
    expect(third.status).toBe(409);
    // apagar pede o nome e libera a vaga
    const segundo = (await get("/servers", ana)).body.find((x: any) => x.name === "Segundo");
    expect((await del(`/servers/${segundo.id}`, ana, { name: "errado" })).status).toBe(400);
    expect((await del(`/servers/${segundo.id}`, ana, { name: "Segundo" })).status).toBe(200);
    expect((await post("/servers", { name: "Terceiro" }, ana)).status).toBe(200);
    // a limitação é por pessoa: bia ainda pode criar os dois dela
    expect((await post("/servers", { name: "Da Bia" }, bia)).status).toBe(200);
  });

  it("quem não é membro não vê canais, mensagens nem recebe token de voz", async () => {
    expect((await get(`/servers/${lagoa}/channels`, bia)).status).toBe(404);
    expect((await get(`/servers/${lagoa}/members`, bia)).status).toBe(404);
    const [geral, sala] = await channelsOf(lagoa, ana);
    expect((await get(`/channels/${geral.id}/messages`, bia)).status).toBe(404);
    expect((await post(`/voice/${sala.id}/token`, {}, bia)).status).toBe(404);
    expect((await post(`/servers/${lagoa}/channels`, { name: "invasao" }, bia)).status).toBe(404);
  });

  it("convite de servidor: prévia pública, entrar com conta existente, criar conta, validade e usos", async () => {
    const inv = await post(`/servers/${lagoa}/invites`, {}, ana);
    expect(inv.status).toBe(200);
    expect(inv.body.expiresAt).toBeTruthy();
    const preview = await fetch(base + `/invites/${inv.body.code}`);
    expect(await preview.json()).toEqual({ serverName: "Lagoa dos Amigos", members: 1 });
    expect((await fetch(base + "/invites/inexistente")).status).toBe(404);
    // bia entra; entrar de novo não duplica nem gasta uso
    expect((await post(`/invites/${inv.body.code}/join`, {}, bia)).body).toMatchObject({ id: lagoa, role: "member" });
    expect((await post(`/invites/${inv.body.code}/join`, {}, bia)).status).toBe(200);
    expect((await get(`/servers/${lagoa}/members`, ana)).body).toHaveLength(2);
    // o mesmo convite cria uma conta nova que entra só nesse servidor
    const reg = await post("/auth/register", { inviteCode: inv.body.code, username: "duda", password: "12345678" });
    expect(reg.status).toBe(200);
    expect((await get("/servers", reg.body.token)).body.map((x: any) => x.name)).toEqual(["Lagoa dos Amigos"]);
    // limite de usos: 1 uso só
    const once = await post(`/servers/${lagoa}/invites`, { maxUses: 1 }, ana);
    expect((await post(`/invites/${once.body.code}/join`, {}, caio)).status).toBe(200);
    expect((await post(`/invites/${once.body.code}/join`, {}, (await post("/auth/login", { username: "thiago", password: "12345678" })).body.token)).status).toBe(404);
    // convite sem validade não traz data
    expect((await post(`/servers/${lagoa}/invites`, { days: 0 }, ana)).body.expiresAt).toBeNull();
  });

  it("cargos: membro não gerencia; dono promove; admin cria canal e expulsa só membros", async () => {
    // bia (membro) não cria canal nem convida para cargo; caio é membro também
    expect((await post(`/servers/${lagoa}/channels`, { name: "musicas" }, bia)).status).toBe(403);
    expect((await patch(`/servers/${lagoa}/members/${biaId}`, { role: "admin" }, bia)).status).toBe(403);
    expect((await patch(`/servers/${lagoa}/members/${biaId}`, { role: "admin" }, ana)).status).toBe(200);
    expect((await post(`/servers/${lagoa}/channels`, { name: "musicas" }, bia)).status).toBe(200);
    expect((await patch(`/servers/${lagoa}/members/${anaId}`, { role: "member" }, ana)).status).toBe(400);
    // admin não expulsa o dono nem outro admin; expulsa membro
    expect((await patch(`/servers/${lagoa}/members/${caioId}`, { role: "admin" }, ana)).status).toBe(200);
    expect((await del(`/servers/${lagoa}/members/${caioId}`, bia)).status).toBe(403);
    expect((await del(`/servers/${lagoa}/members/${anaId}`, bia)).status).toBe(403);
    expect((await patch(`/servers/${lagoa}/members/${caioId}`, { role: "member" }, ana)).status).toBe(200);
    expect((await del(`/servers/${lagoa}/members/${caioId}`, bia)).status).toBe(200);
    expect((await get(`/servers/${lagoa}/channels`, caio)).status).toBe(404);
    // só o dono renomeia
    expect((await patch(`/servers/${lagoa}`, { name: "Lagoa 2" }, bia)).status).toBe(403);
    expect((await patch(`/servers/${lagoa}`, { name: "Lagoa 2" }, ana)).status).toBe(200);
    expect((await get("/servers", bia)).body.find((x: any) => x.id === lagoa).name).toBe("Lagoa 2");
  });

  it("dono não sai sem passar a posse; passar respeita o limite de 2 do novo dono", async () => {
    expect((await del(`/servers/${lagoa}/members/${anaId}`, ana)).status).toBe(403);
    expect((await post(`/servers/${lagoa}/transfer`, { userId: anaId }, ana)).status).toBe(400);
    // bia já tem 1 servidor; mais 1 chega a 2, então receber o terceiro falha
    expect((await post("/servers", { name: "Da Bia 2" }, bia)).status).toBe(200);
    expect((await post(`/servers/${lagoa}/transfer`, { userId: biaId }, ana)).status).toBe(409);
    // libera uma vaga da bia e passa
    const extra = (await get("/servers", bia)).body.find((x: any) => x.name === "Da Bia 2");
    expect((await del(`/servers/${extra.id}`, bia, { name: "Da Bia 2" })).status).toBe(200);
    expect((await post(`/servers/${lagoa}/transfer`, { userId: biaId }, ana)).status).toBe(200);
    const mine = (await get("/servers", ana)).body.find((x: any) => x.id === lagoa);
    expect(mine.role).toBe("admin");
    expect((await get("/servers", bia)).body.find((x: any) => x.id === lagoa)).toMatchObject({ role: "owner", ownerId: biaId });
    // agora a ana pode sair
    expect((await del(`/servers/${lagoa}/members/${anaId}`, ana)).status).toBe(200);
    expect((await get("/servers", ana)).body.map((x: any) => x.id)).not.toContain(lagoa);
  });

  it("mensagens e estado de voz só chegam a quem é membro do servidor", async () => {
    const [geral, sala] = await channelsOf(lagoa, bia);
    const donaOnline = await listen(bia);
    const forasteiro = await listen(caio);
    await settle();
    donaOnline.ws.send(JSON.stringify({ t: "send", channelId: geral.id, content: "só para a lagoa" }));
    donaOnline.ws.send(JSON.stringify({ t: "voice", channelId: sala.id, muted: false, deafened: false }));
    await settle();
    expect(donaOnline.events.some((e) => e.t === "message")).toBe(true);
    expect(donaOnline.events.some((e) => e.t === "voiceStates" && e.states.length === 1)).toBe(true);
    expect(forasteiro.events.some((e) => e.t === "message")).toBe(false);
    expect(forasteiro.events.filter((e) => e.t === "voiceStates").every((e) => e.states.length === 0)).toBe(true);
    // forasteiro não consegue falar no canal nem entrar na chamada
    forasteiro.ws.send(JSON.stringify({ t: "send", channelId: geral.id, content: "intruso" }));
    forasteiro.ws.send(JSON.stringify({ t: "voice", channelId: sala.id, muted: false, deafened: false }));
    await settle();
    expect(forasteiro.events.filter((e) => e.t === "error")).toHaveLength(2);
    // quem é expulso sai da chamada e das listas na hora
    const inv = await post(`/servers/${lagoa}/invites`, {}, bia);
    await post(`/invites/${inv.body.code}/join`, {}, caio);
    forasteiro.ws.send(JSON.stringify({ t: "voice", channelId: sala.id, muted: false, deafened: false }));
    await settle();
    expect(donaOnline.events.some((e) => e.t === "voiceStates" && e.states.length === 2)).toBe(true);
    await del(`/servers/${lagoa}/members/${caioId}`, bia);
    await settle();
    const last = donaOnline.events.filter((e) => e.t === "voiceStates").at(-1);
    expect(last.states.map((v: any) => v.username)).toEqual(["bia"]);
    expect(forasteiro.events.some((e) => e.t === "sync")).toBe(true);
    donaOnline.close();
    forasteiro.close();
  });

  it("apagar o servidor remove canais e mensagens e avisa os membros", async () => {
    const online = await listen(ana);
    const inv = await post(`/servers/${lagoa}/invites`, {}, bia);
    await post(`/invites/${inv.body.code}/join`, {}, ana);
    await settle();
    const [geral] = await channelsOf(lagoa, bia);
    expect((await del(`/servers/${lagoa}`, ana, { name: "Lagoa 2" })).status).toBe(403);
    expect((await del(`/servers/${lagoa}`, bia, { name: "Lagoa 2" })).status).toBe(200);
    await settle();
    expect((await get(`/servers/${lagoa}/channels`, bia)).status).toBe(404);
    expect((await get(`/channels/${geral.id}/messages`, bia)).status).toBe(404);
    expect(online.events.filter((e) => e.t === "sync").length).toBeGreaterThan(0);
    online.close();
  });
});
