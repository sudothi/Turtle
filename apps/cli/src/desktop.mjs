// Instalador do desktop: acha a última versão publicada nas Releases do GitHub (ou numa pasta/URL dada),
// baixa os três arquivos e empacota num tar.gz para mandar à VPS.
import { createReadStream, existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawn } from "node:child_process";
import { REPO_API } from "./config.mjs";

/** @typedef {{ name: string, url: string }} Asset */

/** Última release do GitHub que tem o instalador do Windows (qualquer tag, a mais recente). */
export async function findLatestRelease(fetchFn = fetch) {
  const r = await fetchFn(`${REPO_API}/releases?per_page=20`, { headers: { accept: "application/vnd.github+json", "user-agent": "turtle-setup" } });
  if (!r.ok) throw new Error(`GitHub respondeu ${r.status} ao listar as releases.`);
  const list = /** @type {{ tag_name: string, assets: { name: string, browser_download_url: string }[] }[]} */ (await r.json());
  for (const rel of list) {
    const assets = rel.assets.map((a) => ({ name: a.name, url: a.browser_download_url }));
    const picked = pickInstallerAssets(assets);
    if (picked) return { tag: rel.tag_name, ...picked };
  }
  return null;
}

/** Dentre os anexos, o trio exe + blockmap + latest.yml (ou null). */
export function pickInstallerAssets(/** @type {Asset[]} */ assets) {
  const exe = assets.find((a) => /^Turtle-Setup-[\w.-]+\.exe$/.test(a.name));
  const map = exe && assets.find((a) => a.name === `${exe.name}.blockmap`);
  const yml = assets.find((a) => a.name === "latest.yml");
  return exe && map && yml ? { exe, map, yml } : null;
}

/** Instalador numa pasta local (saída do electron-builder ou artefato baixado do Actions). */
export function localInstallerAssets(/** @type {string} */ dir) {
  if (!existsSync(dir)) return null;
  const assets = readdirSync(dir).map((name) => ({ name, url: join(dir, name) }));
  return pickInstallerAssets(assets);
}

/** Baixa (ou copia) os três arquivos para uma pasta temporária e devolve o caminho. */
export async function stageInstaller(/** @type {{ exe: Asset, map: Asset, yml: Asset }} */ a, onProgress = (/** @type {string} */ _s) => {}, fetchFn = fetch) {
  const dir = mkdtempSync(join(tmpdir(), "turtle-desktop-"));
  for (const f of [a.yml, a.map, a.exe]) {
    onProgress(f.name);
    if (existsSync(f.url)) {
      writeFileSync(join(dir, f.name), await readFileBytes(f.url));
      continue;
    }
    const r = await fetchFn(f.url, { headers: { "user-agent": "turtle-setup" } });
    if (!r.ok) throw new Error(`Falha ao baixar ${f.name} (${r.status}).`);
    writeFileSync(join(dir, f.name), Buffer.from(await r.arrayBuffer()));
  }
  return dir;
}

async function readFileBytes(/** @type {string} */ p) {
  const chunks = [];
  for await (const c of createReadStream(p)) chunks.push(c);
  return Buffer.concat(chunks);
}

/** Stream tar.gz da pasta, com o `tar` do sistema (vem no Windows 10+, macOS e Linux). */
export function tarStream(/** @type {string} */ dir) {
  const child = spawn("tar", ["-czf", "-", "-C", dir, ...readdirSync(dir).map((f) => basename(f))], { stdio: ["ignore", "pipe", "inherit"] });
  return child.stdout;
}
