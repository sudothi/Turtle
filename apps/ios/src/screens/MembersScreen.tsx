import { useCallback, useState } from "react";
import { RefreshControl, Text, TextInput, View } from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { shownName, type Member } from "@turtle/protocol";
import { usePresence, useRead, useWorkspace } from "../workspace-context";
import { useAppNavigation, type RootRoutes } from "../navigation/types";
import { CallDock } from "../navigation/call-access";
import { Avatar, Content, Empty, ListRow, Page, ReadStatus } from "../ui/layout";
import { colors, styles as text } from "../ui/theme";

const roleLabel = { owner: "Dono", admin: "Administrador", member: "Membro" };
const roleOrder = { owner: 0, admin: 1, member: 2 };
export default function MembersScreen() {
  const { params } = useRoute<RouteProp<RootRoutes, "Members">>();
  const { workspace } = useWorkspace();
  const navigation = useAppNavigation();
  const presence = usePresence();
  const members = useRead<Member[]>([], useCallback(() => workspace.api.members(params.serverId), [workspace, params.serverId]));
  const [query, setQuery] = useState("");
  const search = query.trim().toLocaleLowerCase("pt-BR");
  const matching = members.data.filter(member => `${shownName(member)} ${member.username}`.toLocaleLowerCase("pt-BR").includes(search))
    .sort((a, b) => roleOrder[a.role] - roleOrder[b.role] || shownName(a).localeCompare(shownName(b), "pt-BR"));
  return <Page modal>
    <Content refreshControl={<RefreshControl refreshing={members.loading} onRefresh={members.refresh} tintColor={colors.paper} />}>
      <TextInput accessibilityLabel="Buscar membros" value={query} onChangeText={setQuery} placeholder="Buscar membros" placeholderTextColor={colors.faint} autoCorrect={false} autoCapitalize="none" returnKeyType="search" style={text.input} />
      <ReadStatus loading={members.loading && !members.data.length} error={members.error} retry={members.refresh} />
      {(["owner", "admin", "member"] as const).map(role => {
        const group = matching.filter(member => member.role === role);
        return group.length ? <View key={role} style={{ gap: 4, marginTop: 12 }}><Text accessibilityRole="header" style={text.serverTitle}>{roleLabel[role]} — {group.length}</Text>{group.map(member => <ListRow key={member.userId} title={shownName(member)}
          detail={presence.busy.includes(member.userId) ? "Não perturbe" : presence.online.includes(member.userId) ? "Online" : "Offline"}
          leading={<Avatar name={shownName(member)} uri={workspace.api.fileUrl(member.avatar)} size={32} online={presence.online.includes(member.userId)} />}
          onPress={() => navigation.navigate("Profile", { userId: member.userId })}
        />)}</View> : null;
      })}
      {!members.loading && !members.error && !matching.length && <Empty title="Nenhum membro encontrado">Tente outro nome ou atualize esta lista.</Empty>}
    </Content>
    <CallDock onOpen={() => navigation.navigate("Call")} />
  </Page>;
}
