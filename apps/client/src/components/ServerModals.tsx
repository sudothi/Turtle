import { useEffect, useState, type FormEvent } from "react";
import { MAX_OWNED_SERVERS, shownName, type InvitePreview, type Member, type Server, type User } from "@turtle/protocol";
import { Avatar, Button, Modal, TextField } from "@turtle/ui";
import { api, fileUrl } from "../api";

export function CreateServerModal({ ownedCount, onClose, onCreated }: { ownedCount: number; onClose: () => void; onCreated: (s: Server) => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const full = ownedCount >= MAX_OWNED_SERVERS;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      onCreated(await api.createServer(name.trim()));
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Criar servidor"
      subtitle={full ? `Você já é dono de ${MAX_OWNED_SERVERS} servidores. Apague um ou passe a posse para criar outro.` : `Cada pessoa pode ser dona de até ${MAX_OWNED_SERVERS} servidores (você tem ${ownedCount}).`}
      onClose={onClose}
    >
      <form className="create-channel" onSubmit={submit}>
        <TextField label="Nome do servidor" required minLength={2} maxLength={40} placeholder="Lagoa dos Amigos" value={name} onChange={(e) => setName(e.target.value)} error={error} autoFocus disabled={full} />
        <div className="modal-actions">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={busy || full || name.trim().length < 2}>
            Criar servidor
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function JoinServerModal({ onClose, onJoined }: { onClose: () => void; onJoined: (s: Server) => void }) {
  const [code, setCode] = useState("");
  const [preview, setPreview] = useState<InvitePreview>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const clean = code.trim();

  // Mostra o nome do servidor assim que o código é válido.
  useEffect(() => {
    setPreview(undefined);
    setError(undefined);
    if (clean.length < 4) return;
    let stale = false;
    const t = setTimeout(() => {
      api.invitePreview(clean).then((p) => !stale && setPreview(p), () => !stale && setError("convite inválido ou vencido"));
    }, 300);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [clean]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      onJoined(await api.joinInvite(clean));
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Entrar em um servidor" subtitle="Cole o código de convite que um amigo te mandou." onClose={onClose}>
      <form className="create-channel" onSubmit={submit}>
        <TextField label="Código do convite" required value={code} onChange={(e) => setCode(e.target.value)} error={error} autoFocus />
        {preview && (
          <p className="join-preview lino">
            <b>{preview.serverName}</b> <span className="t-muted">· {preview.members} {preview.members === 1 ? "membro" : "membros"}</span>
          </p>
        )}
        <div className="modal-actions">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={busy || !preview}>
            Entrar
          </Button>
        </div>
      </form>
    </Modal>
  );
}

const roleLabel = { owner: "Dono", admin: "Admin", member: "Membro" } as const;

/** Configurações do servidor: nome, membros (cargos, expulsar, passar a posse) e apagar. */
export function ServerSettingsModal({
  server,
  me,
  members,
  ownedCount,
  onClose,
  onChanged,
  onGone,
}: {
  server: Server;
  me: User;
  members: Member[];
  ownedCount: number;
  onClose: () => void;
  /** Algo mudou: buscar de novo. */
  onChanged: () => void;
  /** O servidor foi apagado ou você saiu dele. */
  onGone: () => void;
}) {
  const isOwner = server.role === "owner";
  const [name, setName] = useState(server.name);
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string>();
  const run = async (fn: () => Promise<unknown>, done?: () => void) => {
    setError(undefined);
    try {
      await fn();
      (done ?? onChanged)();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal title="Configurações do servidor" subtitle={server.name} onClose={onClose}>
      <div className="server-settings">
        {isOwner && (
          <form
            className="settings-row"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => api.renameServer(server.id, name.trim()));
            }}
          >
            <TextField label="Nome" minLength={2} maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
            <Button type="submit" size="sm" disabled={name.trim().length < 2 || name.trim() === server.name}>
              Salvar
            </Button>
          </form>
        )}

        <h3 className="t-eyebrow">Membros — {members.length}</h3>
        <ul className="settings-members">
          {[...members].sort((a, b) => a.username.localeCompare(b.username, "pt-BR")).map((m) => {
            const isMe = m.userId === me.id;
            const canKick = !isMe && m.role !== "owner" && (isOwner || (server.role === "admin" && m.role === "member"));
            return (
              <li key={m.userId}>
                <Avatar name={shownName(m)} src={fileUrl(m.avatar)} size={28} />
                <span className="settings-name">
                  {shownName(m)}
                  {isMe && " (você)"}
                </span>
                {isOwner && m.role !== "owner" ? (
                  <select aria-label={`Cargo de ${m.username}`} value={m.role} onChange={(e) => void run(() => api.setRole(server.id, m.userId, e.target.value as "admin" | "member"))}>
                    <option value="member">{roleLabel.member}</option>
                    <option value="admin">{roleLabel.admin}</option>
                  </select>
                ) : (
                  <span className="t-muted">{roleLabel[m.role]}</span>
                )}
                {isOwner && !isMe && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (ownedCount >= MAX_OWNED_SERVERS) return setError(`${m.username} já é dono de ${MAX_OWNED_SERVERS} servidores`);
                      if (confirm !== `passar:${m.userId}`) return setConfirm(`passar:${m.userId}`);
                      void run(() => api.transferServer(server.id, m.userId));
                    }}
                  >
                    {confirm === `passar:${m.userId}` ? "Confirmar posse" : "Passar a posse"}
                  </Button>
                )}
                {canKick && (
                  <Button variant="ghost" size="sm" onClick={() => void run(() => api.removeMember(server.id, m.userId))}>
                    Expulsar
                  </Button>
                )}
              </li>
            );
          })}
        </ul>

        {!isOwner && (
          <Button variant="ghost" onClick={() => window.confirm(`Sair de ${server.name}?`) && void run(() => api.removeMember(server.id, me.id), onGone)}>
            Sair do servidor
          </Button>
        )}

        {isOwner && (
          <section className="danger-zone lino">
            <h3 className="t-eyebrow">Apagar servidor</h3>
            <p className="t-muted">Apaga canais e mensagens para todos. Digite o nome do servidor para confirmar.</p>
            <div className="settings-row">
              <TextField label="Nome do servidor" value={confirm.startsWith("passar:") ? "" : confirm} onChange={(e) => setConfirm(e.target.value)} />
              <Button size="sm" disabled={confirm !== server.name} onClick={() => void run(() => api.deleteServer(server.id, confirm), onGone)}>
                Apagar
              </Button>
            </div>
          </section>
        )}
        {error && <p className="t-muted" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
