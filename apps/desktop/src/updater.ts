import { app, Notification } from "electron";
import { autoUpdater } from "electron-updater";
import type { Splash } from "./splash.js";

// O endereço das atualizações vem do electron-builder.yml (publish: generic). O instalador grava
// esse endereço no app-update.yml; a cada versão nova basta subir o Setup, o .blockmap e o latest.yml.
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.logger = null;

const enabled = () => app.isPackaged && !process.env.TURTLE_NO_UPDATE;
const CHECK_TIMEOUT_MS = 6000;
const PERIOD_MS = 4 * 60 * 60 * 1000;

let ready = false;
let onReady: (() => void) | undefined;
/** true quando uma versão nova já foi baixada e entra ao reiniciar. */
export const updateReady = () => ready;

const timeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

/**
 * Na abertura: procura versão nova; se houver, baixa mostrando o progresso na splash e reinicia já
 * atualizado (como o Discord). Sem internet ou servidor lento, segue para o app sem travar.
 * Retorna true quando o app vai fechar para instalar.
 */
export async function updateOnLaunch(splash: Splash): Promise<boolean> {
  if (!enabled()) return false;
  splash.status("Procurando atualização…");
  try {
    const result = await timeout(autoUpdater.checkForUpdates(), CHECK_TIMEOUT_MS);
    if (!result?.isUpdateAvailable) return false;
    const version = result.updateInfo.version;
    splash.status(`Baixando a versão ${version}…`, 0);
    const progress = (p: { percent: number }) => splash.status(`Baixando a versão ${version}… ${Math.round(p.percent)}%`, p.percent);
    autoUpdater.on("download-progress", progress);
    try {
      await autoUpdater.downloadUpdate();
    } finally {
      autoUpdater.off("download-progress", progress);
    }
    splash.status("Instalando…", 100);
    // isSilent: sem as telas do instalador; isForceRunAfter: abre o Turtle de novo no fim.
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
    return true;
  } catch {
    return false; // sem rede, sem versão publicada ainda ou download falhou: abre a versão atual
  }
}

/** Com o app aberto: procura de tempos em tempos e baixa em segundo plano. */
export function watchUpdates(changed: () => void) {
  if (!enabled()) return;
  onReady = changed;
  autoUpdater.on("update-downloaded", (info) => {
    if (ready) return;
    ready = true;
    onReady?.();
    if (Notification.isSupported())
      new Notification({
        title: "Atualização do Turtle pronta",
        body: `A versão ${info.version} entra quando você reiniciar o Turtle (pela bandeja).`,
        silent: true,
      }).show();
  });
  const check = () => void checkInBackground();
  setInterval(check, PERIOD_MS).unref();
}

export async function checkInBackground() {
  if (!enabled() || ready) return;
  try {
    const result = await autoUpdater.checkForUpdates();
    if (result?.isUpdateAvailable) await autoUpdater.downloadUpdate();
  } catch {
    /* tenta de novo na próxima rodada */
  }
}

/** Fecha e instala a versão já baixada. */
export function restartToUpdate() {
  if (ready) autoUpdater.quitAndInstall(true, true);
}
