// Gera a arte do instalador (NSIS) e os ícones a partir do logo e das fontes do app.
// Os arquivos gerados ficam versionados em build/ e assets/; só rode de novo se mudar o visual.
//
//   pnpm --filter @turtle/desktop arte
//
// Precisa do Playwright com o Chromium (já vem no ambiente de nuvem; no PC: `npx playwright install chromium`).
import { chromium } from "playwright";
import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const raiz = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const b64 = (p) => readFileSync(raiz(p)).toString("base64");

const mark = `data:image/svg+xml;base64,${b64("assets/turtle-mark-paper.svg")}`;
const fontes = `
  @font-face { font-family: Bricolage; src: url(data:font/woff2;base64,${b64("assets/fonts/bricolage.woff2")}) format("woff2"); font-weight: 200 800; }
  @font-face { font-family: Figtree; src: url(data:font/woff2;base64,${b64("assets/fonts/figtree.woff2")}) format("woff2"); font-weight: 300 900; }`;
// Mesmo filtro de goiva do app (parado: imagem estática).
const filtros = `<svg width="0" height="0" style="position:absolute"><defs>
  <filter id="lino" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="2" seed="4" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="2" xChannelSelector="R" yChannelSelector="G"/></filter>
  <filter id="lino-lg" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="9" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="4" xChannelSelector="R" yChannelSelector="G"/></filter>
  <path id="e" d="M0-10C1-3 3-1 10 0 3 1 1 3 0 10-1 3-3 1-10 0-3-1-1-3 0-10Z" fill="#f5f3ee"/></defs></svg>`;
const pagina = (corpo, css) => `<!doctype html><html><head><meta charset="utf-8"><style>${fontes}
  html,body{margin:0;background:#000;color:#f5f3ee;overflow:hidden}
  .t{font:800 26px/1 Bricolage,sans-serif;letter-spacing:-.4px}
  .s{font:500 11px/1.35 Figtree,sans-serif;color:#c9c6bf}
  .ondas path{fill:none;stroke:#f5f3ee;stroke-width:2.2;stroke-linecap:round;filter:url(#lino)}
  ${css}</style></head><body>${filtros}${corpo}</body></html>`;

const estrelas = (lista) => lista.map(([x, y, s]) => `<use href="#e" transform="translate(${x} ${y}) scale(${s})"/>`).join("");
const ondas = `<path d="M-5 12c18-6 34 2 52-2s26-7 44-1 30 3 46-2"/><path d="M60 26c20-6 38 3 58-1s34-5 52 0"/>
  <path d="M-5 32c22 5 40-5 60-1"/><path d="M-5 48c26-5 44 4 66 0s30-6 52-1 30 5 46 0"/><path d="M-5 62c30 3 60-3 90 0s60 3 90-1"/>`;

/** Barra lateral das telas de boas-vindas e fim (164x314, tamanho fixo do NSIS). */
const lateral = pagina(
  `<svg width="164" height="314" style="position:absolute;inset:0">${estrelas([
    [24, 28, 0.6], [62, 58, 0.35], [140, 22, 0.5], [118, 70, 0.3], [146, 112, 0.4], [16, 128, 0.3], [88, 16, 0.25],
  ])}<g class="ondas" transform="translate(0 252)">${ondas}</g></svg>
  <div style="position:absolute;top:74px;left:0;right:0;display:flex;flex-direction:column;align-items:center;text-align:center">
    <img src="${mark}" width="88" height="88" style="filter:url(#lino-lg)">
    <div class="t" style="margin-top:10px">Turtle</div>
    <div class="s" style="margin-top:6px">texto, voz e tela<br>só pra amigos</div>
  </div>`,
  "",
);

/** Faixa do topo das outras telas (150x57; o NSIS põe à direita, sobre fundo branco). */
const topo = pagina(
  `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:8px">
    <img src="${mark}" width="34" height="34" style="filter:url(#lino)"><span class="t" style="font-size:22px">Turtle</span>
  </div>
  <svg width="150" height="57" style="position:absolute;inset:0">${estrelas([[12, 12, 0.3], [138, 10, 0.35], [130, 46, 0.25], [20, 46, 0.22]])}</svg>`,
  "",
);

/** BMP 24 bits (o NSIS só aceita BMP nessas telas). */
async function salvarBmp(png, destino) {
  const { data, info } = await sharp(png).flatten({ background: "#000" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const linha = Math.ceil((w * 3) / 4) * 4;
  const out = Buffer.alloc(54 + linha * h);
  out.write("BM", 0);
  out.writeUInt32LE(out.length, 2);
  out.writeUInt32LE(54, 10);
  out.writeUInt32LE(40, 14);
  out.writeInt32LE(w, 18);
  out.writeInt32LE(h, 22); // positivo: de baixo para cima
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(24, 28);
  out.writeUInt32LE(linha * h, 34);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const o = 54 + (h - 1 - y) * linha + x * 3;
      out[o] = data[i + 2];
      out[o + 1] = data[i + 1];
      out[o + 2] = data[i];
    }
  writeFileSync(raiz(destino), out);
}

/** .ico com PNGs dentro (Windows Vista+), de 16 a 256 px. */
async function salvarIco(origem, destino) {
  const tamanhos = [16, 20, 24, 32, 40, 48, 64, 128, 256];
  const pngs = await Promise.all(tamanhos.map((t) => sharp(origem).resize(t, t, { kernel: "lanczos3" }).png().toBuffer()));
  const cab = Buffer.alloc(6 + 16 * tamanhos.length);
  cab.writeUInt16LE(1, 2);
  cab.writeUInt16LE(tamanhos.length, 4);
  let pos = cab.length;
  tamanhos.forEach((t, i) => {
    const o = 6 + 16 * i;
    cab[o] = t === 256 ? 0 : t;
    cab[o + 1] = t === 256 ? 0 : t;
    cab.writeUInt16LE(1, o + 4);
    cab.writeUInt16LE(32, o + 6);
    cab.writeUInt32LE(pngs[i].length, o + 8);
    cab.writeUInt32LE(pos, o + 12);
    pos += pngs[i].length;
  });
  writeFileSync(raiz(destino), Buffer.concat([cab, ...pngs]));
}

const browser = await chromium.launch();
async function render(html, width, height) {
  const p = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await p.setContent(html);
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(150);
  const png = await p.screenshot();
  await p.close();
  return png;
}

const sidebar = await render(lateral, 164, 314);
await salvarBmp(sidebar, "build/installerSidebar.bmp");
await salvarBmp(sidebar, "build/uninstallerSidebar.bmp");
await salvarBmp(await render(topo, 150, 57), "build/installerHeader.bmp");
await browser.close();

await salvarIco(raiz("build/icon.png"), "build/icon.ico");
// Ícone da bandeja e da janela, empacotado junto com o app.
await salvarIco(raiz("build/icon.png"), "assets/icon.ico");
await sharp(raiz("build/icon.png")).resize(256, 256).png().toFile(raiz("assets/icon.png"));
console.log("arte gerada em build/ e assets/");
