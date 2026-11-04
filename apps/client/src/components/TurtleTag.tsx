import { TurtleMark } from "@turtle/ui";

/** Tag roxa com a tartaruga ao lado do nome de quem é administrador do Turtle. */
export function TurtleTag() {
  return (
    <span className="turtle-tag" title="Administrador do Turtle" role="img" aria-label="Administrador do Turtle">
      <TurtleMark size={13} className="turtle-tag-mark" />
    </span>
  );
}
