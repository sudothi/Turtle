// Fumaça no Windows (CI): o addon de áudio por processo veio no instalador, carrega e liga/desliga;
// o PowerShell que acha o dono de uma janela compila. Uso: node scripts/testar-audio.cjs <pasta win-unpacked>
const { execFileSync } = require("node:child_process");
const { join } = require("node:path");

const dir = process.argv[2] ?? "release/win-unpacked";
const file = join(dir, "resources", "app.asar.unpacked", "dist", "native", "loopback_capture_addon.node");
const mod = { exports: {} };
process.dlopen(mod, file);
console.log("addon carregou:", file);
const cap = new mod.exports.LoopbackCapture();
let bytes = 0;
try {
  // Mesmo modo da tela inteira: tudo menos este processo. Runner sem placa de som pode recusar.
  cap.startSystemAudio((chunk) => (bytes += chunk.length), process.pid);
  setTimeout(() => {
    cap.stop();
    console.log("captura ligou e desligou; bytes recebidos:", bytes);
    pidCheck();
  }, 1500);
} catch (err) {
  console.warn("captura recusada neste runner (sem dispositivo de áudio?):", err.message);
  pidCheck();
}

// Mesmo script de src/screen-audio.ts (windowPid); HWND 0 não tem dono, então volta 0.
function pidCheck() {
  const script =
    "Add-Type -Namespace T -Name W -MemberDefinition '[DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);';" +
    "$p = [uint32]0; [void][T.W]::GetWindowThreadProcessId([IntPtr]0, [ref]$p); $p";
  const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" }).trim();
  if (out !== "0") throw new Error(`PowerShell devolveu "${out}"`);
  console.log("PowerShell de janela → processo ok");
}
