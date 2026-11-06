/**
 * Formatação básica das mensagens, sem HTML: **negrito**, *itálico*, `código`, ```bloco```, ||spoiler|| e links.
 * Devolve uma árvore que o cliente desenha com elementos próprios (nada é injetado como HTML).
 */
export type RichNode =
  | { type: "text"; text: string }
  | { type: "bold" | "italic" | "spoiler"; children: RichNode[] }
  | { type: "code"; text: string }
  | { type: "codeblock"; text: string }
  | { type: "link"; href: string; text: string };

const TOKEN = /```([\s\S]+?)```|`([^`\n]+)`|\|\|([\s\S]+?)\|\||\*\*([\s\S]+?)\*\*|(?<![\w*])\*([^*\s][^*\n]*?)\*(?![\w*])|(?<![\w])_([^_\s][^_\n]*?)_(?![\w])|(https?:\/\/[^\s<>"']+)/g;
/** Pontuação que costuma vir colada no fim de um link na frase. */
const TRAILING = /[.,;:!?)\]}'"]+$/;

export function parseRichText(input: string, depth = 0): RichNode[] {
  const out: RichNode[] = [];
  let last = 0;
  const push = (text: string) => {
    if (!text) return;
    const prev = out[out.length - 1];
    if (prev?.type === "text") prev.text += text;
    else out.push({ type: "text", text });
  };
  for (const m of input.matchAll(TOKEN)) {
    push(input.slice(last, m.index));
    last = m.index! + m[0].length;
    const [, block, code, spoiler, bold, star, under, url] = m;
    if (block !== undefined) out.push({ type: "codeblock", text: block.replace(/^\n/, "").replace(/\n$/, "") });
    else if (code !== undefined) out.push({ type: "code", text: code });
    else if (url !== undefined) {
      const trail = url.match(TRAILING)?.[0] ?? "";
      const clean = trail ? url.slice(0, -trail.length) : url;
      try {
        const u = new URL(clean);
        if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("protocolo");
        out.push({ type: "link", href: u.href, text: clean });
      } catch {
        push(clean);
      }
      push(trail);
    } else {
      const inner = spoiler ?? bold ?? star ?? under ?? "";
      const type = spoiler !== undefined ? "spoiler" : bold !== undefined ? "bold" : "italic";
      // aninhamento limitado: negrito dentro de spoiler etc., sem recursão infinita
      out.push({ type, children: depth < 3 ? parseRichText(inner, depth + 1) : [{ type: "text", text: inner }] });
    }
  }
  push(input.slice(last));
  return out;
}
