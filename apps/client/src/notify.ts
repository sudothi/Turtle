import { desktop } from "./desktop";

/** A pessoa está olhando para o app agora (janela visível e com foco). */
export const appFocused = () => !document.hidden && document.hasFocus();

/** Pede permissão de notificação no primeiro clique (o navegador só mostra o pedido depois de um gesto). */
export function askNotificationsOnFirstClick() {
  if (typeof Notification === "undefined" || Notification.permission !== "default") return;
  const ask = () => {
    window.removeEventListener("pointerdown", ask);
    void Notification.requestPermission().catch(() => {});
  };
  window.addEventListener("pointerdown", ask);
}

/** Notificação do sistema (Windows/navegador). Clicar traz o app e abre a conversa. */
export function showNotification(title: string, body: string, icon: string | null, onClick: () => void) {
  desktop()?.attention?.();
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, { body: body.slice(0, 200), icon: icon ?? "/icon-192.png", silent: true });
    n.onclick = () => {
      desktop()?.focus?.();
      window.focus();
      onClick();
      n.close();
    };
  } catch {
    // alguns navegadores só deixam notificar por service worker: fica só o som e a marca de não lida
  }
}
