import { join } from "node:path";

// O main é empacotado num arquivo só (dist/main.cjs); assets/ fica ao lado de dist/.
export const assetsDir = join(__dirname, "..", "assets");
export const asset = (name: string) => join(assetsDir, name);
export const appIcon = asset(process.platform === "win32" ? "icon.ico" : "icon.png");
