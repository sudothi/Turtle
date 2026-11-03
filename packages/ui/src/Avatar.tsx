/** Variação estável por nome, para diferenciar pessoas sem usar cor. */
export function avatarVariant(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return h % 4;
}

export function Avatar({
  name,
  size = 40,
  speaking,
  status,
  statusRing,
}: {
  name: string;
  size?: number;
  speaking?: boolean;
  /** Bolinha de presença. Omitida = sem bolinha. */
  status?: "online" | "offline";
  /** Cor do fundo atrás da bolinha (para o recorte). */
  statusRing?: string;
}) {
  const initial = [...name.trim()][0]?.toUpperCase() ?? "?";
  const v = avatarVariant(name);
  const avatar = (
    <span className={`t-avatar lino v${v} ${speaking ? "speaking" : ""}`} style={{ ["--size" as string]: `${size}px` }} aria-hidden="true">
      <span>{initial}</span>
    </span>
  );
  if (!status) return avatar;
  return (
    <span className="t-avatar-wrap" style={{ ["--size" as string]: `${size}px`, ["--status-ring" as string]: statusRing }}>
      {avatar}
      <span className={`t-status ${status}`} />
    </span>
  );
}
