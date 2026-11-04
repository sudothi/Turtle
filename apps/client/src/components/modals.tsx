import { useEffect, useState, type FormEvent } from "react";
import { shownName, type Account, type ChannelKind } from "@turtle/protocol";
import { Avatar, Button, Icon, Modal, TextField } from "@turtle/ui";
import { api, fileUrl } from "../api";

export function CreateChannelModal({ serverId, initialKind, onClose }: { serverId: string; initialKind: ChannelKind; onClose: () => void }) {
  const [kind, setKind] = useState<ChannelKind>(initialKind);
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  // Como no Discord: minúsculas e traços no lugar de espaço.
  const clean = (v: string) => v.toLowerCase().replace(/\s+/g, "-");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.createChannel(serverId, name.trim(), kind);
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Criar canal" onClose={onClose}>
      <form id="create-channel" className="create-channel" onSubmit={submit}>
        <fieldset className="kind-picker">
          <legend className="t-field-label">Tipo de canal</legend>
          {(["text", "voice"] as const).map((k) => (
            <label key={k} className={`kind-option lino ${kind === k ? "on" : ""}`}>
              <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} />
              <Icon name={k === "text" ? "hash" : "speaker"} size={24} />
              <span>
                <b>{k === "text" ? "Texto" : "Voz"}</b>
                <span className="t-muted">{k === "text" ? "Mensagens, links e conversa fiada" : "Conversar por voz, tela e câmera"}</span>
              </span>
              <span className="kind-radio" aria-hidden="true" />
            </label>
          ))}
        </fieldset>
        <TextField
          label="Nome do canal"
          required
          maxLength={40}
          placeholder={kind === "text" ? "novo-canal" : "Sala nova"}
          value={name}
          onChange={(e) => setName(kind === "text" ? clean(e.target.value) : e.target.value)}
          error={error}
          autoFocus
        />
        <div className="modal-actions">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={busy || !name.trim()}>
            Criar canal
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function InviteModal({ serverId, serverName, onClose }: { serverId: string; serverName: string; onClose: () => void }) {
  const [code, setCode] = useState<string>();
  const [days, setDays] = useState(7);
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCode(undefined);
    api.createInvite(serverId, days).then((r) => setCode(r.code), (e: Error) => setError(e.message));
  }, [serverId, days]);

  const link = code ?? "";
  const copy = async () => {
    if (!code) return;
    await navigator.clipboard.writeText(link).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <Modal title={`Convide amigos para ${serverName}`} subtitle="Este convite só serve para entrar neste servidor, e só para quem já tem conta. Peça que a pessoa use o código no botão de convite (+ na lateral)." onClose={onClose}>
      <div className="invite-box lino">
        <code>{link || (error ? "—" : "gerando…")}</code>
        <Button size="sm" onClick={copy} disabled={!code}>
          <Icon name={copied ? "check" : "copy"} size={16} />
          {copied ? "Copiado" : "Copiar"}
        </Button>
      </div>
      <label className="t-muted invite-days">
        Validade{" "}
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={1}>1 dia</option>
          <option value={7}>7 dias</option>
          <option value={30}>30 dias</option>
          <option value={0}>não expira</option>
        </select>
      </label>
      {error && <p className="t-muted">{error}</p>}
    </Modal>
  );
}

/** Só admin do app (nas Configurações): gera um convite para criar conta no Turtle, de uso único. */
export function AppInvitePanel() {
  const [code, setCode] = useState<string>();
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const generate = () => {
    setCode(undefined);
    setError(undefined);
    api.createAccountInvite().then((r) => setCode(r.code), (e: Error) => setError(e.message));
  };
  const link = code ? `${location.origin}/convite/${code}` : "";
  const copy = async () => {
    await navigator.clipboard.writeText(link).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className="t-field app-invite">
      <span className="t-field-label">Convidar para o Turtle</span>
      {code ? (
        <div className="invite-box lino">
          <code>{link}</code>
          <Button size="sm" onClick={copy}>
            <Icon name={copied ? "check" : "copy"} size={16} />
            {copied ? "Copiado" : "Copiar"}
          </Button>
        </div>
      ) : (
        <div className="profile-actions">
          <Button size="sm" onClick={generate}>Gerar convite de conta</Button>
        </div>
      )}
      <span className="t-field-hint">Link de uso único para uma pessoa criar a conta. Depois ela entra nos servidores com convites de servidor.</span>
      {code && <div className="profile-actions"><Button size="sm" variant="ghost" onClick={generate}>Gerar outro</Button></div>}
      {error && <div className="err" role="alert">{error}</div>}
    </div>
  );
}

/** Só para o admin: quem tem o cargo Convidador (pode gerar convites de conta). */
export function InvitersPanel({ me }: { me: string }) {
  const [people, setPeople] = useState<Account[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    api.accounts().then(setPeople, (e: Error) => setError(e.message));
  }, []);
  const toggle = (p: Account, canInvite: boolean) => {
    setError(undefined);
    setPeople((list) => list?.map((x) => (x.id === p.id ? { ...x, canInvite } : x)));
    api.setInviter(p.id, canInvite).catch((e: Error) => {
      setError(e.message);
      setPeople((list) => list?.map((x) => (x.id === p.id ? { ...x, canInvite: !canInvite } : x)));
    });
  };
  return (
    <div className="t-field inviters">
      <span className="t-field-label">Administradores</span>
      <span className="t-field-hint">Quem estiver marcado vira administrador do Turtle: ganha a tag TURTLE ao lado do nome e pode gerar convites de conta.</span>
      {people?.map((p) => (
        <label key={p.id} className="inviter-row">
          <Avatar name={shownName(p)} src={fileUrl(p.avatar)} size={28} />
          <span className="inviter-name">
            {shownName(p)}
            {p.displayName && <span className="t-muted"> @{p.username}</span>}
          </span>
          {p.isAdmin || p.id === me ? (
            <span className="role-badge t-muted">Admin</span>
          ) : (
            <input type="checkbox" aria-label={`Administrador: ${shownName(p)}`} checked={p.canInvite} onChange={(e) => toggle(p, e.target.checked)} />
          )}
        </label>
      ))}
      {error && <div className="err" role="alert">{error}</div>}
    </div>
  );
}
