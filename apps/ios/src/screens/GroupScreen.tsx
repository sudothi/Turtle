import { useCallback, useState } from "react";
import { Alert, Pressable, Text } from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { dmTitle, GROUP_MAX_MEMBERS, shownName, type Dm, type Friend } from "@turtle/protocol";
import { useRead, useWorkspace } from "../workspace-context";
import { useAppNavigation, type RootRoutes } from "../navigation/types";
import { Avatar, Content, ListRow, Page, ReadStatus } from "../ui/layout";
import { Button, Field, Notice } from "../ui/components";
import { colors, styles as text } from "../ui/theme";
import { useMutation } from "../use-mutation";

export default function GroupScreen() {
  const { params } = useRoute<RouteProp<RootRoutes, "Group">>();
  const { workspace, user } = useWorkspace();
  const navigation = useAppNavigation();
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState("");
  const operation = useMutation();
  const friends = useRead<Friend[]>([], useCallback(() => workspace.api.friends(), [workspace]));
  const group = useRead<Dm | null>(null, useCallback(async () => params?.channelId ? (await workspace.api.dms()).find(dm => dm.channelId === params.channelId) ?? null : null, [workspace, params?.channelId]));
  const dm = group.data;
  const candidates = friends.data.filter(friend => friend.status === "friend" && !dm?.users.some(member => member.id === friend.user.id));
  return <Page modal><Content>
    <ReadStatus loading={friends.loading || group.loading} error={friends.error || group.error} retry={() => { void friends.refresh(); void group.refresh(); }} />
    <Notice>{operation.error}</Notice>
    {params?.channelId ? dm ? <>
      <Text accessibilityRole="header" style={text.title}>{dmTitle(dm)}</Text>
      <Text style={text.caption}>{dm.users.length + 1} de {GROUP_MAX_MEMBERS} participantes</Text>
      <ListRow title={shownName(user)} detail="Você" leading={<Avatar name={shownName(user)} uri={workspace.api.fileUrl(user.avatar)} />} />
      {dm.users.map(person => <ListRow key={person.id} title={shownName(person)} leading={<Avatar name={shownName(person)} uri={workspace.api.fileUrl(person.avatar)} />} onPress={() => navigation.navigate("Profile", { userId: person.id })} />)}
      {dm.group && <>
        <Button secondary disabled={operation.busy} onPress={() => Alert.alert("Sair do grupo?", "Você deixará de receber mensagens e sairá da chamada deste grupo.", [{ text: "Cancelar", style: "cancel" }, { text: "Sair", style: "destructive", onPress: () => { void operation.run(async () => { await workspace.api.leaveGroup(dm.channelId); if (workspace.voice.getSnapshot().channelId === dm.channelId) await workspace.voice.leave(); navigation.popTo("Main"); }); } }])}>Sair do grupo</Button>
        {dm.users.length + 1 < GROUP_MAX_MEMBERS && <><Text style={text.serverTitle}>Adicionar amigo</Text>{candidates.map(friend => <ListRow key={friend.user.id} title={shownName(friend.user)} detail="Toque para adicionar" onPress={() => { void operation.run(async () => { await workspace.api.addToGroup(dm.channelId, friend.user.id); await group.refresh(); }); }} />)}</>}
      </>}
    </> : !group.loading && <Text style={text.body}>Você não tem mais acesso a esta conversa.</Text> : <>
      <Field label="Nome do grupo (opcional)" value={name} onChangeText={setName} maxLength={40} />
      <Text style={text.caption}>Escolha de 2 a 9 amigos. Você também entra no grupo.</Text>
      {candidates.map(friend => { const checked = selected.includes(friend.user.id); return <Pressable key={friend.user.id} accessibilityRole="checkbox" accessibilityLabel={shownName(friend.user)} accessibilityState={{ checked, disabled: operation.busy }} disabled={operation.busy} onPress={() => setSelected(values => checked ? values.filter(id => id !== friend.user.id) : values.length < GROUP_MAX_MEMBERS - 1 ? [...values, friend.user.id] : values)} style={{ padding: 12, minHeight: 48, backgroundColor: checked ? colors.active : colors.panel, borderRadius: 4 }}><Text style={text.label}>{checked ? "✓ " : ""}{shownName(friend.user)}</Text></Pressable>; })}
      <Button disabled={operation.busy || selected.length < 2} onPress={() => { void operation.run(async () => { const created = await workspace.api.createGroup(selected, name); navigation.replace("Conversation", { channelId: created.channelId, title: dmTitle(created) }); }); }}>Criar grupo</Button>
    </>}
  </Content></Page>;
}
