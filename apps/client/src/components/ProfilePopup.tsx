import { useEffect, useState } from "react";
import type { ServerRole } from "@turtle/protocol";
import { api, type Profile } from "../api";
import { ProfileCard } from "./ProfileCard";

/** Cartão de perfil de alguém, aberto ao clicar no nome ou na foto. */
export function ProfilePopup({ userId, role, onClose }: { userId: string; role?: ServerRole; onClose: () => void }) {
  const [profile, setProfile] = useState<Profile>();
  useEffect(() => {
    api.profile(userId).then(setProfile).catch(onClose);
  }, [userId, onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!profile) return null;
  return (
    <div className="t-modal-backdrop" onMouseDown={onClose}>
      <div className="profile-popup" role="dialog" aria-modal="true" aria-label={`Perfil de ${profile.username}`} onMouseDown={(e) => e.stopPropagation()}>
        <ProfileCard profile={profile} role={role} />
      </div>
    </div>
  );
}
