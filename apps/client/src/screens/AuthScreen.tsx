import { useState, type FormEvent } from "react";
import type { User } from "@turtle/protocol";
import { Button, TextField, TurtleLogo, TurtleMark } from "@turtle/ui";
import { api, setToken } from "../api";

type Mode = "login" | "register";
type Field = "invite" | "username" | "password" | "form";

/** Mensagem do servidor -> campo onde ela aparece (como o Discord faz no rótulo). */
function errorField(mode: Mode, message: string): Field[] {
  if (/convite/i.test(message)) return ["invite"];
  if (/nome/i.test(message)) return ["username"];
  if (mode === "login" && /senha|usuário/i.test(message)) return ["username", "password"];
  return ["form"];
}

/** Código de convite vindo de um link /convite/<código>. */
const inviteFromLink = () => decodeURIComponent(location.pathname.match(/^\/convite\/([^/]+)/)?.[1] ?? "");

export function AuthScreen({ onAuth, onHome }: { onAuth: (u: User) => void; /** Volta para a página inicial do site (não existe no app desktop). */ onHome?: () => void }) {
  const linkCode = inviteFromLink();
  const [mode, setMode] = useState<Mode>(linkCode ? "register" : "login");
  const [error, setError] = useState<{ fields: Field[]; message: string }>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const username = String(f.get("username")).trim();
    const password = String(f.get("password"));
    setBusy(true);
    setError(undefined);
    try {
      const r = mode === "login" ? await api.login(username, password) : await api.register(String(f.get("invite")).trim(), username, password);
      setToken(r.token);
      onAuth(r.user);
    } catch (err) {
      const message = (err as Error).message;
      setError({ fields: errorField(mode, message), message });
      setBusy(false);
    }
  }

  const errFor = (field: Field) => (error?.fields.includes(field) ? error.message : undefined);
  const switchMode = (m: Mode) => {
    setMode(m);
    setError(undefined);
  };

  return (
    <main className="auth lino-live">
      {onHome ? (
        <a
          href="/entrar"
          className="auth-brand"
          aria-label="Página de entrada do Turtle"
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            onHome();
          }}
        >
          <TurtleMark size={30} />
          <span className="t-display">Turtle</span>
        </a>
      ) : (
        <div className="auth-brand" aria-hidden="true">
          <TurtleMark size={30} />
          <span className="t-display">Turtle</span>
        </div>
      )}

      <div className={`auth-card lino lino-lg ${mode}`}>
        <form className="auth-form" onSubmit={submit} key={mode}>
          {mode === "login" ? (
            <header>
              <h1 className="t-display">Boas-vindas de volta!</h1>
              <p className="t-muted">Que bom te ver de novo na lagoa.</p>
            </header>
          ) : (
            <header>
              <h1 className="t-display">Criar uma conta</h1>
              <p className="t-muted">Só entra quem recebeu um convite.</p>
            </header>
          )}

          {mode === "register" && (
            <TextField name="invite" label="Código de convite" defaultValue={linkCode} required autoComplete="off" spellCheck={false} error={errFor("invite")} autoFocus={!linkCode} />
          )}
          <TextField
            name="username"
            label="Nome de usuário"
            required
            autoComplete="username"
            error={errFor("username")}
            hint={mode === "register" ? "Letras, números, ponto, traço e _. É como seus amigos vão te ver." : undefined}
            autoFocus={mode === "login" || !!linkCode}
          />
          <TextField
            name="password"
            type="password"
            label="Senha"
            required
            minLength={mode === "register" ? 8 : undefined}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            error={errFor("password")}
            hint={mode === "register" ? "Mínimo de 8 caracteres." : undefined}
          />

          {error?.fields.includes("form") && (
            <p className="auth-error" role="alert">
              {error.message}
            </p>
          )}

          <Button type="submit" size="lg" block disabled={busy}>
            {busy ? (mode === "login" ? "Entrando…" : "Criando…") : mode === "login" ? "Entrar" : "Continuar"}
          </Button>

          <p className="auth-switch t-muted">
            {mode === "login" ? (
              <>
                Recebeu um convite?{" "}
                <button type="button" className="t-link" onClick={() => switchMode("register")}>
                  Criar conta
                </button>
              </>
            ) : (
              <>
                Já tem uma conta?{" "}
                <button type="button" className="t-link" onClick={() => switchMode("login")}>
                  Entrar
                </button>
              </>
            )}
          </p>
        </form>

        {mode === "login" && (
          <aside className="auth-side">
            <TurtleLogo variant="white" size={168} className="auth-logo" />
            <h2 className="t-display">Turtle</h2>
            <p className="t-muted">Um canto só pra amigos: texto, voz e tela, sem pressa e sem plateia.</p>
          </aside>
        )}
      </div>
    </main>
  );
}
