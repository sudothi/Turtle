import { useEffect, useState, type FormEvent } from "react";
import type { ChannelKind } from "@turtle/protocol";
import { Button, Icon, Modal, TextField } from "@turtle/ui";
import { api } from "../api";

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

  const link = code ? `${location.origin}/convite/${code}` : "";
  const copy = async () => {
    if (!code) return;
    await navigator.clipboard.writeText(link).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <Modal title={`Convide amigos para ${serverName}`} subtitle="Mande este link. Quem ainda não tem conta cria uma ao abri-lo; quem já tem, usa o código no botão de convite." onClose={onClose}>
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
