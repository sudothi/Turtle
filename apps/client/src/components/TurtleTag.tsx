import { TurtleMark } from "@turtle/ui";

/** Tag roxa "TURTLE" ao lado do nome de quem é administrador do Turtle. */
export function TurtleTag() {
  return (
    <span className="turtle-tag" title="Administrador do Turtle">
      <TurtleMark size={12} className="turtle-tag-mark" />
      TURTLE
    </span>
  );
}
