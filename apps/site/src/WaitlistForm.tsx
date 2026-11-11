import { useState, type FormEvent } from "react";
import { Button, TextField } from "@turtle/ui";
import { APP_URL } from "./config";

export function WaitlistForm() {
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch(`${APP_URL}/waitlist`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
      if (!res.ok) throw new Error(String(res.status));
      setSaved(true);
    } catch {
      setError("Não foi possível entrar na lista agora. Aguarde alguns minutos e tente novamente.");
    } finally { setBusy(false); }
  };
  return <section className="waitlist-content" aria-labelledby="waitlist-title">
    <h1 id="waitlist-title" className="t-display">A lagoa abre em breve.</h1>
    <p className="waitlist-intro">Chamadas, telas e conversas entre amigos. Estamos preparando o Turtle. Deixe seu e-mail para saber quando estiver pronto.</p>
    {saved ? <p className="waitlist-success" role="status">Você está na lista. Vamos avisar quando o Turtle estiver pronto.</p> : <form className="waitlist-form" onSubmit={submit} aria-busy={busy}>
      <TextField label="Seu e-mail" name="email" type="email" autoComplete="email" inputMode="email" maxLength={254} required disabled={busy} />
      {error && <p className="waitlist-error" role="alert">{error}</p>}
      <Button type="submit" block disabled={busy}>{busy ? "Salvando…" : "Entrar na lista"}</Button>
      <p className="waitlist-note">Seu e-mail será usado para avisar sobre o lançamento.</p>
    </form>}
  </section>;
}
