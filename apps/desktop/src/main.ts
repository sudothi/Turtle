import { app, BrowserWindow } from "electron";
import { fileURLToPath } from "node:url";

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: "#000000",
    title: "Turtle",
    icon: fileURLToPath(new URL("../build/icon.png", import.meta.url)),
  });
  win.loadURL(process.env.TURTLE_CLIENT_URL ?? "http://localhost:5173");
});
app.on("window-all-closed", () => app.quit());
