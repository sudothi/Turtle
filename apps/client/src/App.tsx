import { useCallback, useEffect, useState } from "react";
import type { User } from "@turtle/protocol";
import { LinoDefs, TurtleMark } from "@turtle/ui";
import { api, getToken, setOnUnauthorized, setToken } from "./api";
import { AuthScreen } from "./screens/AuthScreen";
import { Workspace } from "./screens/Workspace";
import { Landing } from "./screens/Landing";
import { desktop } from "./desktop";

/** Dentro de um app (desktop, APK ou PWA instalado) não tem página inicial: abre direto no login. */
const insideApp = () => !!desktop() || matchMedia("(display-mode: standalone)").matches;

/** Rotas do site público. O resto (/, /login, /convite/<código>) segue como antes. */
const usePath = () => {
  const [path, setPath] = useState(() => location.pathname);
  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);
  const go = useCallback((to: string) => {
    if (to !== location.pathname) history.pushState(null, "", to);
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
  }, [clearSession]);
  const onAuth = useCallback((u: User) => {
    // Depois de entrar, a barra de endereço volta para a raiz (o app).
    if (location.pathname === "/login") history.replaceState(null, "", "/");
    setUser(u);
  }, []);
  // A página inicial (com o botão de download) é só do site no navegador.
  const landing = path === "/download" ? "download" : path === "/" && !user && !insideApp() ? "home" : null;
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
        <AuthScreen onAuth={onAuth} onHome={insideApp() ? undefined : () => go("/")} />
      )}
    </>
  );
}
