import { useCallback } from "react";
import { Alert, Image, Text } from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { dmTitle, shownName, type ProfileView } from "@turtle/protocol";
import { useRead, useWorkspace } from "../workspace-context";
import { useAppNavigation, type RootRoutes } from "../navigation/types";
import { Avatar, Content, Page, ReadStatus } from "../ui/layout";
import { Button, Notice } from "../ui/components";
import { styles as text } from "../ui/theme";
import { useMutation } from "../use-mutation";

export default function ProfileScreen() {
  const { params } = useRoute<RouteProp<RootRoutes, "Profile">>();
  const { workspace, user } = useWorkspace();
  const navigation = useAppNavigation();
  const profile = useRead<ProfileView | null>(null, useCallback(() => workspace.api.profile(params.userId), [workspace, params.userId]));
  const operation = useMutation();
  const person = profile.data;
  const change = (action: () => Promise<unknown>) => { void operation.run(async () => { await action(); await profile.refresh(); }); };
  return <Page modal><Content>
    <ReadStatus loading={profile.loading} error={profile.error} retry={profile.refresh} />
    <Notice>{operation.error}</Notice>
    {person && <>
      {person.banner && <Image source={{ uri: workspace.api.fileUrl(person.banner) }} accessibilityLabel="Banner do perfil" style={{ width: "100%", aspectRatio: 3, borderRadius: 4 }} />}
      <Avatar name={shownName(person)} uri={workspace.api.fileUrl(person.avatar)} size={80} />
      <Text accessibilityRole="header" style={text.title}>{shownName(person)}</Text>
      <Text style={text.caption}>@{person.username}{person.staff ? " · Equipe Turtle" : ""}</Text>
      {!!person.bio && <Text selectable style={text.body}>{person.bio}</Text>}
      <Text style={text.caption}>No Turtle desde {new Date(person.createdAt).toLocaleDateString("pt-BR")}</Text>
      {!!person.mutualServers.length && <><Text style={text.serverTitle}>Servidores em comum</Text>{person.mutualServers.map(server => <Text key={server.id} style={text.body}>{server.name}</Text>)}</>}
      {!!person.mutualFriends.length && <><Text style={text.serverTitle}>Amigos em comum</Text>{person.mutualFriends.map(friend => <Text key={friend.id} style={text.body}>{shownName(friend)}</Text>)}</>}
      {person.id !== user.id && <>
        <Button disabled={operation.busy || person.blocked} onPress={() => change(async () => { const dm = await workspace.api.openDm(person.id); navigation.navigate("Conversation", { channelId: dm.channelId, title: dmTitle(dm) }); })}>Mandar mensagem</Button>
        {!person.blocked && (person.friendship === "none" || person.friendship === "incoming") && <Button secondary disabled={operation.busy} onPress={() => change(() => workspace.api.addFriend(person.id))}>{person.friendship === "incoming" ? "Aceitar pedido" : "Adicionar amigo"}</Button>}
        {person.friendship !== "none" && <Button secondary disabled={operation.busy} onPress={() => Alert.alert(person.friendship === "friend" ? "Remover amizade?" : "Cancelar pedido?", shownName(person), [{ text: "Cancelar", style: "cancel" }, { text: person.friendship === "incoming" ? "Recusar pedido" : "Confirmar", style: "destructive", onPress: () => change(() => workspace.api.removeFriend(person.id)) }])}>{person.friendship === "friend" ? "Remover amigo" : person.friendship === "incoming" ? "Recusar pedido" : "Cancelar pedido enviado"}</Button>}
        <Button secondary disabled={operation.busy} onPress={() => person.blocked ? change(() => workspace.api.unblock(person.id)) : Alert.alert("Bloquear pessoa?", "Ela não poderá enviar mensagens ou entrar em chamadas com você em uma DM individual. Grupos continuam seguindo as regras do servidor.", [{ text: "Cancelar", style: "cancel" }, { text: "Bloquear", style: "destructive", onPress: () => change(() => workspace.api.block(person.id)) }])}>{person.blocked ? "Desbloquear" : "Bloquear"}</Button>
      </>}
    </>}
  </Content></Page>;
}
