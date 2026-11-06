import { useCallback, useMemo, useRef } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { shownName, splitMentions, type Message } from "@turtle/protocol";
import { useRead, useWorkspace } from "../workspace-context";
import type { HomeRoutes } from "../navigation/types";
import { Avatar, Empty, layout, Page, ReadStatus } from "../ui/layout";
import { styles as text, colors } from "../ui/theme";

const timestamp = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
function stamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : timestamp.format(date);
}

export default function ConversationScreen() {
  const { params } = useRoute<RouteProp<HomeRoutes, "Conversation">>();
  const { workspace, user } = useWorkspace();
  const messages = useRead<Message[]>([], useCallback(() => workspace.api.messages(params.channelId), [workspace, params.channelId]));
  const list = useRef<FlatList<Message>>(null);
  const nearBottom = useRef(true);
  const names = useMemo(() => new Map([[user.id, shownName(user)], ...messages.data.map(message => [message.userId, shownName(message)] as [string, string])]), [messages.data, user]);
  return <Page>
    <FlatList ref={list} data={messages.data} keyExtractor={message => message.id}
      contentContainerStyle={layout.content} keyboardDismissMode="interactive"
      refreshControl={<RefreshControl refreshing={messages.loading} onRefresh={messages.refresh} tintColor={colors.paper} />}
      onScroll={({ nativeEvent }) => { nearBottom.current = nativeEvent.contentSize.height - nativeEvent.layoutMeasurement.height - nativeEvent.contentOffset.y < 80; }}
      scrollEventThrottle={100}
      onContentSizeChange={() => { if (nearBottom.current && messages.data.length) list.current?.scrollToEnd({ animated: false }); }}
      ListHeaderComponent={<View style={layout.section}><Text style={text.caption}>Histórico recente</Text><ReadStatus loading={messages.loading && !messages.data.length} error={messages.error} retry={messages.refresh} /></View>}
      ListEmptyComponent={!messages.loading && !messages.error ? <Empty title="Conversa sem mensagens">As mensagens desta conversa aparecerão aqui.</Empty> : undefined}
      renderItem={({ item }) => <View style={s.message}>
        <Avatar name={shownName(item)} uri={workspace.api.fileUrl(item.avatar)} />
        <View style={layout.rowText}>
          <Text style={text.label}>{shownName(item)} <Text style={text.caption}>{stamp(item.createdAt)}{item.editedAt ? " · editado" : ""}</Text></Text>
          {!!item.content && <Text selectable style={s.body}>{splitMentions(item.content).map(part => "text" in part ? part.text : `@${names.get(part.userId) || "pessoa"}`).join("")}</Text>}
          {item.attachments.map(attachment => <Text key={attachment.id} style={text.caption}>Anexo: {attachment.name}</Text>)}
        </View>
      </View>}
    />
  </Page>;
}
const s = StyleSheet.create({
  message: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 8 },
  body: { fontSize: 16, color: colors.paper, lineHeight: 24 },
});
