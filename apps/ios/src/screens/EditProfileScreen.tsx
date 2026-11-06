import { useRef, useState } from "react";
import { Alert, Image, Text } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { BIO_MAX, shownName } from "@turtle/protocol";
import { useWorkspace } from "../workspace-context";
import { useMutation } from "../use-mutation";
import { session } from "../runtime";
import { Avatar, Content, Page } from "../ui/layout";
import { Button, Field, Notice } from "../ui/components";
import { styles as text } from "../ui/theme";
import ImageCropper, { type CropImage } from "../ui/ImageCropper";

export default function EditProfileScreen() {
  const { workspace, user } = useWorkspace();
  const [name, setName] = useState(user.displayName || "");
  const [bio, setBio] = useState(user.bio || "");
  const [image, setImage] = useState<CropImage>();
  const [saved, setSaved] = useState(false);
  const operation = useMutation();
  const picking = useRef(false);
  const pick = (kind: "avatar" | "banner") => { void operation.run(async () => {
    if (picking.current) return;
    picking.current = true;
    try {
      // Native photo picker grants access to the selected image; no up-front library prompt.
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: false, quality: 1 });
      const asset = result.canceled ? undefined : result.assets[0];
      if (!asset) return;
      const context = ImageManipulator.manipulate(asset.uri);
      if (Math.max(asset.width, asset.height) > 2048) context.resize(asset.width >= asset.height ? { width: 2048 } : { height: 2048 });
      // Decode and save JPEG natively, including HEIC/EXIF, before computing crop coordinates.
      const rendered = await context.renderAsync();
      const normalized = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 1 });
      setImage({ ...normalized, kind });
    } finally { picking.current = false; }
  }); };
  const remove = (kind: "avatar" | "banner") => Alert.alert(`Remover ${kind}?`, "A imagem será removida do seu perfil em todos os aparelhos.", [{ text: "Cancelar", style: "cancel" }, { text: "Remover", style: "destructive", onPress: () => { void operation.run(async () => session.updateUser(await workspace.api.removeImage(kind), workspace.api)); } }]);
  return <Page modal><Content>
    <Notice>{operation.error}</Notice>
    {image ? <ImageCropper key={`${image.uri}:${image.kind}`} image={image} onCancel={() => setImage(undefined)} onSave={async uri => {
      try { session.updateUser(await workspace.api.uploadImage(image.kind, uri), workspace.api); setImage(undefined); workspace.gateway.invalidate(); }
      catch (cause) { await workspace.reject(cause); throw cause; }
    }} /> : <>
      {user.banner && <Image source={{ uri: workspace.api.fileUrl(user.banner) }} accessibilityLabel="Seu banner" style={{ width: "100%", aspectRatio: 3, borderRadius: 4 }} />}
      <Avatar name={shownName(user)} uri={workspace.api.fileUrl(user.avatar)} size={80} />
      <Text style={text.caption}>@{user.username}{user.isAdmin || user.canInvite ? " · Equipe Turtle" : ""}</Text>
      <Field label="Nome de exibição" value={name} onChangeText={value => { setName(value); setSaved(false); }} maxLength={32} placeholder={user.username} />
      <Field label="Sobre mim" value={bio} onChangeText={value => { setBio(value); setSaved(false); }} multiline maxLength={BIO_MAX} />
      <Text style={text.caption}>{bio.length}/{BIO_MAX}</Text>
      <Notice>{saved ? "Perfil salvo." : undefined}</Notice>
      <Button disabled={operation.busy} onPress={() => { void operation.run(async () => { session.updateUser(await workspace.api.updateProfile({ displayName: name.trim() || null, bio: bio.trim() || null }), workspace.api); setSaved(true); }); }}>Salvar perfil</Button>
      <Text style={text.serverTitle}>Imagens</Text>
      <Text style={text.caption}>Avatar: até 2 MB. Banner: até 4 MB. O recorte é convertido em JPEG antes do envio.</Text>
      <Button secondary disabled={operation.busy} onPress={() => pick("avatar")}>Escolher avatar</Button>
      {!!user.avatar && <Button secondary disabled={operation.busy} onPress={() => remove("avatar")}>Remover avatar</Button>}
      <Button secondary disabled={operation.busy} onPress={() => pick("banner")}>Escolher banner</Button>
      {!!user.banner && <Button secondary disabled={operation.busy} onPress={() => remove("banner")}>Remover banner</Button>}
    </>}
  </Content></Page>;
}
