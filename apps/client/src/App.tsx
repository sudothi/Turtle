import { useCallback, useEffect, useState } from "react";
import type { User } from "@turtle/protocol";
import { LinoDefs, TurtleMark } from "@turtle/ui";
import { api, getToken, setOnUnauthorized, setToken } from "./api";
import { AuthScreen } from "./screens/AuthScreen";
import { Workspace } from "./screens/Workspace";
import { Landing } from "./screens/Landing";
import { desktop } from "./desktop";
import { appSurface } from "./routes";
import { discoIdFromPath } from "./jukebox";

/** Dentro de um app (desktop, APK ou PWA instalado) não tem página inicial: abre direto no login. */
const insideApp = () => !!desktop() || matchMedia("(display-mode: standalone)").matches;

/** Navigation shared by public pages and the web workspace. */
const usePath = () => {
  const [path, setPath] = useState(() => location.pathname);
  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);
  const go = useCallback((to: string, replace = false) => {
    if (to !== location.pathname) history[replace ? "replaceState" : "pushState"](null, "", to);
    setPath(to);
    scrollTo(0, 0);
  }, []);
  return [path, go] as const;
};

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!getToken()) return setReady(true);
    api.me().then(setUser).catch(() => setToken(null)).finally(() => setReady(true));
  }, []);
  const [path, go] = usePath();
  const clearSession = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);
  useEffect(() => {
    setOnUnauthorized(clearSession);
    return () => setOnUnauthorized(undefined);
  }, [clearSession]);
  const logout = useCallback(() => {
    if (getToken()) void api.logout().catch(() => {});
    clearSession();
    if (!insideApp()) go("/inicio", true);
  }, [clearSession, go]);
  const onAuth = useCallback((u: User) => {
    setUser(u);
    // Quem entrou por um link de discoteca continua nele (o Workspace mostra o convite).
    go(discoIdFromPath(location.pathname) ? location.pathname : insideApp() ? "/" : "/app", true);
  }, [go]);
  const surface = appSurface(path, !!user, insideApp());
  const landing = surface === "waitlist" || surface === "home" || surface === "download" ? surface : null;
  return (
    <>
      <LinoDefs />
      {!ready ? (
        <div className="splash" aria-label="Carregando">
          <TurtleMark size={64} />
        </div>
      ) : landing ? (
        <Landing tab={landing} loggedIn={!!user} go={go} />
      ) : user ? (
        <Workspace user={user} onLogout={logout} />
      ) : (
        <AuthScreen onAuth={onAuth} onHome={insideApp() ? undefined : () => go("/inicio")} />
      )}
    </>
  );
}
