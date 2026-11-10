import { useEffect, useState, type FormEvent } from "react";
import { shownName, type Account, type Channel, type ChannelKind, type Server } from "@turtle/protocol";
import { Avatar, Button, Icon, Modal, TextField } from "@turtle/ui";
import { api, fileUrl } from "../api";
import { copyText } from "../clipboard";

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
    if (!(await copyText(link))) return;
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

/** Admin ou Convidador (nas Configurações): convite de uso único para criar conta, opcionalmente já entrando num servidor. */
export function AppInvitePanel() {
  const [code, setCode] = useState<string>();
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [servers, setServers] = useState<Server[]>([]);
  const [serverId, setServerId] = useState("");
  useEffect(() => {
    api.servers().then(setServers, () => {});
  }, []);
  const generate = () => {
    setCode(undefined);
    setError(undefined);
    api.createAccountInvite(serverId || undefined).then((r) => setCode(r.code), (e: Error) => setError(e.message));
  };
  const link = code ? `${location.origin}/convite/${code}` : "";
  const copy = async () => {
    if (!(await copyText(link))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  const target = servers.find((x) => x.id === serverId);
  return (
    <div className="t-field app-invite">
      <span className="t-field-label">Convidar para o Turtle</span>
      {servers.length > 0 && (
        <label className="t-muted invite-days">
          Já entra no servidor{" "}
          <select value={serverId} onChange={(e) => { setServerId(e.target.value); setCode(undefined); }}>
            <option value="">nenhum (começa sem servidor)</option>
            {servers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </label>
      )}
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
      <span className="t-field-hint">
        {target
          ? `Link de uso único: a pessoa cria a conta e já cai em ${target.name}.`
          : "Link de uso único para uma pessoa criar a conta. Depois ela entra nos servidores com convites de servidor."}
      </span>
      {code && <div className="profile-actions"><Button size="sm" variant="ghost" onClick={generate}>Gerar outro</Button></div>}
      {error && <div className="err" role="alert">{error}</div>}
    </div>
  );
}

/** Só para o admin: quem tem o cargo Convidador e desativar/reativar contas. */
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
  const toggleDisabled = (p: Account, disabled: boolean) => {
    setError(undefined);
    setPeople((list) => list?.map((x) => (x.id === p.id ? { ...x, disabled } : x)));
    api.setAccountDisabled(p.id, disabled).catch((e: Error) => {
      setError(e.message);
      setPeople((list) => list?.map((x) => (x.id === p.id ? { ...x, disabled: !disabled } : x)));
    });
  };
  return (
    <div className="t-field inviters">
      <span className="t-field-label">Contas e administradores</span>
      <span className="t-field-hint">Quem estiver marcado ganha o selo da tartaruga roxa e pode gerar convites de conta. Desativar uma conta encerra as sessões, tira das chamadas e bloqueia o login.</span>
      {people?.map((p) => (
        <div key={p.id} className="inviter-row">
          <Avatar name={shownName(p)} src={fileUrl(p.avatar)} size={28} />
          <span className="inviter-name">
            {shownName(p)}
            {p.displayName && <span className="t-muted"> @{p.username}</span>}
            {p.disabled && <span className="role-badge t-muted">Desativada</span>}
          </span>
          {p.isAdmin || p.id === me ? (
            <span className="role-badge t-muted">Admin</span>
          ) : (
            <div className="inviter-actions">
              <label className="inviter-check">
                <input type="checkbox" aria-label={`Administrador: ${shownName(p)}`} checked={p.canInvite} disabled={p.disabled} onChange={(e) => toggle(p, e.target.checked)} />
                <span className="t-muted">Convidador</span>
              </label>
              <Button size="sm" variant="ghost" onClick={() => toggleDisabled(p, !p.disabled)}>
                {p.disabled ? "Reativar" : "Desativar"}
              </Button>
            </div>
          )}
        </div>
      ))}
      {error && <div className="err" role="alert">{error}</div>}
    </div>
  );
}

/** Editar canal: renomear ou apagar (dono e admin do servidor). */
export function EditChannelModal({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  const [name, setName] = useState(channel.name);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const text = channel.kind === "text";
  const clean = (v: string) => (text ? v.toLowerCase().replace(/\s+/g, "-") : v);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal title="Editar canal" subtitle={text ? `#${channel.name}` : channel.name} onClose={onClose}>
      <form className="create-channel" onSubmit={(e) => { e.preventDefault(); void run(() => api.renameChannel(channel.id, name.trim())); }}>
        <TextField label="Nome do canal" required maxLength={40} value={name} onChange={(e) => setName(clean(e.target.value))} error={error} autoFocus />
        <div className="modal-actions">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={busy || !name.trim() || name.trim() === channel.name}>Salvar</Button>
        </div>
      </form>
      <section className="danger-zone lino">
        <h3 className="t-eyebrow">Apagar canal</h3>
        <p className="t-muted">{text ? "Apaga o canal com todas as mensagens e arquivos, para todo mundo." : "Apaga o canal e tira da chamada quem estiver nele."} Não dá para desfazer.</p>
        <Button size="sm" disabled={busy} onClick={() => (confirm ? void run(() => api.deleteChannel(channel.id)) : setConfirm(true))}>
          {confirm ? "Confirmar: apagar de vez" : "Apagar canal"}
        </Button>
      </section>
    </Modal>
  );
}
