import { ActionSheetIOS, RefreshControl, Text, View } from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { shownName } from "@turtle/protocol";
import { useCall, useDirectory, usePresence, useWorkspace } from "../workspace-context";
import { useAppNavigation, type ServerRoutes } from "../navigation/types";
import { useJoinCall } from "../navigation/call-access";
import { Avatar, Content, Empty, layout, ListRow, Page, ReadStatus, ToolbarButton } from "../ui/layout";
import { styles as text, colors } from "../ui/theme";

export function ServersScreen() {
  const directory = useDirectory();
  const { workspace, user } = useWorkspace();
  const navigation = useAppNavigation();
  return <Page><Content refreshControl={<RefreshControl refreshing={directory.loading} onRefresh={workspace.directory.refresh} tintColor={colors.paper} />}>
    <Text style={text.body}>Sua turma, seus lugares. Olá, {shownName(user)}.</Text>
    <ReadStatus loading={directory.loading && !directory.data.length} error={directory.error} retry={workspace.directory.refresh} />
    {!directory.loading && !directory.data.length && !directory.error && <Empty title="Ainda sem servidores">Entre em um servidor pelo Turtle no navegador ou desktop e atualize esta lista.</Empty>}
    {directory.data.map(({ server, channels }) => <ListRow key={server.id} title={server.name} detail={`${channels.length} canais`} leading={<Avatar name={server.name} uri={workspace.api.fileUrl(server.icon)} />} onPress={() => navigation.navigate("Channels", { serverId: server.id, title: server.name })} />)}
  </Content></Page>;
}

export function ChannelsScreen() {
  const { params } = useRoute<RouteProp<ServerRoutes, "Channels">>();
  const directory = useDirectory();
  const { workspace } = useWorkspace();
  const presence = usePresence();
  const call = useCall();
  const navigation = useAppNavigation();
  const join = useJoinCall();
  const entry = directory.data.find(value => value.server.id === params.serverId);
  return <Page><Content refreshControl={<RefreshControl refreshing={directory.loading} onRefresh={workspace.directory.refresh} tintColor={colors.paper} />}>
    <ReadStatus loading={directory.loading && !entry} error={directory.error} retry={workspace.directory.refresh} />
    {!entry && !directory.loading && <Empty title="Servidor indisponível">Atualize a lista ou volte para escolher outro servidor.</Empty>}
    {entry && <>
      <Text style={text.body}>{entry.server.name}</Text>
      <View style={layout.section}>
        <Text accessibilityRole="header" style={text.serverTitle}>Canais de texto</Text>
        {entry.channels.filter(channel => channel.kind === "text").map(channel => <ListRow key={channel.id} title={`# ${channel.name}`} onPress={() => navigation.navigate("Conversation", { channelId: channel.id, title: channel.name, serverId: entry.server.id })} />)}
      </View>
      <View style={layout.section}>
        <Text accessibilityRole="header" style={text.serverTitle}>Canais de voz</Text>
        {entry.channels.filter(channel => channel.kind === "voice").map(channel => <ListRow key={channel.id} title={channel.name} detail={call.channelId === channel.id ? "Sua chamada atual" : `${presence.states.filter(member => member.channelId === channel.id).length} na conversa`} selected={call.channelId === channel.id} onPress={() => join(channel.id, channel.name)} />)}
      </View>
      {!entry.channels.length && <Empty title="Nenhum canal por aqui">Os canais criados no servidor aparecerão nesta lista.</Empty>}
    </>}
  </Content></Page>;
}

export function ServerActions({ serverId, title }: { serverId: string; title: string }) {
  const navigation = useAppNavigation();
  const { workspace } = useWorkspace();
  return <ToolbarButton label="Mais" onPress={() => ActionSheetIOS.showActionSheetWithOptions({ title, options: ["Ver membros", "Atualizar canais", "Cancelar"], cancelButtonIndex: 2 }, choice => {
    if (choice === 0) navigation.navigate("Members", { serverId, title });
    if (choice === 1) { void workspace.directory.refresh(); }
  })} />;
}
export function MembersAction({ serverId, title }: { serverId: string; title: string }) {
  const navigation = useAppNavigation();
  return <ToolbarButton label="Membros" onPress={() => navigation.navigate("Members", { serverId, title })} />;
}
