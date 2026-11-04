import { TurtleMark } from "./Logo";

/** Selo dos administradores ao lado do nome: só a tartaruga, roxa em dois tons (como a tag de servidor do Discord). */
export function StaffTag({ className = "" }: { className?: string }) {
  return (
    <span className={`t-staff-tag ${className}`} title="Administrador do Turtle" role="img" aria-label="Administrador do Turtle">
      <TurtleMark size={13} />
    </span>
  );
}
