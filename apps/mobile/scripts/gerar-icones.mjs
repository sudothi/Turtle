// Gera os ícones do app Android (launcher, adaptive, notificação e splash) a partir do logo.
// Os PNGs ficam versionados em android/app/src/main/res; só rode de novo se mudar o logo.
//
//   pnpm --filter @turtle/mobile icones
import sharp from "sharp";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const aqui = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const res = aqui("android/app/src/main/res");
const marca = readFileSync(aqui("assets/turtle-mark-paper.svg"));
// Versão toda branca (ícone de notificação: o Android só usa o canal alfa).
const marcaBranca = Buffer.from(marca.toString().replace(/#f5f3ee/gi, "#ffffff"));

const grava = async (caminho, buf) => {
  mkdirSync(dirname(join(res, caminho)), { recursive: true });
  writeFileSync(join(res, caminho), await buf.png().toBuffer());
};
const marcaEm = (svg, tam) => sharp(svg, { density: 600 }).resize(tam, tam, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();

const densidades = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

for (const [d, k] of Object.entries(densidades)) {
  // Ícone antigo (Android < 8): quadrado preto com cantos arredondados e a tartaruga.
  const l = Math.round(48 * k);
  const mark = await marcaEm(marca, Math.round(l * 0.72));
  const base = (forma) => sharp({ create: { width: l, height: l, channels: 4, background: "#000000" } })
    .composite([{ input: mark, gravity: "center" }, { input: Buffer.from(forma), blend: "dest-in" }]);
  await grava(`mipmap-${d}/ic_launcher.png`, base(`<svg width="${l}" height="${l}"><rect width="${l}" height="${l}" rx="${l * 0.2}"/></svg>`));
  await grava(`mipmap-${d}/ic_launcher_round.png`, base(`<svg width="${l}" height="${l}"><circle cx="${l / 2}" cy="${l / 2}" r="${l / 2}"/></svg>`));

  // Adaptive (Android 8+): camada da frente 108 dp; o que importa fica nos 66 dp do centro.
  const f = Math.round(108 * k);
  await grava(`mipmap-${d}/ic_launcher_foreground.png`, sharp({ create: { width: f, height: f, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: await marcaEm(marca, Math.round(f * 0.56)), gravity: "center" }]));

  // Notificação: 24 dp, branco com fundo transparente.
  const n = Math.round(24 * k);
  await grava(`drawable-${d}/ic_stat_turtle.png`, sharp(await marcaEm(marcaBranca, n)));
}

// Splash: tartaruga num quadrado transparente (o fundo preto vem do tema).
await grava("drawable/splash_icon.png", sharp(await marcaEm(marca, 576)));

// Os splashes antigos do Capacitor (imagem inteira por orientação) não servem mais.
for (const o of ["", "-land", "-port"]) for (const d of ["", ...Object.keys(densidades).map((x) => `-${x}`)]) {
  rmSync(join(res, `drawable${o}${d}/splash.png`), { force: true });
}
console.log("ícones gerados em", res);
