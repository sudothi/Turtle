import { Avatar } from "@turtle/ui";

export function MemberList({ online }: { online: string[] }) {
  const sorted = [...online].sort((a, b) => a.localeCompare(b, "pt-BR"));
  return (
    <aside className="members" aria-label="Membros">
      <h3 className="t-eyebrow">Online — {sorted.length}</h3>
      {sorted.map((n) => (
        <div key={n} className="member">
          <Avatar name={n} size={32} status="online" statusRing="var(--bg-sidebar)" />
          <span className="member-name">{n}</span>
        </div>
      ))}
    </aside>
  );
}
