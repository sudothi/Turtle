import { useEffect, useRef, useState } from "react";
import { AVATAR_MAX_BYTES, BANNER_MAX_BYTES, BIO_MAX, type User } from "@turtle/protocol";
import { Button, TextField } from "@turtle/ui";
import { api } from "../api";
import { ProfileCard } from "./ProfileCard";
import { ImageCropper } from "./ImageCropper";

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
const fmtSize = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${Math.round(n / 1024 / 1024)} MB`);
const mb = (n: number) => `${n / 1024 / 1024} MB`;

/** Configurações > Perfil: nome de exibição, bio, foto e banner, com prévia do cartão. */
export function ProfileSettings({ user, onChanged }: { user: User; onChanged: (u: User) => void }) {
  const [me, setMe] = useState(user);
  const [name, setName] = useState(user.displayName ?? "");
  const [bio, setBio] = useState(user.bio ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [storage, setStorage] = useState<{ used: number; quota: number }>();
  useEffect(() => { api.storage().then(setStorage).catch(() => {}); }, []);
  const [saved, setSaved] = useState(false);
  const [crop, setCrop] = useState<{ kind: "avatar" | "banner"; file: File } | null>(null);
  const avatarInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);

  const apply = (u: User) => { setMe(u); onChanged(u); };
  const run = async (fn: () => Promise<User>) => {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      apply(await fn());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const pick = (kind: "avatar" | "banner", max: number) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > max) return setError(`imagem grande demais (máximo ${mb(max)})`);
    setError("");
    setCrop({ kind, file });
  };
  const cropped = (blob: Blob) => {
    if (!crop) return;
    const kind = crop.kind;
    setCrop(null);
    void run(() => api.uploadImage(kind, new File([blob], `${kind}.png`, { type: "image/png" })));
  };
  const dirty = name.trim() !== (me.displayName ?? "") || bio.trim() !== (me.bio ?? "");

  if (crop) {
    const avatar = crop.kind === "avatar";
    return (
      <ImageCropper
        file={crop.file}
        width={avatar ? 256 : 960}
        height={avatar ? 256 : 320}
        round={avatar}
        title={avatar ? "Recortar foto" : "Recortar banner"}
        onCancel={() => setCrop(null)}
        onDone={cropped}
      />
    );
  }

  return (
    <>
      <div className="profile-editor">
        <div className="profile-form">
          <TextField label="Nome de exibição" value={name} maxLength={32} placeholder={me.username} hint="Aparece no lugar do usuário. Vazio usa o usuário." onChange={(e) => setName(e.target.value)} />
          <label className="t-field">
            <span className="t-field-label">Sobre mim</span>
            <textarea className="profile-bio-input" value={bio} maxLength={BIO_MAX} rows={3} onChange={(e) => setBio(e.target.value)} />
            <span className="t-field-hint">{bio.length}/{BIO_MAX}</span>
          </label>
          <div className="t-field">
            <span className="t-field-label">Foto de perfil</span>
            <div className="profile-actions">
              <Button size="sm" disabled={busy} onClick={() => avatarInput.current?.click()}>{me.avatar ? "Trocar foto" : "Enviar foto"}</Button>
              {me.avatar && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => api.removeImage("avatar"))}>Remover</Button>}
            </div>
            <span className="t-field-hint">PNG, JPEG, WebP ou GIF até {mb(AVATAR_MAX_BYTES)}. Vira um quadrado 256×256.</span>
            <input ref={avatarInput} type="file" accept={ACCEPT} hidden aria-label="Arquivo da foto de perfil" onChange={pick("avatar", AVATAR_MAX_BYTES)} />
          </div>
          <div className="t-field">
            <span className="t-field-label">Banner</span>
            <div className="profile-actions">
              <Button size="sm" disabled={busy} onClick={() => bannerInput.current?.click()}>{me.banner ? "Trocar banner" : "Enviar banner"}</Button>
              {me.banner && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => api.removeImage("banner"))}>Remover</Button>}
            </div>
            <span className="t-field-hint">Até {mb(BANNER_MAX_BYTES)}. Vira 960×320 (proporção 3:1, o centro é mantido).</span>
            <input ref={bannerInput} type="file" accept={ACCEPT} hidden aria-label="Arquivo do banner" onChange={pick("banner", BANNER_MAX_BYTES)} />
          </div>
          <div className="t-field">
            <span className="t-field-label">Armazenamento de anexos</span>
            <span className="t-field-hint">{storage ? `${fmtSize(storage.used)} de ${fmtSize(storage.quota)} usados` : "Calculando…"}</span>
            {storage && <progress value={storage.used} max={storage.quota} aria-label="Uso do armazenamento de anexos" />}
          </div>
          {error && <div className="err" role="alert">{error}</div>}
          <div className="profile-actions">
            <Button disabled={busy || !dirty} onClick={() => void run(async () => { const u = await api.updateProfile({ displayName: name.trim() || null, bio: bio.trim() || null }); setSaved(true); return u; })}>
              {saved && !dirty ? "Salvo" : "Salvar"}
            </Button>
          </div>
        </div>
        <div className="profile-preview">
          <div className="t-eyebrow">Prévia</div>
          <ProfileCard profile={me} preview={{ displayName: name.trim(), bio: bio.trim() }} />
        </div>
      </div>
    </>
  );
}
