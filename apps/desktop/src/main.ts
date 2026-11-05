import { join } from "node:path";
import { app, BrowserWindow, desktopCapturer, ipcMain, session, shell, type WebContents } from "electron";
import { appIcon } from "./paths.js";
import { Splash } from "./splash.js";
import { createTray } from "./tray.js";
import { updateOnLaunch, watchUpdates } from "./updater.js";

/** O instalado abre o site publicado; no dev (`pnpm desktop`), o Vite local. */
const PROD_URL = "https://app.ogturtle.xyz";
const clientUrl = process.env.TURTLE_CLIENT_URL ?? (app.isPackaged ? PROD_URL : "http://localhost:5173");
const clientOrigin = new URL(clientUrl).origin;
let win: BrowserWindow | undefined;
/** Fechar a janela só esconde (fica na bandeja); sair de verdade é pelo menu da bandeja. */
let quitting = false;
const keepInTray = app.isPackaged;

/** Pedido de captura em andamento: o app web mostra o seletor e responde com o id escolhido. */
let pending: ((id: string | null) => void) | undefined;

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
          audio: request.audioRequested && process.platform === "win32",
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
      if (!video) return callback({}); // cancelou: o navegador recebe um erro de permissão
      // Windows: "loopback" captura o som que sai pelos alto-falantes.
      callback({ video, audio: request.audioRequested && process.platform === "win32" ? "loopback" : undefined });
    },
    { useSystemPicker: false },
  );

  ipcMain.on("screen:picked", (event, id: unknown) => {
    if (!fromApp(event.sender)) return;
    pending?.(typeof id === "string" ? id : null);
  });
}

function installPermissions() {
  // Só o nosso app pode usar microfone, câmera e captura de tela.
  const allowed = new Set(["media", "display-capture", "fullscreen"]);
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
    },
  });
  win.setMenuBarVisibility(false);
  win.on("focus", () => win?.flashFrame(false));

  // Links externos abrem no navegador; o app nunca navega para fora de si.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (new URL(url).origin !== clientOrigin) e.preventDefault();
  });

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
    win = undefined;
  });
  void win.loadURL(clientUrl);
}

// Uma instância só: abrir de novo traz a janela existente.
if (!app.requestSingleInstanceLock()) app.quit();
else {
  if (process.platform === "win32") app.setAppUserModelId("xyz.ogturtle.turtle");
  app.on("second-instance", showWindow);
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
    const splash = new Splash();
    if (await updateOnLaunch(splash)) return; // fecha para instalar a versão nova
    splash.status("Abrindo…");
    if (keepInTray) {
      const refreshTray = createTray(showWindow, () => app.quit());
      watchUpdates(refreshTray);
    }
    createWindow(splash);
  });
  app.on("window-all-closed", () => {
    if (!keepInTray) app.quit();
  });
}
