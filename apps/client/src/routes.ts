export type AppSurface = "waitlist" | "home" | "download" | "workspace" | "auth";

/** Installed apps keep their direct entry; the browser root is always public. */
export function appSurface(path: string, loggedIn: boolean, installed: boolean): AppSurface {
  const route = path.replace(/\/+$/, "") || "/";
  if (route === "/" && !installed) return "waitlist";
  if (route === "/inicio") return "home";
  if (route === "/download") return "download";
  return loggedIn ? "workspace" : "auth";
}
