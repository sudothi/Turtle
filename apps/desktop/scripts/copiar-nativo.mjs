// Copia o addon de áudio por processo (loopback-capture, Windows x64) para dist/native.
// O main é empacotado pelo esbuild e o instalador não leva node_modules; o .node vai fora do asar (asarUnpack).
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist", "native");
let src;
try {
  const pkg = createRequire(join(root, "package.json")).resolve("loopback-capture/package.json");
  src = join(dirname(pkg), "prebuilds", "win32-x64", "loopback_capture_addon.node");
} catch {
  // dependência opcional: fora do Windows/Linux x64 ela não é instalada
}
if (src && existsSync(src)) {
  mkdirSync(out, { recursive: true });
  copyFileSync(src, join(out, "loopback_capture_addon.node"));
  console.log("addon de áudio copiado para dist/native");
} else {
  console.warn("aviso: loopback-capture não encontrado; o áudio da transmissão usa o loopback antigo do Electron");
}
