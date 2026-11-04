import { shownName, type ServerRole } from "@turtle/protocol";
import { Avatar, StaffTag } from "@turtle/ui";
import { fileUrl, type Profile } from "../api";

const roleLabel: Record<ServerRole, string> = { owner: "Dono", admin: "Admin", member: "" };

/** Cartão de perfil: banner, foto, nome e bio. Usado na prévia do editor e no popup. */
export function ProfileCard({
  profile,
  role,
  preview,
}: {
  profile: Pick<Profile, "username" | "displayName" | "bio" | "avatar" | "banner"> & { staff?: boolean };
  role?: ServerRole;
  /** Prévia do editor: nome/bio ainda não salvos. */
  preview?: { displayName?: string; bio?: string };
}) {
  const name = preview ? preview.displayName || profile.username : shownName(profile);
  const bio = preview ? preview.bio : profile.bio;
  const banner = fileUrl(profile.banner);
  return (
    <div className="profile-card lino lino-lg">
      <div className={`profile-banner ${banner ? "" : "empty"}`}>{banner && <img src={banner} alt="" draggable={false} />}</div>
      <div className="profile-avatar">
        <Avatar name={name} size={80} src={fileUrl(profile.avatar)} />
      </div>
      <div className="profile-info">
        <h3 className="t-display profile-name">{name} {profile.staff && <StaffTag />}</h3>
        <div className="profile-user t-muted">
          @{profile.username}
          {role && roleLabel[role] && <span className="role-badge"> · {roleLabel[role]}</span>}
        </div>
        {bio ? (
          <>
            <div className="t-eyebrow profile-sec">Sobre mim</div>
            <p className="profile-bio">{bio}</p>
          </>
        ) : null}
      </div>
    </div>
  );
}
