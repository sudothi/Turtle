import { useCallback, useEffect, useState } from "react";
import type { User } from "@turtle/protocol";
import { LinoDefs, TurtleMark } from "@turtle/ui";
import { api, getToken, setToken } from "./api";
import { AuthScreen } from "./screens/AuthScreen";
import { Workspace } from "./screens/Workspace";

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!getToken()) return setReady(true);
    api.me().then(setUser).catch(() => setToken(null)).finally(() => setReady(true));
  }, []);
  const logout = useCallback(() => { setToken(null); setUser(null); }, []);
  return (
    <>
      <LinoDefs />
      {!ready ? (
        <div className="splash" aria-label="Carregando">
          <TurtleMark size={64} />
        </div>
      ) : user ? (
        <Workspace user={user} onLogout={logout} />
      ) : (
        <AuthScreen onAuth={setUser} />
      )}
    </>
  );
}
