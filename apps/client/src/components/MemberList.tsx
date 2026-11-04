import type { Member } from "@turtle/protocol";
import { Avatar } from "@turtle/ui";

const byName = (a: Member, b: Member) => a.username.localeCompare(b.username, "pt-BR");
const badge = { owner: "Dono", admin: "Admin", member: "" } as const;

/** Membros do servidor atual, separados entre online e offline (presença vem do gateway). */
export function MemberList({ members, online }: { members: Member[]; online: string[] }) {
  const on = new Set(online);
  const here = members.filter((m) => on.has(m.username)).sort(byName);
  const away = members.filter((m) => !on.has(m.username)).sort(byName);
  const row = (m: Member, isOnline: boolean) => (
    <div key={m.userId} className={`member ${isOnline ? "" : "offline"}`}>
      <Avatar name={m.username} size={32} status={isOnline ? "online" : undefined} statusRing="var(--bg-sidebar)" />
      <span className="member-name">{m.username}</span>
      {badge[m.role] && <span className="role-badge t-muted">{badge[m.role]}</span>}
    </div>
  );
  return (
    <aside className="members" aria-label="Membros">
      <h3 className="t-eyebrow">Online — {here.length}</h3>
      {here.map((m) => row(m, true))}
      {away.length > 0 && <h3 className="t-eyebrow">Offline — {away.length}</h3>}
      {away.map((m) => row(m, false))}
    </aside>
  );
}
