import { useEffect, type ReactNode } from "react";
import { IconButton } from "./Button";
import { Icon } from "./Icon";

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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="t-modal-backdrop" onMouseDown={onClose}>
      <div className={`t-modal lino lino-lg${wide ? " t-modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={label ?? title} onMouseDown={(e) => e.stopPropagation()}>
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
