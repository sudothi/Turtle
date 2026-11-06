import { useCallback, useState } from "react";
import { Pressable, RefreshControl, Text, TextInput, View } from "react-native";
import { shownName, type Friend } from "@turtle/protocol";
import { usePresence, useRead, useWorkspace } from "../workspace-context";
import { Avatar, Content, Empty, ListRow, Page, ReadStatus } from "../ui/layout";
import { styles as text, colors } from "../ui/theme";
import { useAppNavigation } from "../navigation/types";
import { PersonRow } from "../ui/PersonRow";
import { useMutation } from "../use-mutation";
import { Button, Field, Notice } from "../ui/components";
import { CallDock } from "../navigation/call-access";

export default function FriendsScreen() {
  const { workspace } = useWorkspace();
  const navigation = useAppNavigation();
  const presence = usePresence();
  const [tab, setTab] = useState<"online" | "all" | "pending">("online");
  const operation = useMutation();
  const [username, setUsername] = useState("");
  const [feedback, setFeedback] = useState<string>();
  const [query, setQuery] = useState("");
  const friends = useRead<Friend[]>([], useCallback(() => workspace.api.friends(), [workspace]));
  const search = query.trim().toLocaleLowerCase("pt-BR");
  const matching = friends.data.filter(friend => {
    const accepted = friend.status === "friend";
    const visible = tab === "pending" ? !accepted : accepted && (tab === "all" || presence.online.includes(friend.user.id));
    return visible && `${shownName(friend.user)} ${friend.user.username}`.toLocaleLowerCase("pt-BR").includes(search);
  });
  return <Page>
    <View style={{ paddingHorizontal: 16, paddingBottom: 8, backgroundColor: colors.panel, borderBottomWidth: 2, borderColor: colors.rail, flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
      {([['online', 'Online'], ['all', 'Todos'], ['pending', 'Pendentes']] as const).map(([value, label]) => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: tab === value }} onPress={() => setTab(value)} style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 12, justifyContent: "center", borderRadius: 4, backgroundColor: tab === value || pressed ? colors.hover : "transparent" })}><Text style={[text.label, { color: tab === value ? colors.paper : colors.muted, fontSize: 14 }]}>{label}</Text></Pressable>)}
    </View>
    <Content refreshControl={<RefreshControl refreshing={friends.loading} onRefresh={friends.refresh} tintColor={colors.paper} />}>
      <Field label="Adicionar por nome de usuário" value={username} onChangeText={setUsername} maxLength={24} />
      <Notice>{operation.error || feedback}</Notice>
      <Button secondary disabled={operation.busy || !username.trim()} onPress={() => { void operation.run(async () => { const result = await workspace.api.addFriendByName(username); setFeedback(result.status === "friend" ? "Pedido aceito. Vocês são amigos." : "Pedido enviado."); setUsername(""); await friends.refresh(); }); }}>Adicionar amigo</Button>
      <Button secondary onPress={() => navigation.navigate("Group")}>Criar grupo</Button>
      <TextInput accessibilityLabel="Buscar amigos" value={query} onChangeText={setQuery} placeholder="Buscar amigos" placeholderTextColor={colors.faint} autoCorrect={false} autoCapitalize="none" returnKeyType="search" style={text.input} />
      <ReadStatus loading={friends.loading && !friends.data.length} error={friends.error} retry={friends.refresh} />
      <Text accessibilityRole="header" style={text.serverTitle}>{tab === "online" ? "Online" : tab === "all" ? "Todos os amigos" : "Pendentes"} — {matching.length}</Text>
      {matching.map(({ user: friend, status }) => <PersonRow userId={friend.id} key={friend.id} title={shownName(friend)}
        detail={status === "incoming" ? "Pedido recebido" : status === "outgoing" ? "Pedido enviado" : undefined}
        leading={<Avatar name={shownName(friend)} uri={workspace.api.fileUrl(friend.avatar)} online={presence.online.includes(friend.id)} />}
        onPress={() => navigation.navigate("Profile", { userId: friend.id })}
      />)}
      {!friends.loading && !friends.error && !matching.length && <Empty title={search ? "Nenhum resultado" : tab === "online" ? "Nenhum amigo online" : tab === "pending" ? "Nenhum pedido pendente" : "Nenhum amigo ainda"}>{search ? "Tente outro nome ou usuário." : "Seus amigos aparecem aqui quando disponíveis."}</Empty>}
    </Content>
    <CallDock onOpen={() => navigation.navigate("Call")} />
  </Page>;
}
