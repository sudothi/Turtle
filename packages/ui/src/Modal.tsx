import { useEffect, type ReactNode } from "react";
import { IconButton } from "./Button";
import { Icon } from "./Icon";

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="t-modal-backdrop" onMouseDown={onClose}>
      <div className="t-modal lino lino-lg" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
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
