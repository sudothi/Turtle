import { useEffect, useRef, type ReactNode } from "react";
import { IconButton } from "./Button";
import { Icon } from "./Icon";

// Pilha de modais abertos: só o do topo reage ao Esc.
const openModals: symbol[] = [];
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  label,
  wide,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  /** Nome acessível do diálogo, quando difere do título. */
  label?: string;
  wide?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const id = Symbol("modal");
    openModals.push(id);
    const opener = document.activeElement as HTMLElement | null;
    const node = box.current;
    // foca o primeiro campo (ou o primeiro controle que não seja o botão Fechar)
    const items = () => Array.from(node?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    const first = node?.querySelector<HTMLElement>("input,textarea,select") ?? items().find((el) => !el.classList.contains("t-modal-close")) ?? node;
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (openModals[openModals.length - 1] !== id) return;
      if (e.key === "Escape") return onCloseRef.current();
      if (e.key !== "Tab" || !node) return;
      const list = items();
      if (!list.length) return e.preventDefault();
      const a = list[0]!, z = list[list.length - 1]!;
      if (e.shiftKey && (document.activeElement === a || !node.contains(document.activeElement))) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && (document.activeElement === z || !node.contains(document.activeElement))) { e.preventDefault(); a.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      openModals.splice(openModals.indexOf(id), 1);
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  return (
    <div className="t-modal-backdrop" onMouseDown={onClose}>
      <div className={`t-modal lino lino-lg${wide ? " t-modal-wide" : ""}`} ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label ?? title} onMouseDown={(e) => e.stopPropagation()}>
        <IconButton label="Fechar" className="t-modal-close" onClick={onClose}>
          <Icon name="close" />
        </IconButton>
        <header className="t-modal-head">
          <h2 className="t-display">{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </header>
        {children && <div className="t-modal-body">{children}</div>}
        {footer && <footer className="t-modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}
