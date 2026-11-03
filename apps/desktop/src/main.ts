import { app, BrowserWindow } from "electron";

app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 1280, height: 800, backgroundColor: "#000000" });
  win.loadURL(process.env.TURTLE_CLIENT_URL ?? "http://localhost:5173");
});
app.on("window-all-closed", () => app.quit());
