import { useCallback, useState } from "react";
import { RefreshControl, Text } from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { shownName, type Member } from "@turtle/protocol";
import { usePresence, useRead, useWorkspace } from "../workspace-context";
import type { RootRoutes } from "../navigation/types";
import { CallDock } from "../navigation/call-access";
import { Field } from "../ui/components";
import { Avatar, Content, Empty, ListRow, Page, ReadStatus } from "../ui/layout";
import { colors, styles as text } from "../ui/theme";

const roleLabel = { owner: "Dono", admin: "Administrador", member: "Membro" };
const roleOrder = { owner: 0, admin: 1, member: 2 };
export default function MembersScreen() {
  const { params } = useRoute<RouteProp<RootRoutes, "Members">>();
  const { workspace } = useWorkspace();
  const presence = usePresence();
  const members = useRead<Member[]>([], useCallback(() => workspace.api.members(params.serverId), [workspace, params.serverId]));
  const [query, setQuery] = useState("");
  const search = query.trim().toLocaleLowerCase("pt-BR");
  const matching = members.data.filter(member => `${shownName(member)} ${member.username}`.toLocaleLowerCase("pt-BR").includes(search))
    .sort((a, b) => roleOrder[a.role] - roleOrder[b.role] || shownName(a).localeCompare(shownName(b), "pt-BR"));
  return <Page modal>
    <Content refreshControl={<RefreshControl refreshing={members.loading} onRefresh={members.refresh} tintColor={colors.paper} />}>
      <Text style={text.body}>{params.title}</Text>
      <Field label="Buscar membros" value={query} onChangeText={setQuery} placeholder="Nome ou usuário" returnKeyType="search" />
      <ReadStatus loading={members.loading && !members.data.length} error={members.error} retry={members.refresh} />
      {matching.map(member => <ListRow key={member.userId} title={shownName(member)}
        detail={`@${member.username} · ${roleLabel[member.role]} · ${presence.busy.includes(member.userId) ? "Não perturbe" : presence.online.includes(member.userId) ? "Online" : "Offline"}`}
        leading={<Avatar name={shownName(member)} uri={workspace.api.fileUrl(member.avatar)} />}
      />)}
      {!members.loading && !members.error && !matching.length && <Empty title="Nenhum membro encontrado">Tente outro nome ou atualize esta lista.</Empty>}
    </Content>
    <CallDock />
  </Page>;
}
