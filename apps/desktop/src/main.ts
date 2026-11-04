import { app, BrowserWindow, desktopCapturer, ipcMain, session, shell, type WebContents } from "electron";
import { fileURLToPath } from "node:url";

const clientUrl = process.env.TURTLE_CLIENT_URL ?? "http://localhost:5173";
const clientOrigin = new URL(clientUrl).origin;
let win: BrowserWindow | undefined;

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

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: "#000000",
    title: "Turtle",
    icon: fileURLToPath(new URL("../build/icon.png", import.meta.url)),
    webPreferences: {
      preload: fileURLToPath(new URL("./preload.cjs", import.meta.url)),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);

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
  // Site fora do ar (o pnpm dev não está rodando): mostra um aviso e tenta de novo sozinho.
  let retry: NodeJS.Timeout | undefined;
  win.webContents.on("did-fail-load", (_e, code, _desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3 || !url.startsWith(clientOrigin)) return; // -3: navegação cancelada
    const aviso = `<body style="margin:0;display:grid;place-items:center;height:100vh;background:#000;color:#f4f1ea;font:16px system-ui;text-align:center"><div><h2>Turtle não encontrou o site</h2><p>Deixe o <code>pnpm dev</code> rodando em outro terminal.<br>Tentando de novo a cada 2 segundos…</p></div></body>`;
    void win?.webContents.executeJavaScript(`document.documentElement.innerHTML = ${JSON.stringify(aviso)}`).catch(() => {});
    clearTimeout(retry);
    retry = setTimeout(() => void win?.loadURL(clientUrl), 2000);
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
  app.on("second-instance", () => {
    if (win?.isMinimized()) win.restore();
    win?.focus();
  });
  void app.whenReady().then(() => {
    installPermissions();
    installCapture();
    ipcMain.on("debug:webrtc", (event) => fromApp(event.sender) && openWebrtcInternals());
    createWindow();
  });
  app.on("window-all-closed", () => app.quit());
}
