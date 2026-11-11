export type AppSurface = "workspace" | "auth";

/** O site público (início, fila de espera e download) mora em outro domínio; aqui só existe login e app. */
export function appSurface(loggedIn: boolean): AppSurface {
  return loggedIn ? "workspace" : "auth";
}
