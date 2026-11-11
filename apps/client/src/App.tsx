import { useCallback, useEffect, useState } from "react";
import type { User } from "@turtle/protocol";
import { LinoDefs, TurtleMark } from "@turtle/ui";
import { api, getToken, setOnUnauthorized, setToken } from "./api";
import { AuthScreen } from "./screens/AuthScreen";
import { Workspace } from "./screens/Workspace";
import { appSurface } from "./routes";
import { discoIdFromPath } from "./jukebox";

/** Navegação do app (rotas de convite e de discoteca). */
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
  const [, go] = usePath();
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
  }, [clearSession]);
  const onAuth = useCallback((u: User) => {
    setUser(u);
    // Quem entrou por um link de discoteca continua nele (o Workspace mostra o convite).
    go(discoIdFromPath(location.pathname) ? location.pathname : "/", true);
  }, [go]);
  return (
    <>
      <LinoDefs />
      {!ready ? (
        <div className="splash" aria-label="Carregando">
          <TurtleMark size={64} />
        </div>
      ) : appSurface(!!user) === "workspace" && user ? (
        <Workspace user={user} onLogout={logout} />
      ) : (
        <AuthScreen onAuth={onAuth} />
      )}
    </>
  );
}
