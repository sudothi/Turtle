import { TurtleMark } from "./Logo";

/** Tag "TURTLE" dos administradores, ao lado do nome (como a tag de servidor do Discord). Roxo em dois tons. */
export function StaffTag({ className = "" }: { className?: string }) {
  return (
    <span className={`t-staff-tag ${className}`} title="Administrador do Turtle">
      <TurtleMark size={11} />
      <span>TURTLE</span>
    </span>
  );
}
