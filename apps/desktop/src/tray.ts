import { app, Menu, nativeImage, Tray } from "electron";
import { appIcon } from "./paths.js";
import { checkInBackground, restartToUpdate, updateReady } from "./updater.js";

let tray: Tray | undefined;

/** Ícone na bandeja: o Turtle continua rodando (e na chamada) com a janela fechada. */
export function createTray(show: () => void, quit: () => void) {
  const icon = nativeImage.createFromPath(appIcon);
  tray = new Tray(process.platform === "win32" ? icon : icon.resize({ width: 18, height: 18 }));
  tray.setToolTip("Turtle");
  tray.on("click", show);
  tray.on("double-click", show);
  const refresh = () => {
    const items: Electron.MenuItemConstructorOptions[] = [
      { label: "Abrir o Turtle", click: show },
      { type: "separator" },
      updateReady()
        ? { label: "Reiniciar para atualizar", click: restartToUpdate }
        : { label: "Procurar atualização", enabled: app.isPackaged, click: () => void checkInBackground() },
      { label: `Versão ${app.getVersion()}`, enabled: false },
      { type: "separator" },
      { label: "Sair do Turtle", click: quit },
    ];
    tray?.setContextMenu(Menu.buildFromTemplate(items));
  };
  refresh();
  return refresh;
}
