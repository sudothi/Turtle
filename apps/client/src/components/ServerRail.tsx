import { Icon, TurtleMark } from "@turtle/ui";
import { fileUrl } from "../api";

export interface RailServer {
  id: string;
  name: string;
  icon?: string | null;
}

/** Iniciais para o ícone do servidor ("Lagoa dos Amigos" -> "LdA"), como no Discord. */
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => [...w][0])
    .join("");

/**
 * Barra de servidores (72px) à esquerda.
 * Já prevê vários servidores: lista, "+" para criar e "entrar com convite".
 * Enquanto o back-end tem um servidor só, criar/entrar ficam desativados (onCreate/onJoin ausentes).
 */
export function ServerRail({
  servers,
  activeId,
  onSelect,
  onCreate,
  onJoin,
  homeActive,
  unread,
  onHome,
  serverUnread = {},
}: {
  /** Servidores com algo não lido (e quantas menções a você). */
  serverUnread?: Record<string, { mentions: number }>;
  servers: RailServer[];
  activeId?: string;
  onSelect?: (id: string) => void;
  onCreate?: () => void;
  onJoin?: () => void;
  /** Início (mensagens diretas e amigos) aberto. */
  homeActive?: boolean;
  /** Quantas conversas diretas têm mensagens não lidas. */
  unread?: number;
  onHome?: () => void;
}) {
  return (
    <nav className="rail" aria-label="Servidores">
      <div className={`rail-item ${homeActive ? "active" : ""}`}>
        <span className="rail-pill" aria-hidden="true" />
        <button className="rail-icon lino rail-home-btn" title="Mensagens diretas e amigos" aria-label="Mensagens diretas e amigos" aria-current={homeActive ? "true" : undefined} onClick={onHome}>
          <TurtleMark size={32} />
        </button>
        {!!unread && <span className="rail-badge" aria-label={`${unread} conversas não lidas`}>{unread}</span>}
      </div>
      <div className="rail-sep" />
      {servers.map((s) => {
        const active = !homeActive && s.id === activeId;
        const u = serverUnread[s.id];
        return (
          <div key={s.id} className={`rail-item ${active ? "active" : ""} ${u ? "has-unread" : ""}`}>
            <span className="rail-pill" aria-hidden="true" />
            <button className={`rail-icon lino ${s.icon ? "has-icon" : ""}`} title={s.name} aria-label={u ? `${s.name} (não lido)` : s.name} aria-current={active ? "true" : undefined} onClick={() => onSelect?.(s.id)}>
              {s.icon ? <img src={fileUrl(s.icon)!} alt="" draggable={false} /> : <span className="rail-initials">{initials(s.name)}</span>}
            </button>
            {!!u?.mentions && <span className="rail-badge" aria-label={`${u.mentions} menções`}>{u.mentions}</span>}
          </div>
        );
      })}
      <div className="rail-item">
        <span className="rail-pill" aria-hidden="true" />
        <button className="rail-icon lino ghost" title={onCreate ? "Criar servidor" : "Criar servidor (em breve)"} aria-label="Criar servidor" disabled={!onCreate} onClick={onCreate}>
          <Icon name="plus" size={22} />
        </button>
      </div>
      <div className="rail-item">
        <span className="rail-pill" aria-hidden="true" />
        <button className="rail-icon lino ghost" title={onJoin ? "Entrar com convite" : "Entrar com convite (em breve)"} aria-label="Entrar com convite" disabled={!onJoin} onClick={onJoin}>
          <Icon name="ticket" size={22} />
        </button>
      </div>
    </nav>
  );
}
