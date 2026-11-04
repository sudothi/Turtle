// Design system do Turtle: tinta e papel, estética linocut.
// CSS: import "@turtle/ui/styles.css" (tokens + base + componentes). Renderize <LinoDefs /> uma vez.
export { LinoDefs } from "./LinoDefs";
export { TurtleLogo, TurtleMark } from "./Logo";
export { Icon, iconNames, type IconName } from "./Icon";
export { Button, IconButton } from "./Button";
export { TextField } from "./TextField";
export { Avatar, avatarVariant } from "./Avatar";
export { Modal } from "./Modal";
export { StaffTag } from "./StaffTag";
export { TURTLE_PATH } from "./logo-path";

/** Tokens para uso em JS (os mesmos de tokens.css). */
export const theme = {
  ink: ["#000000", "#0a0a0a", "#111111", "#1a1a1a", "#242424", "#2e2e2e"],
  paper: "#f5f3ee",
  textMuted: "#9a9790",
  textFaint: "#66645f",
} as const;
