import { Icon, TurtleMark } from "@turtle/ui";

export interface RailServer {
  id: string;
  name: string;
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
}: {
  servers: RailServer[];
  activeId?: string;
  onSelect?: (id: string) => void;
  onCreate?: () => void;
  onJoin?: () => void;
}) {
  return (
    <nav className="rail carve" aria-label="Servidores">
      <div className="rail-item">
        <span className="rail-pill" aria-hidden="true" />
        <div className="rail-home" title="Turtle (mensagens diretas em breve)" aria-hidden="true">
          <TurtleMark size={32} />
        </div>
      </div>
      <div className="rail-sep" />
      {servers.map((s) => {
        const active = s.id === activeId;
        return (
          <div key={s.id} className={`rail-item ${active ? "active" : ""}`}>
            <span className="rail-pill" aria-hidden="true" />
            <button className="rail-icon lino" title={s.name} aria-label={s.name} aria-current={active ? "true" : undefined} onClick={() => onSelect?.(s.id)}>
              <span className="rail-initials">{initials(s.name)}</span>
            </button>
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
