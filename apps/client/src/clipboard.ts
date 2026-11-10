/**
 * Copia texto para a área de transferência. No app desktop antigo o Electron negava a permissão
 * "clipboard-sanitized-write" e o `navigator.clipboard` falhava calado; aí cai no `execCommand("copy")`,
 * que funciona com o clique do usuário em qualquer versão.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* tenta o jeito antigo */
  }
  return legacyCopy(text);
}

function legacyCopy(text: string) {
  const active = document.activeElement as HTMLElement | null;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none";
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  active?.focus?.();
  return ok;
}
