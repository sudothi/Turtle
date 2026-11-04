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
  app = await buildApp({ db: handle.db, bootstrapInvite: "boot", livekit: LK, uploadDir: mkdtempSync(join(tmpdir(), "turtle-up-")) });
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
    // o cartão público não expõe o cargo, só a tag da tartaruga
    expect((await get(`/users/${amigo.id}`, adminToken)).body).toMatchObject({ staff: true });
    expect((await get(`/users/${amigo.id}`, adminToken)).body.canInvite).toBeUndefined();
    const tags = (await get(`/servers/${turtleId}/members`, friendToken)).body.map((m: any) => [m.username, m.staff]);
    expect(Object.fromEntries(tags)).toMatchObject({ thiago: true, amigo: true });
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
