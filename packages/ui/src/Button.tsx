import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger";

export function Button({
  variant = "primary",
  size = "md",
  block,
  className = "",
  children,
  ...rest
}: { variant?: Variant; size?: "sm" | "md" | "lg"; block?: boolean; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = ["t-btn", "lino", variant !== "primary" && variant, size !== "md" && size, block && "block", className].filter(Boolean).join(" ");
  return (
    <button type="button" className={cls} {...rest}>
      {children}
    </button>
  );
}

/** Botão só com ícone. Sempre passe `label` (vira title e aria-label). */
export function IconButton({
  label,
  active,
  className = "",
  children,
  ...rest
}: { label: string; active?: boolean; children: ReactNode } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title">) {
  return (
    <button type="button" className={`t-icon-btn lino ${active ? "active" : ""} ${className}`} title={label} aria-label={label} {...rest}>
      {children}
    </button>
  );
}
