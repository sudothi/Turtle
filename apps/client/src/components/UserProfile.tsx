import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { shownName, type Person, type ProfileView, type ServerRole } from "@turtle/protocol";
import { Avatar, Button, Icon, IconButton, StaffTag } from "@turtle/ui";
import { api, fileUrl } from "../api";
import { ActivityLine, usePresence } from "../presence";

/*
 * Perfil no jeito do Discord, em três tamanhos:
 * - ProfilePopout: mini perfil que abre colado ao que foi clicado;
 * - ProfileModal: perfil completo, com abas;
 * - DmProfilePanel: coluna à direita da conversa direta.
 */

const roleLabel: Record<ServerRole, string> = { owner: "Dono", admin: "Admin", member: "" };
const memberSince = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "numeric" });

/** O que o perfil pode pedir a quem o abriu. */
export interface ProfileHandlers {
  meId: string;
  online: string[];
  /** Abre (ou cria) a conversa direta; com `text`, já envia essa mensagem. */
  onMessage: (userId: string, text?: string) => void;
  /** Amizade ou bloqueio mudou: recarrega listas. */
  onChanged: () => void;
  /** Abre as configurações do próprio perfil. */
  onEditProfile: () => void;
  onOpenServer?: (serverId: string) => void;
}

/** Carrega o perfil e recarrega depois de cada ação (amizade, bloqueio). */
function useProfile(userId: string, onMissing?: () => void, version?: number) {
  const [profile, setProfile] = useState<ProfileView>();
  const [error, setError] = useState<string>();
  const load = useCallback(() => {
    api.profile(userId).then(setProfile).catch(() => onMissing?.());
  }, [userId, onMissing]);
  useEffect(() => {
    load();
  }, [load, version]);
  useEffect(() => setProfile(undefined), [userId]);
  const run = async (fn: () => Promise<unknown>, onChanged: () => void) => {
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
    load();
    onChanged();
  };
  return { profile, error, run };
}

const useEscape = (onClose: () => void) =>
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

/** Banner + foto com bolinha de presença, igual nos três tamanhos (muda só a escala). */
function Masthead({ profile, online, size, children }: { profile: ProfileView; online: boolean; size: "sm" | "md" | "lg"; children?: ReactNode }) {
  const banner = fileUrl(profile.banner);
  const avatar = { sm: 80, md: 80, lg: 120 }[size];
  const presence = usePresence()(profile.id);
  return (
    <div className={`up-mast up-mast-${size}`}>
      <div className={`up-banner ${banner ? "" : "empty"}`}>{banner && <img src={banner} alt="" draggable={false} />}</div>
      <div className="up-avatar">
        <Avatar name={shownName(profile)} size={avatar} src={fileUrl(profile.avatar)} status={online ? (presence === "busy" ? "busy" : "online") : "offline"} statusRing="var(--up-bg)" />
      </div>
      {children && <div className="up-mast-actions">{children}</div>}
    </div>
  );
}

function Names({ profile, role, onOpen }: { profile: ProfileView; role?: ServerRole; onOpen?: () => void }) {
  const name = <h3 className="t-display up-name">{shownName(profile)}</h3>;
  return (
    <div className="up-names">
      {onOpen ? <button className="plain-btn up-name-btn" title="Ver perfil completo" onClick={onOpen}>{name}</button> : name}
      <div className="up-user">
        <span>{profile.username}</span>
        {profile.staff && <StaffTag />}
        {role && roleLabel[role] && <span className="up-role">{roleLabel[role]}</span>}
      </div>
      <ActivityLine userId={profile.id} className="up-activity" />
    </div>
  );
}

/** Menu "⋯": desfazer amizade, cancelar pedido, bloquear e desbloquear. */
function MoreMenu({ profile, act, align = "right" }: { profile: ProfileView; act: (fn: () => Promise<unknown>) => void; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", off);
    return () => window.removeEventListener("mousedown", off);
  }, [open]);
  const item = (label: string, fn: () => Promise<unknown>, danger = false) => (
    <button role="menuitem" className={`menu-item ${danger ? "danger" : ""}`} onClick={() => { setOpen(false); act(fn); }}>
      <span>{label}</span>
    </button>
  );
  const name = shownName(profile);
  return (
    <div className="up-more" ref={box}>
      <IconButton label="Mais" className="up-icon-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="more" />
      </IconButton>
      {open && (
        <div className={`menu up-menu lino up-menu-${align}`} role="menu">
          <button role="menuitem" className="menu-item" onClick={() => { setOpen(false); void navigator.clipboard?.writeText(profile.username); }}>
            <span>Copiar nome de usuário</span>
            <Icon name="copy" size={16} />
          </button>
          {profile.friendship === "friend" && item("Desfazer amizade", () => api.removeFriend(profile.id), true)}
          {profile.friendship === "outgoing" && item("Cancelar pedido de amizade", () => api.removeFriend(profile.id))}
          {profile.blocked
            ? item("Desbloquear", () => api.unblock(profile.id))
            : item("Bloquear", async () => {
                if (window.confirm(`Bloquear ${name}? Vocês deixam de ser amigos e não poderão se falar.`)) await api.block(profile.id);
              }, true)}
        </div>
      )}
    </div>
  );
}

/** Botão de amizade com ícone (como no topo do perfil do Discord). */
function FriendButton({ profile, act, withText }: { profile: ProfileView; act: (fn: () => Promise<unknown>) => void; withText?: boolean }) {
  if (profile.blocked || profile.friendship === "friend") return null;
  const label = profile.friendship === "incoming" ? "Aceitar pedido de amizade" : profile.friendship === "outgoing" ? "Pedido de amizade enviado" : "Adicionar amigo";
  const disabled = profile.friendship === "outgoing";
  if (withText)
    return (
      <Button variant="ghost" size="sm" disabled={disabled} onClick={() => act(() => api.addFriend(profile.id))}>
        <Icon name={disabled ? "check" : "user-plus"} size={18} /> {profile.friendship === "incoming" ? "Aceitar" : disabled ? "Pedido enviado" : "Adicionar amigo"}
      </Button>
    );
  return (
    <IconButton label={label} className="up-icon-btn" disabled={disabled} onClick={() => act(() => api.addFriend(profile.id))}>
      <Icon name={disabled ? "check" : "user-plus"} />
    </IconButton>
  );
}

function About({ profile, compact }: { profile: ProfileView; compact?: boolean }) {
  return (
    <>
      {profile.bio && (
        <section className="up-sec">
          <h4 className="t-eyebrow">Sobre mim</h4>
          <p className={`up-bio ${compact ? "clamp" : ""}`}>{profile.bio}</p>
        </section>
      )}
      <section className="up-sec">
        <h4 className="t-eyebrow">Membro desde</h4>
        <p className="up-since">{memberSince(profile.createdAt)}</p>
      </section>
    </>
  );
}

function PersonRow({ p, onClick }: { p: Person; onClick: () => void }) {
  return (
    <button className="up-row" onClick={onClick}>
      <Avatar name={shownName(p)} size={32} src={fileUrl(p.avatar)} />
      <span className="up-row-name">{shownName(p)}</span>
    </button>
  );
}

function ServerRow({ s, onClick }: { s: { id: string; name: string }; onClick?: () => void }) {
  const initials = s.name.split(/\s+/).map((w) => [...w][0] ?? "").join("").slice(0, 3).toUpperCase();
  return (
    <button className="up-row" onClick={onClick} disabled={!onClick}>
      <span className="up-server-icon lino" aria-hidden="true">{initials}</span>
      <span className="up-row-name">{s.name}</span>
    </button>
  );
}

// ---------------------------------------------------------------- mini perfil

/** Mini perfil: abre ao lado do que foi clicado (à direita; à esquerda se não couber). */
export function ProfilePopout({
  userId, role, anchor, h, onFull, onClose,
}: {
  userId: string;
  role?: ServerRole;
  /** Retângulo do elemento clicado. Sem ele, abre no centro. */
  anchor?: DOMRect;
  h: ProfileHandlers;
  onFull: () => void;
  onClose: () => void;
}) {
  const { profile, error, run } = useProfile(userId, onClose);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>();
  const [text, setText] = useState("");
  useEscape(onClose);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !profile) return;
    const w = el.offsetWidth, ht = el.offsetHeight, gap = 12, m = 8;
    if (!anchor) return setPos({ left: (innerWidth - w) / 2, top: Math.max(m, (innerHeight - ht) / 2) });
    const right = anchor.right + gap;
    const left = right + w + m <= innerWidth ? right : Math.max(m, anchor.left - gap - w);
    const top = Math.min(Math.max(m, anchor.top), innerHeight - ht - m);
    setPos({ left, top: Math.max(m, top) });
  }, [profile, anchor]);
  if (!profile) return null;
  const mine = userId === h.meId;
  const act = (fn: () => Promise<unknown>) => void run(fn, h.onChanged);
  const send = (e: FormEvent) => {
    e.preventDefault();
    onClose();
    h.onMessage(userId, text.trim() || undefined);
  };
  return (
    <div className="up-layer" onMouseDown={onClose}>
      <div
        ref={box}
        className="up up-popout lino lino-lg"
        style={pos ? { left: pos.left, top: pos.top } : { visibility: "hidden" }}
        role="dialog"
        aria-label={`Perfil de ${shownName(profile)}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <Masthead profile={profile} online={h.online.includes(userId)} size="sm">
          {!mine && (
            <>
              <FriendButton profile={profile} act={act} />
              <MoreMenu profile={profile} act={act} />
            </>
          )}
        </Masthead>
        <div className="up-body">
          <Names profile={profile} role={role} onOpen={onFull} />
          <div className="up-card">
            <About profile={profile} compact />
          </div>
          {mine ? (
            <Button block size="sm" onClick={() => { onClose(); h.onEditProfile(); }}>Editar perfil</Button>
          ) : !profile.blocked ? (
            <form className="up-dm" onSubmit={send}>
              <input className="up-dm-input" value={text} maxLength={2000} placeholder={`Mensagem para @${profile.username}`} onChange={(e) => setText(e.target.value)} aria-label={`Mensagem para ${profile.username}`} />
            </form>
          ) : (
            <p className="t-muted up-note">Você bloqueou essa pessoa.</p>
          )}
          {error && <p className="friends-error" role="alert">{error}</p>}
          <button className="plain-btn up-full-link" onClick={onFull}>Ver perfil completo</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- perfil completo

type Tab = "about" | "servers" | "friends";

/** Perfil completo: banner largo, botões no canto direito e abas. */
export function ProfileModal({ userId, role, h, onOpenUser, onClose }: { userId: string; role?: ServerRole; h: ProfileHandlers; onOpenUser: (id: string) => void; onClose: () => void }) {
  const { profile, error, run } = useProfile(userId, onClose);
  const [tab, setTab] = useState<Tab>("about");
  useEscape(onClose);
  useEffect(() => setTab("about"), [userId]);
  if (!profile) return null;
  const mine = userId === h.meId;
  const act = (fn: () => Promise<unknown>) => void run(fn, h.onChanged);
  const tabs: [Tab, string][] = mine
    ? [["about", "Sobre mim"]]
    : [["about", "Sobre mim"], ["servers", `Servidores em comum — ${profile.mutualServers.length}`], ["friends", `Amigos em comum — ${profile.mutualFriends.length}`]];
  return (
    <div className="t-modal-backdrop" onMouseDown={onClose}>
      <div className="up up-full lino lino-lg" role="dialog" aria-modal="true" aria-label={`Perfil de ${shownName(profile)}`} onMouseDown={(e) => e.stopPropagation()}>
        <Masthead profile={profile} online={h.online.includes(userId)} size="lg" />
        <div className="up-full-actions">
          {mine ? (
            <Button size="sm" onClick={() => { onClose(); h.onEditProfile(); }}>Editar perfil</Button>
          ) : (
            <>
              {!profile.blocked && (
                <Button size="sm" onClick={() => { onClose(); h.onMessage(userId); }}>
                  <Icon name="chat" size={18} /> Mandar mensagem
                </Button>
              )}
              <FriendButton profile={profile} act={act} />
              <MoreMenu profile={profile} act={act} />
            </>
          )}
        </div>
        <div className="up-body up-full-body">
          <Names profile={profile} role={role} />
          {error && <p className="friends-error" role="alert">{error}</p>}
          <div className="up-tabs" role="tablist">
            {tabs.map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={`up-tab ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>{label}</button>
            ))}
          </div>
          <div className="up-tab-body" role="tabpanel">
            {tab === "about" && <About profile={profile} />}
            {tab === "servers" && (profile.mutualServers.length
              ? profile.mutualServers.map((s) => <ServerRow key={s.id} s={s} onClick={h.onOpenServer && (() => { onClose(); h.onOpenServer!(s.id); })} />)
              : <p className="t-muted up-empty">Nenhum servidor em comum.</p>)}
            {tab === "friends" && (profile.mutualFriends.length
              ? profile.mutualFriends.map((p) => <PersonRow key={p.id} p={p} onClick={() => onOpenUser(p.id)} />)
              : <p className="t-muted up-empty">Nenhum amigo em comum.</p>)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- painel da DM

function Fold({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="up-fold">
      <button className="up-fold-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>{title}</span>
        <Icon name={open ? "chevron-down" : "chevron-right"} size={18} />
      </button>
      {open && <div className="up-fold-body">{children}</div>}
    </div>
  );
}

/** Coluna à direita da conversa 1:1, como o painel de perfil do Discord. */
export function DmProfilePanel({ userId, h, onFull, onOpenUser, version }: { userId: string; h: ProfileHandlers; onFull: () => void; onOpenUser: (id: string) => void; version?: number }) {
  // `version` muda quando algo acontece fora (bloqueio pelo popout, amizade aceita na lista): recarrega.
  const { profile, error, run } = useProfile(userId, undefined, version);
  if (!profile) return <aside className="up-panel" aria-label="Perfil" />;
  const act = (fn: () => Promise<unknown>) => void run(fn, h.onChanged);
  return (
    <aside className="up up-panel" aria-label={`Perfil de ${shownName(profile)}`}>
      <Masthead profile={profile} online={h.online.includes(userId)} size="md">
        <FriendButton profile={profile} act={act} />
        <MoreMenu profile={profile} act={act} />
      </Masthead>
      <div className="up-body">
        <Names profile={profile} onOpen={onFull} />
        {error && <p className="friends-error" role="alert">{error}</p>}
        <div className="up-card">
          <About profile={profile} />
        </div>
        <div className="up-card up-card-flush">
          <Fold title={`Servidores em comum — ${profile.mutualServers.length}`}>
            {profile.mutualServers.length ? profile.mutualServers.map((s) => <ServerRow key={s.id} s={s} onClick={h.onOpenServer && (() => h.onOpenServer!(s.id))} />) : <p className="t-muted up-empty">Nenhum.</p>}
          </Fold>
          <Fold title={`Amigos em comum — ${profile.mutualFriends.length}`}>
            {profile.mutualFriends.length ? profile.mutualFriends.map((p) => <PersonRow key={p.id} p={p} onClick={() => onOpenUser(p.id)} />) : <p className="t-muted up-empty">Nenhum.</p>}
          </Fold>
        </div>
      </div>
      <button className="up-panel-foot" onClick={onFull}>Ver perfil completo</button>
    </aside>
  );
}

/** Painel do grupo: lista de quem está na conversa. */
export function DmGroupPanel({ people, online, onProfile }: { people: Person[]; online: string[]; onProfile: (id: string) => void }) {
  const presence = usePresence();
  return (
    <aside className="members up-group" aria-label="Membros do grupo">
      <h3 className="t-eyebrow">Membros — {people.length}</h3>
      {people.map((p) => (
        <div key={p.id} className={`member ${online.includes(p.id) ? "" : "offline"}`} role="button" tabIndex={0} onClick={() => onProfile(p.id)} onKeyDown={(e) => e.key === "Enter" && onProfile(p.id)}>
          <Avatar name={shownName(p)} size={32} src={fileUrl(p.avatar)} status={presence(p.id)} />
          <span className="member-name">{shownName(p)}</span>
        </div>
      ))}
    </aside>
  );
}
