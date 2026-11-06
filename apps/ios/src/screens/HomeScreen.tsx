import { useCallback, useState } from "react";
import { Pressable, RefreshControl, Text, View } from "react-native";
import { dmTitle, shownName, type Dm, type Friend } from "@turtle/protocol";
import { usePresence, useRead, useWorkspace } from "../workspace-context";
import { Field } from "../ui/components";
import { Avatar, Content, Empty, layout, ListRow, Page, ReadStatus } from "../ui/layout";
import { styles as text, colors } from "../ui/theme";
import { useAppNavigation } from "../navigation/types";

export default function HomeScreen() {
  const { user, workspace } = useWorkspace();
  const navigation = useAppNavigation();
  const presence = usePresence();
  const [tab, setTab] = useState<"conversations" | "friends">("conversations");
  const [query, setQuery] = useState("");
  const conversations = useRead<Dm[]>([], useCallback(() => workspace.api.dms(), [workspace]));
  const friends = useRead<Friend[]>([], useCallback(() => workspace.api.friends(), [workspace]));
  const active = tab === "conversations" ? conversations : friends;
  const search = query.trim().toLocaleLowerCase("pt-BR");
  const matchingConversations = conversations.data.filter(dm => `${dmTitle(dm)} ${dm.users.map(person => person.username).join(" ")}`.toLocaleLowerCase("pt-BR").includes(search));
  const matchingFriends = friends.data.filter(friend => `${shownName(friend.user)} ${friend.user.username}`.toLocaleLowerCase("pt-BR").includes(search));
  return <Page><Content refreshControl={<RefreshControl refreshing={active.loading} onRefresh={active.refresh} tintColor={colors.paper} />}>
    <Text accessibilityRole="header" style={text.title}>Olá, {shownName(user)}.</Text>
    <Text style={text.body}>As conversas continuam por aqui.</Text>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {(["conversations", "friends"] as const).map(value => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: tab === value }} onPress={() => { setTab(value); setQuery(""); }} style={[layout.toolbar, { borderBottomWidth: 2, borderColor: tab === value ? colors.paper : colors.line }]}><Text style={text.label}>{value === "conversations" ? "Conversas" : "Amigos"}</Text></Pressable>)}
    </View>
    <Field label={tab === "conversations" ? "Buscar conversas" : "Buscar amigos"} value={query} onChangeText={setQuery} placeholder="Nome ou usuário" returnKeyType="search" />
    <ReadStatus loading={active.loading && !active.data.length} error={active.error} retry={active.refresh} />
    {tab === "conversations" && matchingConversations.map(dm => <ListRow
      key={dm.channelId} title={dmTitle(dm)} detail={dm.group ? `${dm.users.length + 1} participantes` : "Conversa direta"}
      leading={<Avatar name={dmTitle(dm)} uri={dm.group ? undefined : workspace.api.fileUrl(dm.users[0]?.avatar)} />}
      onPress={() => navigation.navigate("Conversation", { channelId: dm.channelId, title: dmTitle(dm) })}
    />)}
    {tab === "friends" && matchingFriends.map(({ user: friend, status }) => <ListRow key={friend.id}
      title={shownName(friend)} detail={`@${friend.username} · ${status === "incoming" ? "Pedido recebido" : status === "outgoing" ? "Pedido enviado" : presence.busy.includes(friend.id) ? "Não perturbe" : presence.online.includes(friend.id) ? "Online" : "Offline"}`}
      leading={<Avatar name={shownName(friend)} uri={workspace.api.fileUrl(friend.avatar)} />}
    />)}
    {!active.loading && !active.error && (tab === "conversations" ? !matchingConversations.length : !matchingFriends.length) && <Empty title={search ? "Nenhum resultado" : tab === "conversations" ? "Nenhuma conversa ainda" : "Sua lista está vazia"}>{search ? "Tente outro nome ou usuário." : "Suas conversas e amizades do Turtle aparecem aqui quando disponíveis."}</Empty>}
  </Content></Page>;
}
