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
  src,
}: {
  name: string;
  size?: number;
  speaking?: boolean;
  /** Bolinha de presença. Omitida = sem bolinha. */
  status?: "online" | "busy" | "offline";
  /** Cor do fundo atrás da bolinha (para o recorte). */
  statusRing?: string;
  /** Foto de perfil (URL). Sem ela, mostra a inicial. */
  src?: string | null;
}) {
  const initial = [...name.trim()][0]?.toUpperCase() ?? "?";
  const v = avatarVariant(name);
  const avatar = (
    <span className={`t-avatar lino v${v} ${src ? "photo" : ""} ${speaking ? "speaking" : ""}`} style={{ ["--size" as string]: `${size}px` }} aria-hidden="true">
      {src ? <img src={src} alt="" draggable={false} /> : <span>{initial}</span>}
    </span>
  );
  if (!status) return avatar;
  return (
    <span className="t-avatar-wrap" style={{ ["--size" as string]: `${size}px`, ["--status-ring" as string]: statusRing }}>
      {avatar}
      <span className={`t-status ${status}`} title={status === "busy" ? "Não perturbe" : undefined} />
    </span>
  );
}
