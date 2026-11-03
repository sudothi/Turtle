import { TURTLE_PATH } from "./logo-path";

interface Props {
  size?: number;
  className?: string;
  /** Texto para leitores de tela. Sem ele o logo é decorativo. */
  title?: string;
}

/** Só a tartaruga, na cor do texto (currentColor). */
export function TurtleMark({ size = 32, className, title }: Props) {
  return (
    <svg viewBox="0 0 512 512" width={size} height={size} className={className} role={title ? "img" : undefined} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <path fill="currentColor" d={TURTLE_PATH} />
    </svg>
  );
}

/** Ícone completo: quadrado arredondado + tartaruga. "black" = quadrado preto, tartaruga branca. */
export function TurtleLogo({ size = 48, className, title, variant = "black" }: Props & { variant?: "black" | "white" }) {
  const [bg, fg] = variant === "black" ? ["#000", "#f5f3ee"] : ["#f5f3ee", "#000"];
  return (
    <svg viewBox="0 0 512 512" width={size} height={size} className={className} role={title ? "img" : undefined} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <rect width="512" height="512" rx="120" fill={bg} />
      <path fill={fg} d={TURTLE_PATH} />
    </svg>
  );
}
