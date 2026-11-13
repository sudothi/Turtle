// Aparência do terminal: cores, spinner, caixas e perguntas. Sem dependências.
import { createInterface } from "node:readline/promises";

const colorOn = () => !!process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (/** @type {number} */ n) => (/** @type {string} */ s) => (colorOn() ? `\x1b[${n}m${s}\x1b[0m` : s);
export const bold = paint(1), dim = paint(2), red = paint(31), green = paint(32), yellow = paint(33), cyan = paint(36), magenta = paint(35);

export const BANNER_ART = [
  "            ▄▄▄▄▄▄           ▄▄████",
  "         ███████████▄       ▄██████",
  "       ▄████████▀ ▄▄▄▄▄▄▄▄  ███████",
  "            ▀▀   ██████████  ▀███▀",
  "            ▄███ █████████▀▄▄▄",
  "          ▄██████ █████▀ ▄█████",
  "          ███████▄▄▄▄▄  ▄██████",
  "          ▀▀▀▀▀████████ ███████ ▄▄",
  "     ▄▄  ████▄ ████████ ▀██████ ██▄",
  "  ▄█████ █████ ███████▀▄▄▄▀▀▀▀ ▄███",
  " ▄██████ █████ ▀▀███▀▄██████▄  ████",
  " ███▀▀▀  ████▀▄▄███▄ ███████▀ █████",
  " ▀▀       ▀▀▄████████ ████▀    ███▀",
  "            ▀███████▀  ▀       ██▀",
  "               ▄▄▄▄▄          ▀▀",
  "              ▄█████",
  "              █████",
  "             ███▀▀",
];

/** Logo do Turtle em meio-bloco (gerada a partir de packages/ui/assets/turtle-mark.svg). */
const TEXT = ["", "", "", "", "", "Turtle Setup", "o seu Turtle, na sua VPS", "", "instala e cuida do servidor", "por SSH, direto do seu PC"];
export const BANNER = BANNER_ART.join("\n");

/** Degradê do banner: vermelho, laranja e amarelo, na diagonal. */
const FIRE = [[226, 38, 38], [249, 115, 22], [250, 204, 21]];
const FIRE_256 = [196, 202, 208, 214, 220, 226];
function fire(/** @type {string} */ l, /** @type {number} */ row) {
  if (!colorOn()) return l;
  const truecolor = /truecolor|24bit/i.test(process.env.COLORTERM ?? "") || !!process.env.WT_SESSION;
  let out = "";
  for (let x = 0; x < l.length; x++) {
    if (l[x] === " ") {
      out += " ";
      continue;
    }
    const t = Math.min(1, (x / 35 + row / (BANNER_ART.length - 1)) / 2 * 1.15);
    if (truecolor) {
      const k = t * (FIRE.length - 1);
      const a = FIRE[Math.min(Math.floor(k), FIRE.length - 2)];
      const b = FIRE[Math.min(Math.floor(k), FIRE.length - 2) + 1];
      const f = k - Math.min(Math.floor(k), FIRE.length - 2);
      const [r, g, bl] = a.map((v, c) => Math.round(v + (b[c] - v) * f));
      out += `\x1b[38;2;${r};${g};${bl}m${l[x]}`;
    } else out += `\x1b[38;5;${FIRE_256[Math.min(FIRE_256.length - 1, Math.floor(t * FIRE_256.length))]}m${l[x]}`;
  }
  return out + "\x1b[0m";
}

export function banner() {
  console.log("");
  const off = Math.max(0, Math.floor((BANNER_ART.length - TEXT.length) / 2));
  BANNER_ART.forEach((l, i) => {
    const t = TEXT[i - off + 0] ?? "";
    const pad = " ".repeat(35 - l.length + 4);
    const label = i - off === 5 ? bold(t) : dim(t);
    console.log("  " + fire(l, i) + (t ? pad + label : ""));
  });
  console.log("");
}

/** Título de passo: "◆ 3/8 Instalando o Docker" */
export function step(/** @type {number} */ n, /** @type {number} */ total, /** @type {string} */ title) {
  console.log(`\n${magenta("◆")} ${dim(`${n}/${total}`)} ${bold(title)}`);
}
export const ok = (/** @type {string} */ s) => console.log(`  ${green("✓")} ${s}`);
export const warn = (/** @type {string} */ s) => console.log(`  ${yellow("!")} ${s}`);
export const fail = (/** @type {string} */ s) => console.log(`  ${red("✗")} ${s}`);
export const info = (/** @type {string} */ s) => console.log(`  ${dim("·")} ${s}`);
export const line = (/** @type {string} */ s) => console.log(`  ${dim("│")} ${s}`);

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
/** Spinner de uma linha; só anima em TTY. `stop(texto, okOuNao)` fecha. */
export function spinner(/** @type {string} */ text) {
  const tty = !!process.stdout.isTTY;
  let i = 0;
  let current = text;
  const draw = () => tty && process.stdout.write(`\r  ${cyan(FRAMES[i++ % FRAMES.length])} ${current}\x1b[K`);
  const timer = tty ? setInterval(draw, 80) : undefined;
  draw();
  if (!tty) console.log(`  … ${text}`);
  return {
    update(/** @type {string} */ t) {
      current = t;
    },
    stop(/** @type {string} */ t = current, good = true) {
      if (timer) clearInterval(timer);
      if (tty) process.stdout.write("\r\x1b[K");
      (good ? ok : fail)(t);
    },
  };
}

/** Caixa com borda, para o resumo final. */
export function box(/** @type {string[]} */ lines, title = "") {
  const strip = (/** @type {string} */ s) => s.replace(/\x1b\[[0-9;]*m/g, "");
  const w = Math.max(...lines.map((l) => strip(l).length), strip(title).length + 2);
  const top = title ? `╭─ ${bold(title)} ${"─".repeat(Math.max(0, w - strip(title).length - 1))}╮` : `╭${"─".repeat(w + 2)}╮`;
  console.log(`\n${top}`);
  for (const l of lines) console.log(`│ ${l}${" ".repeat(w - strip(l).length)} │`);
  console.log(`╰${"─".repeat(w + 2)}╯`);
}

/** Perguntas no terminal. Em modo não interativo (--yes sem TTY) devolve o padrão. */
export function prompter(interactive = true) {
  const rl = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : undefined;
  /** Ctrl+C / Ctrl+D / janela fechada: sai sem mostrar stack trace. */
  const read = async (/** @type {string} */ q) => {
    try {
      return await /** @type {import("node:readline/promises").Interface} */ (rl).question(q);
    } catch {
      console.log(dim("\n  Cancelado."));
      process.exit(130);
    }
  };
  return {
    async ask(/** @type {string} */ q, def = "") {
      if (!rl) return def;
      const a = (await read(`  ${q}${def ? dim(` [${def}]`) : ""} `)).trim();
      return a || def;
    },
    async confirm(/** @type {string} */ q, def = false) {
      if (!rl) return def;
      const a = (await read(`  ${q} ${dim(def ? "[S/n]" : "[s/N]")} `)).trim().toLowerCase();
      if (!a) return def;
      return a === "s" || a === "sim" || a === "y";
    },
    close() {
      rl?.close();
    },
  };
}
