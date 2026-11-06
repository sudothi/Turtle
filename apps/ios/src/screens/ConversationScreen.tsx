import { useCallback, useMemo, useRef } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { shownName, splitMentions, type Message } from "@turtle/protocol";
import { useRead, useWorkspace } from "../workspace-context";
import { useAppNavigation, type RootRoutes } from "../navigation/types";
import { CallDock } from "../navigation/call-access";
import { Avatar, Empty, layout, Page, ReadStatus } from "../ui/layout";
import { styles as text, colors, fonts } from "../ui/theme";
import { Icon } from "../ui/Icon";

const timestamp = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
function stamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : timestamp.format(date);
}

export default function ConversationScreen() {
  const { params } = useRoute<RouteProp<RootRoutes, "Conversation">>();
  const navigation = useAppNavigation();
  const { workspace, user } = useWorkspace();
  const messages = useRead<Message[]>([], useCallback(() => workspace.api.messages(params.channelId), [workspace, params.channelId]));
  const list = useRef<FlatList<Message>>(null);
  const nearBottom = useRef(true);
  const names = useMemo(() => new Map([[user.id, shownName(user)], ...messages.data.map(message => [message.userId, shownName(message)] as [string, string])]), [messages.data, user]);
  return <Page>
    <FlatList ref={list} data={messages.data} keyExtractor={message => message.id}
      contentContainerStyle={s.messages} keyboardDismissMode="interactive"
      refreshControl={<RefreshControl refreshing={messages.loading} onRefresh={messages.refresh} tintColor={colors.paper} />}
      onScroll={({ nativeEvent }) => { nearBottom.current = nativeEvent.contentSize.height - nativeEvent.layoutMeasurement.height - nativeEvent.contentOffset.y < 80; }}
      scrollEventThrottle={100}
      onContentSizeChange={() => { if (nearBottom.current && messages.data.length) list.current?.scrollToEnd({ animated: false }); }}
      ListHeaderComponent={<View style={s.welcome}>
        <View style={s.welcomeIcon}><Icon name={params.serverId ? "hash" : "chat"} size={36} color={colors.paper} /></View>
        <Text accessibilityRole="header" style={text.title}>{params.serverId ? `# ${params.title}` : params.title}</Text>
        <ReadStatus loading={messages.loading && !messages.data.length} error={messages.error} retry={messages.refresh} />
      </View>}
      ListEmptyComponent={!messages.loading && !messages.error ? <View style={{ padding: 16 }}><Empty title="Conversa sem mensagens">As mensagens desta conversa aparecerão aqui.</Empty></View> : undefined}
      renderItem={({ item, index }) => {
        const previous = messages.data[index - 1];
        const gap = Date.parse(item.createdAt) - Date.parse(previous?.createdAt || "");
        const grouped = previous?.userId === item.userId && gap >= 0 && gap < 5 * 60_000 && item.createdAt.slice(0, 10) === previous.createdAt.slice(0, 10);
        return <View style={[s.message, !grouped && { marginTop: 16 }]}>
          <View style={{ width: 40 }}>{!grouped && <Avatar name={shownName(item)} uri={workspace.api.fileUrl(item.avatar)} />}</View>
          <View style={[layout.rowText, { gap: 2 }]}>
            {!grouped && <Text style={[text.label, { fontFamily: fonts.bold }]}>{shownName(item)} <Text style={[text.caption, { color: colors.faint }]}>{stamp(item.createdAt)}</Text></Text>}
            {!!item.content && <Text selectable style={s.body}>{splitMentions(item.content).map(part => "text" in part ? part.text : `@${names.get(part.userId) || "pessoa"}`).join("")}{item.editedAt && <Text style={text.caption}> (editado)</Text>}</Text>}
            {item.attachments.map(attachment => <View key={attachment.id} style={s.attachment}><Icon name="file" /><Text style={[text.caption, { flex: 1 }]}>{attachment.name}</Text></View>)}
          </View>
        </View>;
      }}
    />
    <CallDock onOpen={() => navigation.navigate("Call")} />
  </Page>;
}
const s = StyleSheet.create({
  messages: { flexGrow: 1, paddingTop: 16, paddingBottom: 24 },
  welcome: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, gap: 8 },
  welcomeIcon: { width: 68, height: 68, borderRadius: 34, alignItems: "center", justifyContent: "center", backgroundColor: colors.elevated },
  message: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 2, paddingHorizontal: 16 },
  body: { fontFamily: fonts.body, fontSize: 16, color: colors.paperDim, lineHeight: 22 },
  attachment: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: colors.line, borderRadius: 4, backgroundColor: colors.panel, padding: 10, marginTop: 4 },
});
