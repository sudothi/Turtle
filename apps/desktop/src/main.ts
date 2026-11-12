import { join } from "node:path";
import { app, BrowserWindow, desktopCapturer, dialog, globalShortcut, ipcMain, Menu, session, shell, type WebContents } from "electron";
import { appIcon } from "./paths.js";
import { Splash } from "./splash.js";
import { createTray } from "./tray.js";
import { setUpdateServer, updateOnLaunch, watchUpdates } from "./updater.js";
import { parseLink, saveServer, savedServer } from "./server-config.js";
import { watchGames } from "./games.js";
import { sharedLcu } from "./lcu/client.js";
import { createAutomations } from "./lcu/automations.js";
import { REVEAL_HOSTS } from "./lcu/logic.js";
import { rememberPicked, shareAudioSupported, startShareAudio, stopShareAudio } from "./screen-audio.js";

/** O instalado abre o servidor guardado (link de convite) ou o padrão; no dev (`pnpm desktop`), o Vite local. */
let clientUrl = process.env.TURTLE_CLIENT_URL ?? (app.isPackaged ? savedServer() : "http://localhost:5173");
let clientOrigin = new URL(clientUrl).origin;
const LINK_SCHEME = "turtle";
let win: BrowserWindow | undefined;
/** Fechar a janela só esconde (fica na bandeja); sair de verdade é pelo menu da bandeja. */
let quitting = false;
const keepInTray = app.isPackaged;

/** Pedido de captura em andamento: o app web mostra o seletor e responde com o id escolhido. */
let pending: ((id: string | null) => void) | undefined;
/** O app web vai pedir o áudio por processo (screen-audio.ts) depois de escolher a fonte. */
let wantShareAudio = false;

const fromApp = (sender: WebContents) => win !== undefined && sender === win.webContents;

function installCapture() {
  // Seletor próprio (telas e janelas com miniatura) no lugar do diálogo do sistema.
  session.defaultSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      if (!win || !request.frame || new URL(request.frame.url).origin !== clientOrigin) return callback({});
      const sources = await desktopCapturer
        .getSources({ types: ["screen", "window"], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true })
        .catch(() => []);
      if (!sources.length) return callback({}); // sem permissão do sistema ou nada para capturar
      pending?.(null);
      const id = await new Promise<string | null>((resolve) => {
        pending = resolve;
        win?.webContents.send("screen:pick", {
          audio: (request.audioRequested && process.platform === "win32") || wantShareAudio,
          sources: sources.map((s) => ({
            id: s.id,
            name: s.name,
            kind: s.id.startsWith("screen:") ? "screen" : "window",
            thumbnail: s.thumbnail.toDataURL(),
            icon: s.appIcon?.toDataURL(),
          })),
        });
      });
      pending = undefined;
      const video = sources.find((s) => s.id === id);
      rememberPicked(video?.id);
      if (!video) return callback({}); // cancelou: o navegador recebe um erro de permissão
      // Windows, versões antigas do site: "loopback" captura tudo que sai nos alto-falantes (inclusive a
      // chamada). As novas pedem o vídeo sem áudio e o áudio por processo, em "screen:audio-start".
      callback({ video, audio: request.audioRequested && process.platform === "win32" ? "loopback" : undefined });
    },
    { useSystemPicker: false },
  );

  ipcMain.on("screen:picked", (event, id: unknown) => {
    if (!fromApp(event.sender)) return;
    pending?.(typeof id === "string" ? id : null);
  });

  // Áudio da transmissão separado do Turtle: tela inteira = PC todo menos o Turtle; janela = só aquele programa.
  ipcMain.handle("screen:audio-supported", (event) => fromApp(event.sender) && shareAudioSupported());
  ipcMain.handle("screen:audio-want", (event, on: unknown) => {
    if (fromApp(event.sender)) wantShareAudio = on === true && shareAudioSupported();
    return wantShareAudio;
  });
  ipcMain.handle("screen:audio-start", (event) => {
    if (!fromApp(event.sender) || !win) return { ok: false, reason: "unsupported" };
    return startShareAudio(win.webContents);
  });
  ipcMain.on("screen:audio-stop", (event) => fromApp(event.sender) && stopShareAudio());
}

function installPermissions() {
  // Só o nosso app pode usar microfone, câmera, captura de tela e escrever na área de transferência
  // ("clipboard-sanitized-write" é o navigator.clipboard.writeText dos botões Copiar).
  const allowed = new Set(["media", "display-capture", "fullscreen", "clipboard-sanitized-write"]);
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(allowed.has(permission) && new URL(details.requestingUrl).origin === clientOrigin && fromApp(wc));
  });
}

function openInternal(url: "chrome://webrtc-internals" | "chrome://gpu", title: string) {
  const w = new BrowserWindow({ width: 1100, height: 800, title });
  void w.loadURL(url);
}
const openWebrtcInternals = () => openInternal("chrome://webrtc-internals", "WebRTC internals");

function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow(splash?: Splash) {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 560,
    show: !splash,
    backgroundColor: "#000000",
    title: "Turtle",
    icon: appIcon,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Minimizada ou em segundo plano a janela continua capturando/enviando (testar o 0 fps depois de alt-tab, #97).
      backgroundThrottling: false,
    },
  });
  win.setMenuBarVisibility(false);
  // O Electron não tem menu de clique direito: sem isto não dá para copiar/colar texto com o mouse.
  win.webContents.on("context-menu", (_e, params) => {
    const { editFlags, isEditable, selectionText } = params;
    if (!isEditable && !selectionText.trim()) return;
    const items: Electron.MenuItemConstructorOptions[] = isEditable
      ? [
          { role: "cut", label: "Recortar", enabled: editFlags.canCut },
          { role: "copy", label: "Copiar", enabled: editFlags.canCopy },
          { role: "paste", label: "Colar", enabled: editFlags.canPaste },
          { type: "separator" },
          { role: "selectAll", label: "Selecionar tudo" },
        ]
      : [{ role: "copy", label: "Copiar" }];
    Menu.buildFromTemplate(items).popup({ window: win ?? undefined });
  });
  win.on("focus", () => win?.flashFrame(false));

  // Links externos abrem no navegador; o app nunca navega para fora de si.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (new URL(url).origin !== clientOrigin) e.preventDefault();
  });
  // Recarregou ou o site caiu: a transmissão acabou, então o áudio dela também.
  win.webContents.on("did-start-navigation", (details) => details.isMainFrame && !details.isSameDocument && stopShareAudio());
  win.webContents.on("render-process-gone", () => stopShareAudio());

  // Ctrl+Shift+D: diagnóstico do WebRTC (codificador, fps, perdas). Ctrl+Shift+G: estado da GPU
  // ("Video Encode: Hardware accelerated"). Ctrl+Shift+I: DevTools.
  win.webContents.on("before-input-event", (e, input) => {
    if (input.type !== "keyDown" || !input.control || !input.shift) return;
    if (input.key.toLowerCase() === "d") {
      e.preventDefault();
      openWebrtcInternals();
    } else if (input.key.toLowerCase() === "g") {
      e.preventDefault();
      openInternal("chrome://gpu", "Estado da GPU");
    } else if (input.key.toLowerCase() === "i") {
      e.preventDefault();
      win?.webContents.toggleDevTools();
    }
  });
  // A splash sai quando o site carrega (ou falha, para mostrar o aviso abaixo).
  if (splash) {
    let revealed = false;
    const reveal = () => {
      if (revealed) return;
      revealed = true;
      void splash.close().then(() => win?.show());
    };
    win.webContents.once("did-finish-load", reveal);
    win.webContents.once("did-fail-load", reveal);
    setTimeout(reveal, 15000); // rede lenta: não prende ninguém na splash
  }

  // Site fora do ar: mostra um aviso e tenta de novo sozinho.
  let retry: NodeJS.Timeout | undefined;
  win.webContents.on("did-fail-load", (_e, code, _desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3 || !url.startsWith(clientOrigin)) return; // -3: navegação cancelada
    const dica = app.isPackaged
      ? "Confira sua internet. Se ela estiver ok, o servidor pode estar em manutenção."
      : "Deixe o <code>pnpm dev</code> rodando em outro terminal.";
    const aviso = `<body style="margin:0;display:grid;place-items:center;height:100vh;background:#000;color:#f5f3ee;font:15px system-ui;text-align:center"><div style="max-width:420px;padding:28px 32px;border:2px solid #f5f3ee;border-radius:10px;background:#111"><h2 style="margin:0 0 10px;font-size:22px">Sem conexão com o Turtle</h2><p style="margin:0;color:#c9c6bf;line-height:1.5">${dica}<br>Tentando de novo a cada 2 segundos…</p></div></body>`;
    void win?.webContents.executeJavaScript(`document.documentElement.innerHTML = ${JSON.stringify(aviso)}`).catch(() => {});
    clearTimeout(retry);
    retry = setTimeout(() => void win?.loadURL(clientUrl), 2000);
  });
  win.on("close", (e) => {
    if (keepInTray && !quitting) {
      e.preventDefault();
      win?.hide();
    }
  });
  win.on("closed", () => {
    clearTimeout(retry);
    pending?.(null);
    stopShareAudio();
    win = undefined;
  });
  void win.loadURL(clientUrl);
}

/**
 * Link turtle://convite?server=...&code=...: troca o servidor e abre o cadastro com o código. Como qualquer
 * página pode disparar o link, a pessoa confirma o endereço antes (evita mandar o login para um site falso).
 */
async function handleLink(raw: string) {
  const link = parseLink(raw);
  if (!link) return;
  const origin = link.server ?? clientOrigin;
  if (link.server && link.server !== clientOrigin) {
    const host = new URL(link.server).host;
    const { response } = await dialog.showMessageBox({
      type: "question",
      buttons: ["Conectar", "Cancelar"],
      defaultId: 1,
      cancelId: 1,
      title: "Trocar de servidor",
      message: `Conectar o Turtle a ${host}?`,
      detail: "Só continue se esse endereço é de quem te convidou. Você vai entrar com a conta desse servidor.",
    });
    if (response !== 0) return;
    saveServer(link.server);
    clientUrl = link.server;
    clientOrigin = origin;
    setUpdateServer(origin);
  }
  const target = link.code ? `${origin}/convite/${encodeURIComponent(link.code)}` : clientUrl;
  showWindow();
  void win?.loadURL(target);
}
const linkIn = (argv: string[]) => argv.find((a) => a.startsWith(`${LINK_SCHEME}://`));

// Uma instância só: abrir de novo traz a janela existente.
if (!app.requestSingleInstanceLock()) app.quit();
else {
  if (process.platform === "win32") app.setAppUserModelId("xyz.ogturtle.turtle");
  if (app.isPackaged) app.setAsDefaultProtocolClient(LINK_SCHEME);
  app.on("second-instance", (_e, argv) => {
    const link = linkIn(argv);
    if (link) void handleLink(link);
    else showWindow();
  });
  app.on("open-url", (e, url) => {
    e.preventDefault();
    void handleLink(url); // macOS
  });
  app.on("before-quit", () => (quitting = true));
  void app.whenReady().then(async () => {
    installPermissions();
    installCapture();
    ipcMain.on("debug:webrtc", (event) => fromApp(event.sender) && openWebrtcInternals());
    // Mensagem nova com a janela sem foco: pisca na barra de tarefas; clicar na notificação traz a janela.
    ipcMain.on("win:attention", (event) => {
      if (fromApp(event.sender) && win && !win.isFocused()) win.flashFrame(true);
    });
    ipcMain.on("win:focus", (event) => fromApp(event.sender) && showWindow());
    // Atalhos globais de mudo e ensurdecer: o site manda as teclas; ao apertar, o processo principal avisa o site.
    ipcMain.on("shortcuts:set", (event, s: unknown) => {
      if (!fromApp(event.sender) || !s || typeof s !== "object") return;
      globalShortcut.unregisterAll();
      const seen = new Set<string>();
      for (const which of ["mute", "deafen"] as const) {
        const key = (s as Record<string, unknown>)[which];
        if (typeof key !== "string" || !key || key.length > 60 || seen.has(key)) continue;
        seen.add(key);
        try {
          globalShortcut.register(key, () => win?.webContents.send("shortcut:fired", which));
        } catch {
          // tecla inválida: ignora
        }
      }
    });
    app.on("will-quit", () => globalShortcut.unregisterAll());
    // Jogo atual: o site liga/desliga (opção de privacidade) e recebe só as mudanças.
    const gamesWatch = watchGames((a) => win?.webContents.send("activity:changed", a));
    ipcMain.on("activity:enable", (event, on: unknown) => {
      if (!fromApp(event.sender)) return;
      gamesWatch.set(on === true);
      gamesWatch.replay();
    });
    // Game Automations (LoL): roda aqui; o site só vê o estado e manda configurações. Só fala com 127.0.0.1.
    const auto = createAutomations({ lcu: sharedLcu, dir: app.getPath("userData"), onStatus: (st) => win?.webContents.send("auto:status", st) });
    void auto.init();
    const tool = async (fn: () => Promise<unknown>) => {
      try { return { ok: true, result: await fn() }; } catch (e) { return { ok: false, error: (e as Error).message || "Falhou." }; }
    };
    ipcMain.handle("auto:get", (event) => (fromApp(event.sender) ? { config: auto.getConfig(), status: auto.getStatus() } : null));
    ipcMain.handle("auto:set", (event, patch: unknown) => (fromApp(event.sender) ? auto.setConfig(patch) : null));
    ipcMain.on("auto:watch", (event, on: unknown) => fromApp(event.sender) && auto.watch(on === true));
    ipcMain.handle("auto:champions", (event) => (fromApp(event.sender) ? auto.champions() : []));
    ipcMain.handle("auto:icon", (event, id: unknown) => (fromApp(event.sender) && typeof id === "number" ? auto.icon(id) : null));
    ipcMain.handle("auto:tool", (event, which: unknown) => {
      if (!fromApp(event.sender)) return { ok: false, error: "Não permitido." };
      if (which === "reveal") return tool(auto.reveal);
      if (which === "dodge") return tool(auto.dodge);
      if (which === "restart") return tool(auto.restartUx);
      return { ok: false, error: "Ferramenta desconhecida." };
    });
    // Só abre os sites de multi-busca do "revelar lobby".
    ipcMain.handle("auto:open", (event, url: unknown) => {
      if (!fromApp(event.sender) || typeof url !== "string") return false;
      try {
        const u = new URL(url);
        if (u.protocol !== "https:" || !REVEAL_HOSTS.includes(u.hostname)) return false;
      } catch { return false; }
      void shell.openExternal(url);
      return true;
    });
    setUpdateServer(clientOrigin);
    const splash = new Splash();
    if (await updateOnLaunch(splash)) return; // fecha para instalar a versão nova
    splash.status("Abrindo…");
    if (keepInTray) {
      const refreshTray = createTray(showWindow, () => app.quit());
      watchUpdates(refreshTray);
    }
    createWindow(splash);
    const first = linkIn(process.argv); // aberto pelo link com o app fechado (Windows/Linux)
    if (first) void handleLink(first);
  });
  app.on("window-all-closed", () => {
    if (!keepInTray) app.quit();
  });
}
