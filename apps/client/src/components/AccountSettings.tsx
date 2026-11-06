import { useCallback, useEffect, useState, type FormEvent } from "react";
import { describeDevice, type SessionInfo } from "@turtle/protocol";
import { Button, TextField } from "@turtle/ui";
import { api } from "../api";

const formatWhen = (iso: string) => {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  if (diff < 60_000) return "Agora mesmo";
  if (diff < 3_600_000) return `Há ${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000) return `Há ${Math.floor(diff / 3_600_000)} h`;
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
};

/** Configurações > Conta: trocar a senha e gerir sessões abertas em outros aparelhos. */
export function AccountSettings({ onLogout }: { onLogout: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string>();
  const [pwSaved, setPwSaved] = useState(false);

  const [sessions, setSessions] = useState<SessionInfo[]>();
  const [sessError, setSessError] = useState<string>();
  const [sessBusy, setSessBusy] = useState(false);

  const loadSessions = useCallback(() => {
    api.sessions().then(setSessions, (e: Error) => setSessError(e.message));
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  async function submitPassword(e: FormEvent) {
    e.preventDefault();
    setPwBusy(true);
    setPwError(undefined);
    setPwSaved(false);
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setPwSaved(true);
      loadSessions();
    } catch (err) {
      setPwError((err as Error).message);
    } finally {
      setPwBusy(false);
    }
  }

  async function revokeOne(s: SessionInfo) {
    setSessBusy(true);
    setSessError(undefined);
    try {
      await api.revokeSession(s.id);
      if (s.current) return onLogout();
      setSessions((list) => list?.filter((x) => x.id !== s.id));
    } catch (err) {
      setSessError((err as Error).message);
    } finally {
      setSessBusy(false);
    }
  }

  async function revokeAll() {
    setSessBusy(true);
    setSessError(undefined);
    try {
      await api.revokeAllSessions();
      onLogout();
    } catch (err) {
      setSessError((err as Error).message);
      setSessBusy(false);
    }
  }

  return (
    <div className="account-settings">
      <form className="profile-form" onSubmit={submitPassword}>
        <div className="t-eyebrow">Trocar senha</div>
        <TextField
          label="Senha atual"
          type="password"
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(e) => { setCurrentPassword(e.target.value); setPwSaved(false); }}
        />
        <TextField
          label="Nova senha"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={200}
          hint="Pelo menos 8 caracteres. Trocar a senha encerra as sessões nos outros aparelhos."
          value={newPassword}
          onChange={(e) => { setNewPassword(e.target.value); setPwSaved(false); }}
          error={pwError}
        />
        <div className="profile-actions">
          <Button type="submit" disabled={pwBusy || !currentPassword || newPassword.length < 8}>
            {pwSaved ? "Senha alterada" : "Trocar senha"}
          </Button>
        </div>
      </form>

      <div className="t-field account-sessions">
        <div className="account-sessions-head">
          <div>
            <span className="t-field-label">Sessões ativas</span>
            <span className="t-field-hint">Aparelhos conectados à sua conta (expiram após 30 dias sem uso).</span>
          </div>
          {sessions && sessions.length > 0 && (
            <Button size="sm" variant="ghost" disabled={sessBusy} onClick={() => void revokeAll()}>
              Sair de todos
            </Button>
          )}
        </div>
        <div className="session-list">
          {sessions?.map((s) => (
            <div key={s.id} className="session-row lino">
              <div className="session-info">
                <b>
                  {describeDevice(s.userAgent)}
                  {s.current && <span className="role-badge t-muted">Este aparelho</span>}
                </b>
                <span className="t-muted">Último uso: {formatWhen(s.lastUsedAt)}</span>
              </div>
              <Button size="sm" variant="ghost" disabled={sessBusy} onClick={() => void revokeOne(s)}>
                Sair deste
              </Button>
            </div>
          ))}
        </div>
        {sessError && <div className="err" role="alert">{sessError}</div>}
      </div>
    </div>
  );
}
