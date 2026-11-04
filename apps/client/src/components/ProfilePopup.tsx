import { useCallback, useEffect, useState } from "react";
import type { Friend, ServerRole } from "@turtle/protocol";
import { Button } from "@turtle/ui";
import { api, type Profile } from "../api";
import { ProfileCard } from "./ProfileCard";

/** Cartão de perfil de alguém, aberto ao clicar no nome ou na foto. */
export function ProfilePopup({
  userId, role, meId, onMessage, onChanged, onClose,
}: {
  userId: string;
  role?: ServerRole;
  meId: string;
  /** Abre (ou cria) a conversa direta com essa pessoa. */
  onMessage: (userId: string) => void;
  /** Amizade mudou: o Início recarrega a lista. */
  onChanged: () => void;
  onClose: () => void;
}) {
  const [profile, setProfile] = useState<Profile>();
  const [status, setStatus] = useState<Friend["status"] | "none">("none");
  const [error, setError] = useState<string>();
  const loadStatus = useCallback(() => {
    api.friends().then((l) => setStatus(l.find((f) => f.user.id === userId)?.status ?? "none")).catch(() => {});
  }, [userId]);
  useEffect(() => {
    api.profile(userId).then(setProfile).catch(onClose);
    loadStatus();
  }, [userId, onClose, loadStatus]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!profile) return null;

  const run = async (fn: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
    loadStatus();
    onChanged();
  };
  const mine = userId === meId;
  return (
    <div className="t-modal-backdrop" onMouseDown={onClose}>
      <div className="profile-popup" role="dialog" aria-modal="true" aria-label={`Perfil de ${profile.username}`} onMouseDown={(e) => e.stopPropagation()}>
        <ProfileCard profile={profile} role={role} />
        {!mine && (
          <div className="profile-actions">
            <Button onClick={() => { onClose(); onMessage(userId); }}>Mandar mensagem</Button>
            {status === "none" && <Button variant="ghost" onClick={() => run(() => api.addFriend(userId))}>Adicionar amigo</Button>}
            {status === "outgoing" && <Button variant="ghost" onClick={() => run(() => api.removeFriend(userId))}>Pedido enviado (cancelar)</Button>}
            {status === "incoming" && <Button variant="ghost" onClick={() => run(() => api.addFriend(userId))}>Aceitar pedido de amizade</Button>}
            {status === "friend" && <Button variant="ghost" onClick={() => run(() => api.removeFriend(userId))}>Amigos · desfazer</Button>}
            {error && <p className="friends-error" role="alert">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
