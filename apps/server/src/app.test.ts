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
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  app = await buildApp({ db: handle.db, bootstrapInvite: "boot", livekit: LK, uploadDir: mkdtempSync(join(tmpdir(), "turtle-up-")), authLimit: { perIp: 100_000, perName: 8 } });
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
    // contas novas começam sem servidor (nem o admin ganha um automaticamente)
    expect((await get("/servers", friendToken)).body).toEqual([]);
    expect((await get("/servers", adminToken)).body).toEqual([]);
    turtleId = (await post("/servers", { name: "Turtle" }, adminToken)).body.id;
    const sInv = await post(`/servers/${turtleId}/invites`, {}, adminToken);
    expect((await post(`/invites/${sInv.body.code}/join`, {}, friendToken)).status).toBe(200);
    expect((await get("/servers", friendToken)).body.map((x: any) => `${x.name}:${x.role}`)).toEqual(["Turtle:member"]);
    expect((await post("/invites", {}, friendToken)).status).toBe(403);
    expect((await post(`/servers/${turtleId}/channels`, { name: "jogos" }, friendToken)).status).toBe(403);
    expect((await post(`/servers/${turtleId}/channels`, { name: "jogos" }, adminToken)).status).toBe(200);
    expect((await channelsOf(turtleId, friendToken)).map((c: any) => `${c.kind}:${c.name}`)).toEqual(["text:geral", "voice:Sala", "text:jogos"]);
    expect((await post(`/servers/${turtleId}/channels`, { name: "Lobby", kind: "voice" }, adminToken)).body.kind).toBe("voice");
  });

  it("admin dá o cargo Convidador e a pessoa passa a gerar convites de conta", async () => {
    const patch = async (url: string, body: unknown, token: string) => {
      const res = await fetch(base + url, { method: "PATCH", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
      return { status: res.status, body: (await res.json()) as any };
    };
    expect((await get("/admin/users", friendToken)).status).toBe(403);
    const list = (await get("/admin/users", adminToken)).body;
    const amigo = list.find((u: any) => u.username === "amigo");
    expect(amigo).toMatchObject({ isAdmin: false, canInvite: false });
    expect((await patch(`/admin/users/${amigo.id}`, { canInvite: true }, friendToken)).status).toBe(403);
    expect((await patch(`/admin/users/${amigo.id}`, { canInvite: true }, adminToken)).status).toBe(200);
    expect((await get("/me", friendToken)).body.canInvite).toBe(true);
    // a tag TURTLE vem junto: no cartão e na lista de membros, e some ao tirar o cargo
    expect((await get(`/users/${amigo.id}`, adminToken)).body.staff).toBe(true);
    // o cartão público não expõe o cargo
    expect((await get(`/users/${amigo.id}`, adminToken)).body.canInvite).toBeUndefined();
    const inv = await post("/invites", {}, friendToken);
    expect(inv.status).toBe(200);
    expect((await post("/auth/register", { inviteCode: inv.body.code, username: "convidado", password: "12345678" })).status).toBe(200);
    // ainda não é admin
    expect((await get("/admin/users", friendToken)).status).toBe(403);
    await patch(`/admin/users/${amigo.id}`, { canInvite: false }, adminToken);
    expect((await post("/invites", {}, friendToken)).status).toBe(403);
    expect((await get(`/users/${amigo.id}`, adminToken)).body.staff).toBe(false);
    expect((await patch("/admin/users/ninguem", { canInvite: true }, adminToken)).status).toBe(404);
  });

  it("presença manda ids, não nomes de usuário", async () => {
    const meId = (await get("/me", friendToken)).body.id;
    const ws = new WebSocket(base.replace("http", "ws") + `/ws?token=${friendToken}`);
    const online = await new Promise<string[]>((resolve) => ws.on("message", (raw) => {
      const evt = JSON.parse(raw.toString());
      if (evt.t === "presence") resolve(evt.online);
    }));
    ws.close();
    expect(online).toContain(meId);
    expect(online).not.toContain("amigo");
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

  it("convite de conta cria a conta sem servidor; cada pessoa cria o seu", async () => {
    // thiago (primeiro admin) já existe; novos convites de conta
    const login = (await post("/auth/login", { username: "thiago", password: "12345678" })).body.token;
    const mk = async (name: string) => {
      const inv = await post("/invites", {}, login);
      const r = await post("/auth/register", { inviteCode: inv.body.code, username: name, password: "12345678" });
      return { token: r.body.token as string, id: r.body.user.id as string };
    };
    ({ token: ana, id: anaId } = await mk("ana"));
    expect((await get("/servers", ana)).body).toEqual([]);
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

  it("convite de servidor: prévia pública, entrar com conta existente, não cria conta, validade e usos", async () => {
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
    // convite de servidor NÃO cria conta: isso só com convite do app (gerado por admin)
    const reg = await post("/auth/register", { inviteCode: inv.body.code, username: "duda", password: "12345678" });
    expect(reg.status).toBe(403);
    expect(reg.body.error).toContain("servidor");
    expect((await post("/auth/login", { username: "duda", password: "12345678" })).status).toBe(401);
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

describe("site compilado", () => {
  it("entrega o site e o index.html nas rotas do app, sem atrapalhar a API", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "turtle-site-"));
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "index.html"), "<title>Turtle</title>");
    writeFileSync(join(dir, "assets", "app-abc.js"), "console.log(1)");
    const h = await createDb();
    const site = await buildApp({ db: h.db, clientDir: dir });
    const url = await site.listen({ port: 0, host: "127.0.0.1" });
    const root = await fetch(url + "/");
    expect(await root.text()).toContain("<title>Turtle</title>");
    expect(root.headers.get("cache-control")).toBe("no-cache");
    const asset = await fetch(url + "/assets/app-abc.js");
    expect(asset.headers.get("cache-control")).toContain("immutable");
    expect((await fetch(url + "/qualquer/rota", { headers: { accept: "text/html" } })).status).toBe(200);
    expect((await fetch(url + "/nada.json", { headers: { accept: "application/json" } })).status).toBe(404);
    expect((await fetch(url + "/health")).status).toBe(200);
    expect((await fetch(url + "/me")).status).toBe(401);
    await site.close();
    await h.close();
  });
});

describe("perfil", () => {
  let tok = "";
  let otherTok = "";
  let strangerTok = "";
  let id = "";
  const send = async (method: string, url: string, token: string, file?: { data: Uint8Array; type: string }) => {
    const form = new FormData();
    if (file) form.append("file", new Blob([file.data as BlobPart], { type: file.type }), "x");
    const res = await fetch(base + url, { method, headers: { authorization: `Bearer ${token}` }, body: file ? form : undefined });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
  };
  const patch = async (body: unknown, token: string) => {
    const res = await fetch(base + "/me", { method: "PATCH", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as any };
  };

  beforeAll(async () => {
    const sharp = (await import("sharp")).default;
    png = new Uint8Array(await sharp({ create: { width: 600, height: 300, channels: 3, background: "#888" } }).png().toBuffer());
  });
  let png: Uint8Array;

  it("prepara contas", async () => {
    const login = await post("/auth/login", { username: "thiago", password: "12345678" });
    tok = login.body.token;
    id = login.body.user.id;
    const code = (await post("/servers", { name: "Perfis" }, tok)).body.id;
    const inv = await post(`/servers/${code}/invites`, {}, tok);
    const accInv = await post("/invites", {}, tok);
    otherTok = (await post("/auth/register", { inviteCode: accInv.body.code, username: "amiga", password: "12345678" })).body.token;
    await post(`/invites/${inv.body.code}/join`, {}, otherTok);
    const acc = await post("/invites", {}, tok);
    strangerTok = (await post("/auth/register", { inviteCode: acc.body.code, username: "ninguem", password: "12345678" })).body.token;
  });

  it("edita nome de exibição e bio, e limpa", async () => {
    const r = await patch({ displayName: "Thi", bio: "oi, sou o thi" }, tok);
    expect(r.body.displayName).toBe("Thi");
    expect(r.body.bio).toBe("oi, sou o thi");
    expect((await patch({ displayName: "x".repeat(40) }, tok)).status).toBe(400);
    expect((await patch({ bio: "x".repeat(191) }, tok)).status).toBe(400);
    expect((await patch({ displayName: "" }, tok)).body.displayName).toBeNull();
  });

  it("envia pfp e banner, serve como WebP e troca apagando o antigo", async () => {
    const a = await send("PUT", "/me/avatar", tok, { data: png, type: "image/png" });
    expect(a.status).toBe(200);
    const key = a.body.avatar as string;
    const file = await fetch(base + `/files/${key}`);
    expect(file.headers.get("content-type")).toBe("image/webp");
    expect(file.headers.get("cache-control")).toContain("immutable");
    const sharp = (await import("sharp")).default;
    const meta = await sharp(Buffer.from(await file.arrayBuffer())).metadata();
    expect([meta.width, meta.height]).toEqual([256, 256]);
    const b = await send("PUT", "/me/banner", tok, { data: png, type: "image/png" });
    const bm = await sharp(Buffer.from(await (await fetch(base + `/files/${b.body.banner}`)).arrayBuffer())).metadata();
    expect([bm.width, bm.height]).toEqual([960, 320]);
    const again = await send("PUT", "/me/avatar", tok, { data: png, type: "image/png" });
    expect(again.body.avatar).not.toBe(key);
    expect((await fetch(base + `/files/${key}`)).status).toBe(404);
  });

  it("rejeita arquivo que não é imagem (mesmo com tipo mentiroso) e imagem grande demais", async () => {
    const fake = await send("PUT", "/me/avatar", tok, { data: new TextEncoder().encode("<svg onload=alert(1)>"), type: "image/png" });
    expect(fake.status).toBe(415);
    const big = await send("PUT", "/me/avatar", tok, { data: new Uint8Array(3 * 1024 * 1024), type: "image/png" });
    expect(big.status).toBe(413);
    expect((await send("PUT", "/me/avatar", tok)).status).toBe(400);
    expect((await fetch(base + "/files/..%2Fapp.ts")).status).toBe(404);
  });

  it("aparece nos membros, no cartão de perfil e some ao remover", async () => {
    const servers = (await get("/servers", tok)).body;
    const sid = servers.find((s: any) => s.name === "Perfis").id;
    const m = (await get(`/servers/${sid}/members`, otherTok)).body.find((x: any) => x.userId === id);
    expect(m.avatar).toBeTruthy();
    const card = await get(`/users/${id}`, otherTok);
    expect(card.body.banner).toBeTruthy();
    expect(card.body.isAdmin).toBeUndefined();
    expect((await get(`/users/${id}`, strangerTok)).status).toBe(404);
    await send("DELETE", "/me/avatar", tok);
    expect((await get(`/users/${id}`, otherTok)).body.avatar).toBeNull();
  });

  it("limita a frequência de envios por conta", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await send("PUT", "/me/banner", otherTok, { data: png, type: "image/png" })).status);
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes[10]).toBe(429);
  });
});

describe("amigos e mensagens diretas", () => {
  let a = "", b = "", c = "", aId = "", bId = "", cId = "";
  const del = async (url: string, token: string) => {
    const res = await fetch(base + url, { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
    return { status: res.status, body: (await res.json()) as any };
  };
  const wsOpen = (token: string) =>
    new Promise<{ ws: WebSocket; events: any[] }>((resolve) => {
      const ws = new WebSocket(base.replace("http", "ws") + `/ws?token=${token}`);
      const events: any[] = [];
      ws.on("message", (d) => events.push(JSON.parse(d.toString())));
      ws.on("open", () => resolve({ ws, events }));
    });

  it("prepara contas", async () => {
    const admin = (await post("/auth/login", { username: "thiago", password: "12345678" })).body.token;
    const mk = async (username: string) => {
      const inv = await post("/invites", {}, admin);
      return (await post("/auth/register", { inviteCode: inv.body.code, username, password: "12345678" })).body;
    };
    const ra = await mk("dm_ana"), rb = await mk("dm_beto"), rc = await mk("dm_caio");
    [a, b, c] = [ra.token, rb.token, rc.token];
    [aId, bId, cId] = [ra.user.id, rb.user.id, rc.user.id];
  });

  it("pede, aceita, lista e desfaz amizade", async () => {
    expect((await post(`/friends/${aId}`, {}, a)).status).toBe(400);
    expect((await post("/friends", { username: "ninguem_existe" }, a)).status).toBe(404);
    expect((await post("/friends", { username: "DM_BETO" }, a)).body.status).toBe("outgoing");
    expect((await get("/friends", a)).body).toMatchObject([{ user: { id: bId }, status: "outgoing" }]);
    expect((await get("/friends", b)).body).toMatchObject([{ user: { id: aId }, status: "incoming" }]);
    expect((await post(`/friends/${aId}`, {}, b)).body.status).toBe("friend");
    expect((await get("/friends", a)).body[0].status).toBe("friend");
    expect((await del(`/friends/${bId}`, a)).status).toBe(200);
    expect((await get("/friends", b)).body).toEqual([]);
  });

  it("DM exige amizade ou servidor em comum", async () => {
    expect((await post(`/dms/${cId}`, {}, a)).status).toBe(403);
    expect((await post(`/dms/${aId}`, {}, a)).status).toBe(404);
    await post(`/friends/${cId}`, {}, a);
    await post(`/friends/${aId}`, {}, c);
    expect((await post(`/dms/${cId}`, {}, a)).status).toBe(200);
  });

  it("conversa 1:1: mesma conversa dos dois lados, só os dois recebem, histórico restrito", async () => {
    const d1 = (await post(`/dms/${cId}`, {}, a)).body;
    const d2 = (await post(`/dms/${aId}`, {}, c)).body;
    expect(d1.channelId).toBe(d2.channelId);
    const A = await wsOpen(a), C = await wsOpen(c), B = await wsOpen(b);
    A.ws.send(JSON.stringify({ t: "send", channelId: d1.channelId, content: "oi caio" }));
    await new Promise((r) => setTimeout(r, 300));
    for (const x of [A, C]) expect(x.events.some((e) => e.t === "message" && e.message.content === "oi caio")).toBe(true);
    expect(B.events.some((e) => e.t === "message")).toBe(false);
    B.ws.send(JSON.stringify({ t: "send", channelId: d1.channelId, content: "intruso" }));
    await new Promise((r) => setTimeout(r, 200));
    expect(B.events.some((e) => e.t === "error")).toBe(true);
    expect((await get(`/channels/${d1.channelId}/messages`, b)).status).toBe(404);
    expect((await get(`/channels/${d1.channelId}/messages`, c)).body.map((m: any) => m.content)).toEqual(["oi caio"]);
    const list = (await get("/dms", c)).body;
    expect(list).toMatchObject([{ channelId: d1.channelId, group: false, users: [{ id: aId }] }]);
    expect(list[0].lastMessageAt).toBeTruthy();
    // Chamada na DM: os dois pegam token da sala da conversa; quem não é da DM, não.
    const tk = await post(`/voice/${d1.channelId}/token`, {}, a);
    expect(tk.status).toBe(200);
    await expect(new TokenVerifier(LK.apiKey, LK.apiSecret).verify(tk.body.token)).resolves.toMatchObject({ video: { room: voiceRoomName(d1.channelId) } });
    expect((await post(`/voice/${d1.channelId}/token`, {}, c)).status).toBe(200);
    expect((await post(`/voice/${d1.channelId}/token`, {}, b)).status).toBe(404);
    // Estado da chamada chega só a quem está na DM.
    A.ws.send(JSON.stringify({ t: "voice", channelId: d1.channelId, muted: false, deafened: false, camera: false, screen: false }));
    await new Promise((r) => setTimeout(r, 300));
    const last = (x: typeof A) => [...x.events].reverse().find((e) => e.t === "voiceStates");
    expect(last(C).states.map((v: any) => v.channelId)).toEqual([d1.channelId]);
    expect(last(B).states).toEqual([]);
    for (const x of [A, B, C]) x.ws.close();
  });

  it("perfil: amigo sem servidor em comum vê, com data da conta, amigos em comum e estado da amizade", async () => {
    expect((await get(`/users/${cId}`, b)).status).toBe(404);
    const p = (await get(`/users/${cId}`, a)).body;
    expect(p).toMatchObject({ id: cId, username: "dm_caio", friendship: "friend", blocked: false, mutualServers: [], mutualFriends: [] });
    expect(new Date(p.createdAt).getTime()).toBeGreaterThan(0);
    expect(p.isAdmin).toBeUndefined();
    // b vira amigo de a e de c: a vê b como amigo em comum com c.
    await post(`/friends/${bId}`, {}, a); await post(`/friends/${aId}`, {}, b);
    await post(`/friends/${bId}`, {}, c); await post(`/friends/${cId}`, {}, b);
    expect((await get(`/users/${cId}`, a)).body.mutualFriends.map((f: any) => f.id)).toEqual([bId]);
    await del(`/friends/${bId}`, a); await del(`/friends/${bId}`, c);
    expect((await get(`/users/${aId}`, a)).body.friendship).toBe("none");
  });

  it("bloqueio: desfaz amizade, impede pedido, DM nova, mensagem e chamada", async () => {
    const dm = (await post(`/dms/${cId}`, {}, a)).body;
    expect((await post(`/blocks/${aId}`, {}, c)).body.ok).toBe(true);
    expect((await get("/blocks", c)).body.map((p: any) => p.id)).toEqual([aId]);
    expect((await get("/friends", a)).body.some((f: any) => f.user.id === cId)).toBe(false);
    expect((await post(`/friends/${cId}`, {}, a)).status).toBe(403);
    expect((await post(`/friends/${aId}`, {}, c)).status).toBe(403);
    expect((await post(`/dms/${aId}`, {}, c)).status).toBe(403);
    expect((await post(`/voice/${dm.channelId}/token`, {}, a)).status).toBe(404);
    const A = await wsOpen(a);
    A.ws.send(JSON.stringify({ t: "send", channelId: dm.channelId, content: "oi?" }));
    await new Promise((r) => setTimeout(r, 200));
    expect(A.events.some((e) => e.t === "error")).toBe(true);
    A.ws.close();
    expect((await del(`/blocks/${aId}`, c)).status).toBe(200);
    expect((await get("/blocks", c)).body).toEqual([]);
    // volta a ser amigo para os próximos testes
    await post(`/friends/${cId}`, {}, a);
    await post(`/friends/${aId}`, {}, c);
  });

  it("grupo: só amigos, mensagens chegam a todos, adicionar, sair e chamada", async () => {
    await post(`/friends/${bId}`, {}, a);
    await post(`/friends/${aId}`, {}, b);
    expect((await post("/dms", { userIds: [bId] }, a)).status).toBe(400);
    expect((await post("/dms", { userIds: [bId, "ninguem"] }, a)).status).toBe(403);
    const g = await post("/dms", { userIds: [bId, cId], name: "Trio" }, a);
    expect(g.status).toBe(200);
    expect(g.body).toMatchObject({ group: true, name: "Trio" });
    expect(g.body.users.map((u: any) => u.id).sort()).toEqual([bId, cId].sort());
    const [A, B, C] = await Promise.all([wsOpen(a), wsOpen(b), wsOpen(c)]);
    A.ws.send(JSON.stringify({ t: "send", channelId: g.body.channelId, content: "oi trio" }));
    await new Promise((r) => setTimeout(r, 300));
    for (const x of [A, B, C]) expect(x.events.some((e) => e.t === "message" && e.message.content === "oi trio")).toBe(true);
    expect((await post(`/voice/${g.body.channelId}/token`, {}, b)).status).toBe(200);
    expect((await post(`/dms/${g.body.channelId}/members`, { userId: bId }, a)).status).toBe(409);
    const admin = (await post("/auth/login", { username: "thiago", password: "12345678" })).body;
    expect((await post(`/dms/${g.body.channelId}/members`, { userId: admin.user.id }, a)).status).toBe(403);
    expect((await del(`/dms/${g.body.channelId}/members/me`, b)).status).toBe(200);
    expect((await get(`/channels/${g.body.channelId}/messages`, b)).status).toBe(404);
    expect((await get("/dms", b)).body.some((d: any) => d.channelId === g.body.channelId)).toBe(false);
    for (const x of [A, B, C]) x.ws.close();
  });
});

describe("chat do dia a dia", () => {
  let dono = "";
  let membro = "";
  let fora = "";
  let donoId = "";
  let membroId = "";
  let serverId = "";
  let geral = "";
  const upload = async (url: string, token: string, data: Uint8Array, name: string, type = "application/octet-stream", method = "POST") => {
    const form = new FormData();
    form.append("file", new Blob([data as BlobPart], { type }), name);
    const res = await fetch(base + url, { method, headers: { authorization: `Bearer ${token}` }, body: form });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
  };
  const say = (ws: WebSocket, channelId: string, content: string, attachments: string[] = []) =>
    ws.send(JSON.stringify({ t: "send", channelId, content, attachments }));

  it("prepara contas e servidor", async () => {
    const admin = (await post("/auth/login", { username: "thiago", password: "12345678" })).body.token;
    const mk = async (name: string) => {
      const inv = await post("/invites", {}, admin);
      const r = await post("/auth/register", { inviteCode: inv.body.code, username: name, password: "12345678" });
      return { token: r.body.token as string, id: r.body.user.id as string };
    };
    ({ token: dono, id: donoId } = await mk("dia-dono"));
    ({ token: membro, id: membroId } = await mk("dia-membro"));
    ({ token: fora } = await mk("dia-fora"));
    serverId = (await post("/servers", { name: "Dia" }, dono)).body.id;
    const inv = await post(`/servers/${serverId}/invites`, {}, dono);
    await post(`/invites/${inv.body.code}/join`, {}, membro);
    geral = (await channelsOf(serverId, dono)).find((c: any) => c.kind === "text").id;
  });

  it("status Não perturbe aparece na presença e no perfil", async () => {
    const watcher = await listen(dono);
    const r = await patch("/me", { status: "busy" }, membro);
    expect(r.body.status).toBe("busy");
    const m = await listen(membro);
    await settle();
    const last = watcher.events.filter((e) => e.t === "presence").at(-1);
    expect(last.busy).toContain(membroId);
    expect(last.online).toContain(membroId);
    expect((await patch("/me", { status: "sumido" }, membro)).status).toBe(400);
    await patch("/me", { status: "online" }, membro);
    await settle();
    expect(watcher.events.filter((e) => e.t === "presence").at(-1).busy).not.toContain(membroId);
    watcher.close();
    m.close();
  });

  it("não lidas: contam mensagens dos outros, menções, e somem ao ler (avisando os outros aparelhos)", async () => {
    const d = await listen(dono);
    const m2 = await listen(membro);
    say(d.ws, geral, "oi");
    say(d.ws, geral, `ei <@${membroId}>`);
    await settle();
    const mine = (await get("/unread", membro)).body.find((u: any) => u.channelId === geral);
    expect(mine).toEqual({ channelId: geral, serverId, count: 2, mentions: 1 });
    // quem escreveu não tem não lidas
    expect((await get("/unread", dono)).body.find((u: any) => u.channelId === geral)).toBeUndefined();
    expect((await post(`/channels/${geral}/read`, {}, fora)).status).toBe(404);
    expect((await post(`/channels/${geral}/read`, {}, membro)).status).toBe(200);
    await settle();
    expect(m2.events.some((e) => e.t === "read" && e.channelId === geral)).toBe(true);
    expect(d.events.some((e) => e.t === "read")).toBe(false);
    expect((await get("/unread", membro)).body.find((u: any) => u.channelId === geral)).toBeUndefined();
    d.close();
    m2.close();
  });

  it("histórico antigo vem em páginas com ?before", async () => {
    const d = await listen(dono);
    for (let i = 0; i < 12; i++) {
      say(d.ws, geral, `n${i}`);
      await new Promise((r) => setTimeout(r, 3));
    }
    await settle();
    const last = (await get(`/channels/${geral}/messages?limit=5`, dono)).body;
    expect(last.map((m: any) => m.content)).toEqual(["n7", "n8", "n9", "n10", "n11"]);
    const older = (await get(`/channels/${geral}/messages?limit=5&before=${encodeURIComponent(last[0].createdAt)}`, dono)).body;
    expect(older.map((m: any) => m.content)).toEqual(["n2", "n3", "n4", "n5", "n6"]);
    expect((await get(`/channels/${geral}/messages?before=ontem`, dono)).status).toBe(400);
    d.close();
  });

  it("editar: só quem escreveu; apagar: autor ou dono/admin; todos recebem o evento", async () => {
    const d = await listen(dono);
    const m = await listen(membro);
    say(m.ws, geral, "texto com erro");
    await settle();
    const msg = m.events.find((e) => e.t === "message" && e.message.content === "texto com erro").message;
    expect(msg.editedAt).toBeNull();
    expect((await patch(`/messages/${msg.id}`, { content: "outro" }, dono)).status).toBe(403);
    expect((await patch(`/messages/${msg.id}`, { content: "  " }, membro)).status).toBe(400);
    const ed = await patch(`/messages/${msg.id}`, { content: "texto certo" }, membro);
    expect(ed.status).toBe(200);
    expect(ed.body.editedAt).toBeTruthy();
    await settle();
    expect(d.events.find((e) => e.t === "messageUpdate")?.message.content).toBe("texto certo");
    const hist = (await get(`/channels/${geral}/messages`, dono)).body;
    expect(hist.find((x: any) => x.id === msg.id).content).toBe("texto certo");
    // membro não apaga a do dono; dono apaga a do membro
    say(d.ws, geral, "do dono");
    await settle();
    const donoMsg = d.events.filter((e) => e.t === "message" && e.message.content === "do dono")[0].message;
    expect((await del(`/messages/${donoMsg.id}`, membro)).status).toBe(403);
    expect((await del(`/messages/${msg.id}`, fora)).status).toBe(404);
    expect((await del(`/messages/${msg.id}`, dono)).status).toBe(200);
    await settle();
    expect(m.events.some((e) => e.t === "messageDelete" && e.id === msg.id && e.channelId === geral)).toBe(true);
    expect((await get(`/channels/${geral}/messages`, dono)).body.some((x: any) => x.id === msg.id)).toBe(false);
    d.close();
    m.close();
  });

  it("responder: cita a mensagem do mesmo canal, conta como menção e mostra apagada quando somem", async () => {
    const d = await listen(dono);
    const m = await listen(membro);
    say(m.ws, geral, "pergunta do membro");
    await settle();
    const original = m.events.find((e) => e.t === "message" && e.message.content === "pergunta do membro").message;
    expect(original.replyToId).toBeNull();
    await post(`/channels/${geral}/read`, {}, membro);
    d.ws.send(JSON.stringify({ t: "send", channelId: geral, content: "resposta do dono", replyTo: original.id }));
    await settle();
    const reply = m.events.find((e) => e.t === "message" && e.message.content === "resposta do dono").message;
    expect(reply.replyToId).toBe(original.id);
    expect(reply.replyTo).toMatchObject({ id: original.id, userId: membroId, username: "dia-membro", content: "pergunta do membro", attachments: 0 });
    // responder a mim conta como menção nas não lidas
    expect((await get("/unread", membro)).body.find((u: any) => u.channelId === geral)).toMatchObject({ count: 1, mentions: 1 });
    // o histórico traz a prévia
    const hist = (await get(`/channels/${geral}/messages`, dono)).body;
    expect(hist.find((x: any) => x.id === reply.id).replyTo.content).toBe("pergunta do membro");
    // não dá para responder a mensagem de outro canal nem a uma que não existe
    const outro = (await post(`/servers/${serverId}/channels`, { name: "outro" }, dono)).body.id;
    d.ws.send(JSON.stringify({ t: "send", channelId: outro, content: "x", replyTo: original.id }));
    d.ws.send(JSON.stringify({ t: "send", channelId: geral, content: "y", replyTo: "naoexiste" }));
    await settle();
    expect(d.events.filter((e) => e.t === "error" && /respondida/.test(e.error))).toHaveLength(2);
    // apagar a original: a resposta continua, sem a prévia
    expect((await del(`/messages/${original.id}`, membro)).status).toBe(200);
    const after = (await get(`/channels/${geral}/messages`, dono)).body.find((x: any) => x.id === reply.id);
    expect(after).toMatchObject({ replyToId: original.id, replyTo: null });
    await post(`/channels/${geral}/read`, {}, membro);
    d.close();
    m.close();
  });

  it("nonce: confirma o envio, reenvio não duplica e erro volta com o nonce", async () => {
    const d = await listen(dono);
    const m = await listen(membro);
    const msg = { t: "send", channelId: geral, content: "mensagem única", nonce: "n-123" };
    d.ws.send(JSON.stringify(msg));
    await settle();
    const first = d.events.find((e) => e.t === "message" && e.message.content === "mensagem única");
    expect(first.nonce).toBe("n-123");
    // a conexão caiu antes da confirmação: o cliente reenvia o mesmo nonce
    d.ws.send(JSON.stringify(msg));
    await settle();
    const confirms = d.events.filter((e) => e.t === "message" && e.nonce === "n-123");
    expect(confirms).toHaveLength(2);
    expect(confirms[1].message.id).toBe(first.message.id);
    // os outros recebem uma vez só, e o histórico tem uma só
    expect(m.events.filter((e) => e.t === "message" && e.message.content === "mensagem única")).toHaveLength(1);
    expect((await get(`/channels/${geral}/messages`, dono)).body.filter((x: any) => x.content === "mensagem única")).toHaveLength(1);
    // outra pessoa com o mesmo nonce não é confundida
    m.ws.send(JSON.stringify({ ...msg, content: "do membro" }));
    await settle();
    expect(m.events.find((e) => e.t === "message" && e.nonce === "n-123" && e.message.content === "do membro")).toBeTruthy();
    // falha: o erro diz qual envio foi
    d.ws.send(JSON.stringify({ t: "send", channelId: "nao-existe", content: "x", nonce: "n-err" }));
    await settle();
    expect(d.events.find((e) => e.t === "error" && e.nonce === "n-err")).toBeTruthy();
    d.close();
    m.close();
  });

  it("anexos: imagem sem metadados, arquivo baixável, só no próprio canal, e somem com a mensagem", async () => {
    const sharp = (await import("sharp")).default;
    const jpg = new Uint8Array(await sharp({ create: { width: 40, height: 20, channels: 3, background: "#123" } }).jpeg().withMetadata({ exif: { IFD0: { Copyright: "segredo" } } }).toBuffer());
    const img = await upload(`/channels/${geral}/attachments`, membro, jpg, "foto.jpg", "image/jpeg");
    expect(img.status).toBe(200);
    expect(img.body).toMatchObject({ name: "foto.jpg", mime: "image/jpeg", width: 40, height: 20 });
    const served = await fetch(base + `/files/${img.body.key}`);
    expect(served.headers.get("content-type")).toBe("image/jpeg");
    expect(served.headers.get("content-disposition")).toContain("inline");
    expect((await sharp(Buffer.from(await served.arrayBuffer())).metadata()).exif).toBeUndefined();

    const html = await upload(`/channels/${geral}/attachments`, membro, new TextEncoder().encode("<script>alert(1)</script>"), "página ruim.html", "text/html");
    expect(html.body.mime).toBe("application/octet-stream");
    const dl = await fetch(base + `/files/${html.body.key}`);
    expect(dl.headers.get("content-type")).toBe("application/octet-stream");
    expect(dl.headers.get("content-disposition")).toMatch(/^attachment;.*filename\*=UTF-8''p%C3%A1gina%20ruim\.html/);
    expect(dl.headers.get("content-security-policy")).toContain("sandbox");

    expect((await upload(`/channels/${geral}/attachments`, fora, jpg, "x.jpg")).status).toBe(404);
    expect((await upload(`/channels/${geral}/attachments`, membro, new Uint8Array(0), "vazio.txt")).status).toBe(400);

    const m = await listen(membro);
    const d = await listen(dono);
    // o dono não pode usar o anexo do membro
    say(d.ws, geral, "", [img.body.id]);
    await settle();
    expect(d.events.some((e) => e.t === "error")).toBe(true);
    // só anexo, sem texto
    say(m.ws, geral, "", [img.body.id, html.body.id]);
    await settle();
    const sent = d.events.find((e) => e.t === "message")?.message;
    expect(sent.content).toBe("");
    expect(sent.attachments.map((a: any) => a.name)).toEqual(["foto.jpg", "página ruim.html"]);
    // não dá para reaproveitar o mesmo anexo
    say(m.ws, geral, "de novo", [img.body.id]);
    await settle();
    expect(m.events.some((e) => e.t === "error")).toBe(true);
    const hist = (await get(`/channels/${geral}/messages`, dono)).body.find((x: any) => x.id === sent.id);
    expect(hist.attachments).toHaveLength(2);
    expect((await del(`/messages/${sent.id}`, membro)).status).toBe(200);
    expect((await fetch(base + `/files/${img.body.key}`)).status).toBe(404);
    m.close();
    d.close();
  });

  it("canais: dono/admin renomeia e apaga; membro não; nome repetido dá 409", async () => {
    const extra = (await post(`/servers/${serverId}/channels`, { name: "memes" }, dono)).body.id;
    expect((await patch(`/channels/${extra}`, { name: "outro" }, membro)).status).toBe(403);
    expect((await patch(`/channels/${extra}`, { name: "geral" }, dono)).status).toBe(409);
    const r = await patch(`/channels/${extra}`, { name: "memes-bons" }, dono);
    expect(r.body.name).toBe("memes-bons");
    expect((await channelsOf(serverId, membro)).some((c: any) => c.name === "memes-bons")).toBe(true);
    expect((await del(`/channels/${extra}`, membro)).status).toBe(403);
    expect((await del(`/channels/${extra}`, dono)).status).toBe(200);
    expect((await channelsOf(serverId, dono)).some((c: any) => c.id === extra)).toBe(false);
  });

  it("ícone do servidor: só o dono troca; aparece na lista e some ao remover", async () => {
    const sharp = (await import("sharp")).default;
    const png = new Uint8Array(await sharp({ create: { width: 300, height: 300, channels: 3, background: "#fff" } }).png().toBuffer());
    expect((await upload(`/servers/${serverId}/icon`, membro, png, "i.png", "image/png", "PUT")).status).toBe(403);
    const r = await upload(`/servers/${serverId}/icon`, dono, png, "i.png", "image/png", "PUT");
    expect(r.status).toBe(200);
    expect((await get("/servers", membro)).body.find((s: any) => s.id === serverId).icon).toBe(r.body.icon);
    const meta = await sharp(Buffer.from(await (await fetch(base + `/files/${r.body.icon}`)).arrayBuffer())).metadata();
    expect([meta.width, meta.height]).toEqual([256, 256]);
    expect((await del(`/servers/${serverId}/icon`, dono)).status).toBe(200);
    expect((await get("/servers", dono)).body.find((s: any) => s.id === serverId).icon).toBeNull();
    expect((await fetch(base + `/files/${r.body.icon}`)).status).toBe(404);
    expect(donoId).toBeTruthy();
  });
});

describe("limite de tentativas de login", () => {
  it("bloqueia o nome depois de 8 senhas erradas, o IP depois de 20 tentativas, e login certo zera o nome", async () => {
    const db = await createDb();
    const lim = await buildApp({ db: db.db, bootstrapInvite: "boot2" });
    const url = await lim.listen({ port: 0, host: "127.0.0.1" });
    const send = async (path: string, body: unknown, ip = "203.0.113.7") => {
      // vem de 127.0.0.1 (proxy confiável), então o X-Forwarded-For vale como IP de quem tenta
      const res = await fetch(url + path, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) });
      return { status: res.status, retry: res.headers.get("retry-after"), body: (await res.json()) as any };
    };
    expect((await send("/auth/register", { inviteCode: "boot2", username: "dona", password: "12345678" })).status).toBe(200);
    // 7 erros e um acerto: o acerto zera o contador do nome
    for (let i = 0; i < 7; i++) expect((await send("/auth/login", { username: "dona", password: "errada!!" })).status).toBe(401);
    expect((await send("/auth/login", { username: "dona", password: "12345678" })).status).toBe(200);
    // 8 erros seguidos (de IPs diferentes) travam o nome, inclusive com a senha certa e outra grafia
    for (let i = 0; i < 8; i++) expect((await send("/auth/login", { username: "dona", password: "errada!!" }, `198.51.100.${i}`)).status).toBe(401);
    const locked = await send("/auth/login", { username: "DONA", password: "12345678" }, "198.51.100.99");
    expect(locked.status).toBe(429);
    expect(Number(locked.retry)).toBeGreaterThan(0);
    expect(locked.body.error).toMatch(/muitas tentativas/);
    // o IP 203.0.113.7 já fez 9 tentativas; mais 11 em nomes que não existem e ele trava
    for (let i = 0; i < 11; i++) expect((await send("/auth/login", { username: `ninguem${i}`, password: "x" })).status).toBe(401);
    expect((await send("/auth/login", { username: "outro", password: "x" })).status).toBe(429);
    expect((await send("/auth/register", { inviteCode: "x", username: "novo", password: "12345678" })).status).toBe(429);
    // outro IP segue livre
    expect((await send("/auth/login", { username: "outro", password: "x" }, "192.0.2.1")).status).toBe(401);
    await lim.close();
    await db.close();
  });
});

describe("quem está de fato na chamada", () => {
  const removed: string[] = [];
  let present = new Set<string>();
  const fakeRooms = {
    removeParticipant: async (room: string, identity: string) => void removed.push(`${room}:${identity}`),
    getParticipant: async (room: string, identity: string) => {
      if (!present.has(`${room}:${identity}`)) throw new Error("not found");
      return {} as any;
    },
  };
  let h: DbHandle;
  let srv: Awaited<ReturnType<typeof buildApp>>;
  let url = "";
  let dono = "";
  let donoId = "";
  let fora = "";
  let foraId = "";
  let sala = "";
  const sign = async (body: string) => {
    const { createHash } = await import("node:crypto");
    const { AccessToken } = await import("livekit-server-sdk");
    const at = new AccessToken(LK.apiKey, LK.apiSecret);
    at.sha256 = createHash("sha256").update(body).digest("base64");
    return at.toJwt();
  };
  const hook = async (event: string, identity: string, room = voiceRoomName(sala), auth?: string) => {
    const body = JSON.stringify({ event, room: { name: room }, participant: { identity }, id: `${event}-${identity}-${Math.random()}`, createdAt: Math.floor(Date.now() / 1000) });
    const res = await fetch(url + "/livekit/webhook", { method: "POST", headers: { "content-type": "application/webhook+json", authorization: auth ?? (await sign(body)) }, body });
    return res.status;
  };
  const wsOpen = (token: string, opts: object = {}) =>
    new Promise<{ ws: WebSocket; events: any[] }>((resolve, reject) => {
      const ws = new WebSocket(url.replace("http", "ws") + `/ws?token=${token}`, opts);
      const events: any[] = [];
      ws.on("message", (raw) => events.push(JSON.parse(raw.toString())));
      ws.on("open", () => resolve({ ws, events }));
      ws.on("error", reject);
    });
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const lastStates = (events: any[]) => events.filter((e) => e.t === "voiceStates").at(-1)?.states ?? [];

  beforeAll(async () => {
    h = await createDb();
    srv = await buildApp({ db: h.db, bootstrapInvite: "boot3", livekit: LK, heartbeatMs: 100, voiceGraceMs: 150, roomService: fakeRooms });
    url = await srv.listen({ port: 0, host: "127.0.0.1" });
    const reg = async (inviteCode: string, username: string, token?: string) => {
      const code = inviteCode || (await (await fetch(url + "/invites", { method: "POST", headers: { authorization: `Bearer ${token}` } })).json()).code;
      return (await (await fetch(url + "/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ inviteCode: code, username, password: "12345678" }) })).json()) as any;
    };
    const d = await reg("boot3", "voz-dono");
    dono = d.token;
    donoId = d.user.id;
    const f = await reg("", "voz-fora", dono);
    fora = f.token;
    foraId = f.user.id;
    const server = (await (await fetch(url + "/servers", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${dono}` }, body: JSON.stringify({ name: "Voz" }) })).json()) as any;
    const chans = (await (await fetch(url + `/servers/${server.id}/channels`, { headers: { authorization: `Bearer ${dono}` } })).json()) as any[];
    sala = chans.find((c) => c.kind === "voice").id;
  });
  afterAll(async () => {
    await srv.close();
    await h.close();
  });

  it("token de voz vale 10 minutos", async () => {
    const r = (await (await fetch(url + `/voice/${sala}/token`, { method: "POST", headers: { authorization: `Bearer ${dono}` } })).json()) as any;
    const claims = await new TokenVerifier(LK.apiKey, LK.apiSecret).verify(r.token);
    expect(claims.exp! - claims.nbf!).toBeLessThanOrEqual(600);
  });

  it("conexão que não responde ao ping cai e sai da chamada", async () => {
    const watcher = await wsOpen(dono);
    const dead = await wsOpen(dono, { autoPong: false });
    dead.ws.send(JSON.stringify({ t: "voice", channelId: sala, muted: false, deafened: false }));
    await wait(80);
    expect(lastStates(watcher.events).map((s: any) => s.userId)).toEqual([donoId]);
    const closed = new Promise((r) => dead.ws.on("close", r));
    await wait(400);
    await closed;
    expect(lastStates(watcher.events)).toEqual([]);
    // quem responde ao ping continua conectado
    expect(watcher.ws.readyState).toBe(WebSocket.OPEN);
    watcher.ws.close();
  });

  it("webhook: assinatura inválida é recusada", async () => {
    expect(await hook("participant_joined", foraId, voiceRoomName(sala), "Bearer falso")).toBe(401);
  });

  it("webhook: quem entra sem permissão sai na hora; quem entra e não avisa o gateway sai depois", async () => {
    removed.length = 0;
    expect(await hook("participant_joined", foraId)).toBe(200);
    expect(removed).toEqual([`${voiceRoomName(sala)}:${foraId}`]);
    removed.length = 0;
    present = new Set([`${voiceRoomName(sala)}:${donoId}`]);
    expect(await hook("participant_joined", donoId)).toBe(200);
    await wait(300);
    expect(removed).toEqual([`${voiceRoomName(sala)}:${donoId}`]);
    // avisando o gateway, fica
    removed.length = 0;
    const c = await wsOpen(dono);
    c.ws.send(JSON.stringify({ t: "voice", channelId: sala, muted: false, deafened: false }));
    await wait(50);
    expect(await hook("participant_joined", donoId)).toBe(200);
    await wait(300);
    expect(removed).toEqual([]);
    c.ws.close();
  });

  it("webhook: participant_left tira da lista, a não ser que a pessoa ainda esteja na sala", async () => {
    const watcher = await wsOpen(dono);
    const c = await wsOpen(dono);
    c.ws.send(JSON.stringify({ t: "voice", channelId: sala, muted: false, deafened: false }));
    await wait(50);
    present = new Set([`${voiceRoomName(sala)}:${donoId}`]);
    expect(await hook("participant_left", donoId)).toBe(200);
    await wait(50);
    expect(lastStates(watcher.events).map((s: any) => s.userId)).toEqual([donoId]);
    present = new Set();
    expect(await hook("participant_left", donoId)).toBe(200);
    await wait(50);
    expect(lastStates(watcher.events)).toEqual([]);
    c.ws.close();
    watcher.ws.close();
  });
});

describe("logs e saúde", () => {
  it("/health responde 503 quando o banco não responde", async () => {
    const h = await createDb();
    const a = await buildApp({ db: h.db });
    expect((await a.inject({ url: "/health" })).statusCode).toBe(200);
    await h.close();
    const r = await a.inject({ url: "/health" });
    expect(r.statusCode).toBe(503);
    expect(r.json()).toMatchObject({ ok: false });
    await a.close();
  });

  it("os logs não guardam o token (nem no cabeçalho nem na URL do WebSocket)", async () => {
    const { serverLogger, hideToken } = await import("./app.js");
    expect(hideToken("/ws?token=abc.def&x=1")).toBe("/ws?token=***&x=1");
    const lines: string[] = [];
    const h = await createDb();
    const a = await buildApp({ db: h.db, bootstrapInvite: "boot-log", logger: serverLogger("info", { write: (l) => void lines.push(l) }) });
    const reg = await a.inject({ method: "POST", url: "/auth/register", payload: { inviteCode: "boot-log", username: "logado", password: "12345678" } });
    const token = reg.json().token as string;
    await a.inject({ url: "/me", headers: { authorization: `Bearer ${token}` } });
    await a.inject({ url: `/ws?token=${token}` });
    await a.close();
    await h.close();
    const all = lines.join("");
    expect(all).toContain('"url":"/me"');
    expect(all).toContain("token=***");
    expect(all).not.toContain(token);
  });
});

describe("conexão do WebSocket", () => {
  it("token na primeira mensagem; o que chega durante a preparação não se perde; token errado fecha com 4401", async () => {
    const h = await createDb();
    const a = await buildApp({ db: h.db, bootstrapInvite: "boot-ws" });
    const url = await a.listen({ port: 0, host: "127.0.0.1" });
    const json = async (path: string, body: unknown, token?: string) =>
      (await (await fetch(url + path, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })).json()) as any;
    const admin = (await json("/auth/register", { inviteCode: "boot-ws", username: "fila", password: "12345678" })).token;
    const server = await json("/servers", { name: "Fila" }, admin);
    const chans = (await (await fetch(url + `/servers/${server.id}/channels`, { headers: { authorization: `Bearer ${admin}` } })).json()) as any[];
    const sala = chans.find((c) => c.kind === "voice").id;
    const open = async () => {
      const ws = new WebSocket(url.replace("http", "ws") + "/ws");
      const events: any[] = [];
      ws.on("message", (raw) => events.push(JSON.parse(raw.toString())));
      await new Promise((r) => ws.on("open", r));
      return { ws, events };
    };
    const watcher = await open();
    watcher.ws.send(JSON.stringify({ t: "auth", token: admin }));
    const c = await open();
    // auth e o estado de voz juntos, na hora (antes de o servidor terminar de preparar a conexão)
    c.ws.send(JSON.stringify({ t: "auth", token: admin }));
    c.ws.send(JSON.stringify({ t: "voice", channelId: sala, muted: true, deafened: false }));
    await settle();
    expect(c.events.some((e) => e.t === "presence")).toBe(true);
    const states = watcher.events.filter((e) => e.t === "voiceStates").at(-1)?.states ?? [];
    expect(states.find((s: any) => s.channelId === sala)).toMatchObject({ muted: true });
    c.ws.close();
    watcher.ws.close();
    // token errado fecha com 4401
    const bad = await open();
    const closed = new Promise<number>((r) => bad.ws.on("close", (code) => r(code)));
    bad.ws.send(JSON.stringify({ t: "auth", token: "falso" }));
    expect(await closed).toBe(4401);
    await a.close();
    await h.close();
  });
});

describe("nomes de usuário", () => {
  it("não diferenciam maiúsculas no cadastro nem no login", async () => {
    const h = await createDb();
    const a = await buildApp({ db: h.db, bootstrapInvite: "boot-nome" });
    const reg = (body: Record<string, string>) => a.inject({ method: "POST", url: "/auth/register", payload: body });
    expect((await reg({ inviteCode: "boot-nome", username: "Thiago", password: "12345678" })).statusCode).toBe(200);
    const admin = (await a.inject({ method: "POST", url: "/auth/login", payload: { username: "thiago", password: "12345678" } })).json();
    expect(admin.user.username).toBe("Thiago");
    const inv = (await a.inject({ method: "POST", url: "/invites", headers: { authorization: `Bearer ${admin.token}` } })).json();
    expect((await reg({ inviteCode: inv.code, username: "THIAGO", password: "12345678" })).statusCode).toBe(409);
    // o convite não foi gasto com o cadastro recusado
    expect((await reg({ inviteCode: inv.code, username: "outra", password: "12345678" })).statusCode).toBe(200);
    await a.close();
    await h.close();
  });
});

describe("sessões, senha e contas desativadas (#89)", () => {
  it("migração mantém sessões antigas funcionando com UUID aleatório e validade de 30 dias", async () => {
    const { sessions, eq, sql } = await import("@turtle/db");
    const { hashToken } = await import("./auth.js");
    const h = await createDb();
    const a = await buildApp({ db: h.db, bootstrapInvite: "boot-old" });
    const reg = (await a.inject({ method: "POST", url: "/auth/register", payload: { inviteCode: "boot-old", username: "antigo", password: "12345678" } })).json();
    const oldToken = "token-de-antes-da-migracao";
    const oldHash = hashToken(oldToken);
    // Insere só (token_hash, user_id), como o servidor antigo fazia antes do #89.
    await h.db.execute(sql`INSERT INTO sessions (token_hash, user_id) VALUES (${oldHash}, ${reg.user.id})`);
    const row = (await h.db.select().from(sessions).where(eq(sessions.tokenHash, oldHash)))[0]!;
    expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(oldHash.startsWith(row.id.slice(0, 8))).toBe(false);
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    const me = await a.inject({ url: "/me", headers: { authorization: `Bearer ${oldToken}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json().username).toBe("antigo");
    await a.close();
    await h.close();
  });

  it("validade deslizante renova após 1 h e sessão vencida responde 401 e fecha o WebSocket com 4401", async () => {
    const { sessions, eq } = await import("@turtle/db");
    const { hashToken } = await import("./auth.js");
    const h = await createDb();
    const a = await buildApp({ db: h.db, bootstrapInvite: "boot-exp" });
    const url = await a.listen({ port: 0, host: "127.0.0.1" });
    const reg = (await a.inject({ method: "POST", url: "/auth/register", payload: { inviteCode: "boot-exp", username: "expira", password: "12345678" } })).json();
    const th = hashToken(reg.token);

    // Há 2 horas sem gravar: o próximo pedido atualiza last_used_at e empurra expires_at para +30 dias.
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000);
    const soon = new Date(Date.now() + 3_600_000);
    await h.db.update(sessions).set({ lastUsedAt: twoHoursAgo, expiresAt: soon }).where(eq(sessions.tokenHash, th));
    expect((await a.inject({ url: "/me", headers: { authorization: `Bearer ${reg.token}` } })).statusCode).toBe(200);
    const touched = (await h.db.select().from(sessions).where(eq(sessions.tokenHash, th)))[0]!;
    expect(touched.lastUsedAt.getTime()).toBeGreaterThan(twoHoursAgo.getTime());
    expect(touched.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);

    // Sessão vencida: 401 na API, 4401 no WebSocket e linha apagada do banco.
    await h.db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.tokenHash, th));
    const wsCode = await new Promise<number>((resolve) => {
      const ws = new WebSocket(url.replace("http", "ws") + "/ws");
      ws.on("open", () => ws.send(JSON.stringify({ t: "auth", token: reg.token })));
      ws.on("close", (code) => resolve(code));
    });
    expect(wsCode).toBe(4401);
    expect((await a.inject({ url: "/me", headers: { authorization: `Bearer ${reg.token}` } })).statusCode).toBe(401);
    expect(await h.db.select().from(sessions).where(eq(sessions.tokenHash, th))).toEqual([]);
    await a.close();
    await h.close();
  });

  it("lista sessões, encerra outra sessão, faz logout real e troca a senha derrubando as outras (com limitador)", async () => {
    const h = await createDb();
    const a = await buildApp({ db: h.db, bootstrapInvite: "boot-sess", heartbeatMs: 120, authLimit: { perIp: 1000, perName: 4 } });
    const url = await a.listen({ port: 0, host: "127.0.0.1" });
    const req = async (method: string, path: string, body?: unknown, token?: string, ua = "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0") => {
      const res = await fetch(url + path, {
        method,
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          "user-agent": ua,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: (await res.json()) as any };
    };
    const openWs = async (token: string) => {
      const ws = new WebSocket(url.replace("http", "ws") + "/ws");
      const closed = new Promise<number>((r) => ws.on("close", (c) => r(c)));
      const ready = new Promise<void>((r) => ws.on("message", (raw) => {
        if (JSON.parse(raw.toString()).t === "presence") r();
      }));
      ws.on("open", () => ws.send(JSON.stringify({ t: "auth", token })));
      await ready;
      return { ws, closed };
    };

    const s1 = (await req("POST", "/auth/register", { inviteCode: "boot-sess", username: "bia", password: "12345678" }, undefined, "Electron/37 (Windows)")).body.token as string;
    const s2 = (await req("POST", "/auth/login", { username: "bia", password: "12345678" }, undefined, "okhttp/4.12.0")).body.token as string;
    const s3 = (await req("POST", "/auth/login", { username: "bia", password: "12345678" }, undefined, "Mozilla/5.0 Firefox/132.0")).body.token as string;

    const list = (await req("GET", "/me/sessions", undefined, s1)).body as any[];
    expect(list).toHaveLength(3);
    expect(list.filter((x) => x.current)).toHaveLength(1);
    const s2Info = list.find((x) => x.userAgent === "okhttp/4.12.0")!;
    expect(s2Info.id).toMatch(/^[0-9a-f-]{36}$/i);

    // Encerrar s2 fecha o WebSocket de s2 com 4401, enquanto s1 segue viva (respondendo ao heartbeat e enviando mensagens).
    const ws1 = await openWs(s1);
    const ws2 = await openWs(s2);
    expect((await req("DELETE", `/me/sessions/${s2Info.id}`, undefined, s1)).status).toBe(200);
    expect(await ws2.closed).toBe(4401);
    expect((await req("GET", "/me", undefined, s2)).status).toBe(401);
    expect(ws1.ws.readyState).toBe(WebSocket.OPEN);

    // Troca de senha: 4 erros travam pelo limitador; antes disso, acertar troca a senha, mantém s1 e derruba s3.
    expect((await req("POST", "/me/password", { currentPassword: "errada", newPassword: "nova-senha-forte" }, s1)).status).toBe(401);
    const ws3 = await openWs(s3);
    expect((await req("POST", "/me/password", { currentPassword: "12345678", newPassword: "nova-senha-forte" }, s1)).status).toBe(200);
    expect(await ws3.closed).toBe(4401);
    expect((await req("GET", "/me", undefined, s3)).status).toBe(401);
    expect((await req("GET", "/me", undefined, s1)).status).toBe(200);
    expect(ws1.ws.readyState).toBe(WebSocket.OPEN);
    expect((await req("POST", "/auth/login", { username: "bia", password: "12345678" })).status).toBe(401);
    expect((await req("POST", "/auth/login", { username: "bia", password: "nova-senha-forte" })).status).toBe(200);

    // Limitador de tentativas vale também em POST /me/password (4 erros seguidos -> 429).
    for (let i = 0; i < 4; i++) {
      expect((await req("POST", "/me/password", { currentPassword: "errada", newPassword: "outra-senha-123" }, s1)).status).toBe(401);
    }
    expect((await req("POST", "/me/password", { currentPassword: "nova-senha-forte", newPassword: "outra-senha-123" }, s1)).status).toBe(429);

    // POST /auth/logout apaga a sessão atual e fecha o WebSocket com 4401.
    expect((await req("POST", "/auth/logout", {}, s1)).status).toBe(200);
    expect(await ws1.closed).toBe(4401);
    expect((await req("GET", "/me", undefined, s1)).status).toBe(401);

    await a.close();
    await h.close();
  });

  it("admin desativa e reativa conta (derrubando sessões e chamadas), mas não pode desativar a si mesmo nem o dono do app", async () => {
    const { users, eq } = await import("@turtle/db");
    const removed: string[] = [];
    const fakeRooms = {
      removeParticipant: async (room: string, identity: string) => void removed.push(`${room}:${identity}`),
      getParticipant: async () => ({}) as any,
    };
    const h = await createDb();
    const a = await buildApp({ db: h.db, bootstrapInvite: "boot-dis", livekit: LK, roomService: fakeRooms });
    const url = await a.listen({ port: 0, host: "127.0.0.1" });
    const req = async (method: string, path: string, body?: unknown, token?: string) => {
      const res = await fetch(url + path, {
        method,
        headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: (await res.json()) as any };
    };

    const owner = (await req("POST", "/auth/register", { inviteCode: "boot-dis", username: "dono", password: "12345678" })).body;
    const inv1 = (await req("POST", "/invites", {}, owner.token)).body.code;
    const admin2 = (await req("POST", "/auth/register", { inviteCode: inv1, username: "admin2", password: "12345678" })).body;
    await h.db.update(users).set({ isAdmin: true }).where(eq(users.id, admin2.user.id));
    const inv2 = (await req("POST", "/invites", {}, owner.token)).body.code;
    const membro = (await req("POST", "/auth/register", { inviteCode: inv2, username: "membro", password: "12345678" })).body;

    // Caso 1: admin não pode desativar a si mesmo.
    expect((await req("PATCH", `/admin/users/${owner.user.id}`, { disabled: true }, owner.token)).status).toBe(403);
    // Caso 2: outro admin também não pode desativar o dono do app (isAdmin = true).
    expect((await req("PATCH", `/admin/users/${owner.user.id}`, { disabled: true }, admin2.token)).status).toBe(403);

    // Coloca o membro num servidor e numa chamada de voz, com WebSocket aberto.
    const srv = (await req("POST", "/servers", { name: "Casa" }, owner.token)).body;
    const sInv = (await req("POST", `/servers/${srv.id}/invites`, {}, owner.token)).body.code;
    await req("POST", `/invites/${sInv}/join`, {}, membro.token);
    const chans = (await req("GET", `/servers/${srv.id}/channels`, undefined, owner.token)).body as any[];
    const sala = chans.find((c) => c.kind === "voice").id;

    const ws = new WebSocket(url.replace("http", "ws") + "/ws");
    const closed = new Promise<number>((r) => ws.on("close", (c) => r(c)));
    const inCall = new Promise<void>((r) => ws.on("message", (raw) => {
      const e = JSON.parse(raw.toString());
      if (e.t === "voiceStates" && e.states.some((s: any) => s.userId === membro.user.id)) r();
    }));
    ws.on("open", () => {
      ws.send(JSON.stringify({ t: "auth", token: membro.token }));
      ws.send(JSON.stringify({ t: "voice", channelId: sala, muted: false, deafened: false }));
    });
    await inCall;

    // Desativar conta apaga sessões, fecha WS com 4401, tira da chamada no LiveKit e bloqueia login.
    expect((await req("PATCH", `/admin/users/${membro.user.id}`, { disabled: true }, owner.token)).status).toBe(200);
    expect(await closed).toBe(4401);
    expect(removed).toContain(`${voiceRoomName(sala)}:${membro.user.id}`);
    expect((await req("GET", "/me", undefined, membro.token)).status).toBe(401);
    const blockedLogin = await req("POST", "/auth/login", { username: "membro", password: "12345678" });
    expect(blockedLogin.status).toBe(403);
    expect(blockedLogin.body.error).toMatch(/desativada/);
    expect((await req("GET", "/admin/users", undefined, owner.token)).body.find((u: any) => u.id === membro.user.id).disabled).toBe(true);

    // Reativar permite entrar de novo.
    expect((await req("PATCH", `/admin/users/${membro.user.id}`, { disabled: false }, owner.token)).status).toBe(200);
    expect((await req("POST", "/auth/login", { username: "membro", password: "12345678" })).status).toBe(200);

    await a.close();
    await h.close();
  });
});
