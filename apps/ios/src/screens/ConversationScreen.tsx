import { useCallback, useMemo, useRef } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Pressable, StyleSheet, Text, View } from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { shownName, splitMentions, type Message, type Person } from "@turtle/protocol";
import { useConversation, usePresence, useRead, useWorkspace } from "../workspace-context";
import { useAppNavigation, type RootRoutes } from "../navigation/types";
import { CallDock } from "../navigation/call-access";
import { Avatar, Empty, layout, Page, ToolbarButton } from "../ui/layout";
import { Notice } from "../ui/components";
import { styles as text, colors, fonts } from "../ui/theme";
import { Icon } from "../ui/Icon";
import Composer from "../chat/Composer";
import type { PendingSend } from "../chat/conversation";

const timestamp = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
function stamp(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : timestamp.format(date); }
type Row = { kind: "message"; id: string; value: Message } | { kind: "pending"; id: string; value: PendingSend };
function MessageBody({ content, names }: { content: string; names: Map<string, string> }) {
  return <Text selectable style={s.body}>{splitMentions(content).map((part, i) => "text" in part ? part.text : <Text key={i} style={s.mention}>@{names.get(part.userId) || "pessoa"}</Text>)}</Text>;
}

export default function ConversationScreen() {
  const { params } = useRoute<RouteProp<RootRoutes, "Conversation">>();
  const navigation = useAppNavigation();
  const headerHeight = useHeaderHeight();
  const { workspace, user } = useWorkspace();
  const presence = usePresence();
  const state = useConversation(params.channelId);
  const { conversation } = state;
  const list = useRef<FlatList<Row>>(null);
  const people = useRead<Person[]>([], useCallback(async () => {
    const own: Person = { id: user.id, username: user.username, displayName: user.displayName, avatar: user.avatar };
    if (params.serverId) return (await workspace.api.members(params.serverId)).map(member => ({ id: member.userId, username: member.username, displayName: member.displayName, avatar: member.avatar, staff: member.staff }));
    const dm = (await workspace.api.dms()).find(dm => dm.channelId === params.channelId);
    return [own, ...(dm?.users ?? [])];
  }, [workspace, user, params.channelId, params.serverId]));
  const names = useMemo(() => new Map([
    ...state.messages.map(message => [message.userId, shownName(message)] as const),
    ...people.data.map(person => [person.id, shownName(person)] as const),
    [user.id, shownName(user)] as const,
  ]), [state.messages, people.data, user]);
  const rows = useMemo<Row[]>(() => [
    ...state.messages.map(value => ({ kind: "message" as const, id: value.id, value })),
    ...state.outbox.map(value => ({ kind: "pending" as const, id: value.id, value })),
  ].reverse(), [state.messages, state.outbox]);
  const jumpLatest = () => { conversation.setAtLatest(true); list.current?.scrollToOffset({ offset: 0, animated: true }); };
  return <Page><KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={headerHeight}>
    {!presence.connected && <Text accessibilityLiveRegion="polite" style={s.connection}>Sem conexão. Você pode continuar escrevendo.</Text>}
    <Notice>{state.storageError || state.error}</Notice>
    {state.error && <ToolbarButton label="Atualizar conversa" onPress={() => { void conversation.refresh(); }} />}
    <FlatList key={params.channelId} ref={list} data={rows} inverted style={{ flex: 1 }} keyExtractor={item => item.id}
      contentContainerStyle={s.messages} keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled"
      maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 80 }}
      onScroll={({ nativeEvent }) => conversation.setAtLatest(nativeEvent.contentOffset.y < 80)} scrollEventThrottle={100}
      onEndReached={() => { if (state.messages.length) void conversation.loadOlder(); }} onEndReachedThreshold={0.2}
      ListFooterComponent={rows.length ? <View style={s.history}>
        {state.loadingOlder || state.loading ? <ActivityIndicator color={colors.paper} accessibilityLabel="Carregando histórico" /> : state.hasMore ? <ToolbarButton label="Carregar mensagens anteriores" onPress={() => { void conversation.loadOlder(); }} /> : <View style={s.welcome}>
          <View style={s.welcomeIcon}><Icon name={params.serverId ? "hash" : "chat"} size={36} color={colors.paper} /></View>
          <Text accessibilityRole="header" style={text.title}>{params.serverId ? `# ${params.title}` : params.title}</Text>
        </View>}
      </View> : undefined}
      ListEmptyComponent={state.loading || state.restoring ? <ActivityIndicator style={{ padding: 24 }} color={colors.paper} accessibilityLabel="Carregando conversa" /> : !state.error ? <View style={{ padding: 16 }}><Empty title="Conversa sem mensagens">Envie a primeira mensagem por aqui.</Empty></View> : undefined}
      renderItem={({ item, index }) => {
        if (item.kind === "pending") return <View style={[s.message, { marginTop: 16 }]}>
          <Avatar name={shownName(user)} uri={workspace.api.fileUrl(user.avatar)} />
          <View style={layout.rowText}><Text style={text.label}>{shownName(user)}</Text><MessageBody content={item.value.content} names={names} />
            <Text accessibilityLiveRegion="polite" style={text.caption}>{item.value.status === "sending" ? "Enviando…" : item.value.status === "uncertain" ? "Envio sem confirmação" : "Não enviada"}</Text>
            {!!item.value.error && <Text style={text.caption}>{item.value.error}</Text>}
            {item.value.status !== "sending" && <View style={s.retry}>
              <Pressable accessibilityRole="button" accessibilityState={{ disabled: !presence.connected }} disabled={!presence.connected} onPress={() => { void conversation.retry(item.id); }} style={[layout.toolbar, !presence.connected && { opacity: 0.4 }]}><Text style={text.label}>Tentar novamente</Text></Pressable>
              {item.value.status === "failed" && !state.draft.text && <ToolbarButton label="Editar rascunho" onPress={() => conversation.restoreDraft(item.id)} />}
            </View>}
          </View>
        </View>;
        const message = item.value, older = rows[index + 1];
        const previous = older?.kind === "message" ? older.value : undefined;
        const gap = Date.parse(message.createdAt) - Date.parse(previous?.createdAt || "");
        const grouped = previous?.userId === message.userId && gap >= 0 && gap < 5 * 60_000 && message.createdAt.slice(0, 10) === previous.createdAt.slice(0, 10);
        return <View style={[s.message, !grouped && { marginTop: 16 }]}>
          <View style={{ width: 40 }}>{!grouped && <Avatar name={shownName(message)} uri={workspace.api.fileUrl(message.avatar)} />}</View>
          <View style={[layout.rowText, { gap: 2 }]}>
            {!grouped && <Text style={[text.label, { fontFamily: fonts.bold }]}>{shownName(message)} <Text style={[text.caption, { color: colors.faint }]}>{stamp(message.createdAt)}</Text></Text>}
            {!!message.content && <MessageBody content={message.content} names={names} />}
            {!!message.editedAt && <Text style={text.caption}>(editado)</Text>}
            {message.attachments.map(attachment => <View key={attachment.id} style={s.attachment}><Icon name="file" /><Text style={[text.caption, { flex: 1 }]}>{attachment.name}</Text></View>)}
          </View>
        </View>;
      }}
    />
    {!!state.newCount && <Pressable accessibilityRole="button" onPress={jumpLatest} style={s.newMessages}><Text style={text.label}>{state.newCount === 1 ? "Nova mensagem" : `${state.newCount} novas mensagens`} ↓</Text></Pressable>}
    {!!people.error && <View style={{ paddingHorizontal: 16 }}><Text style={text.caption}>Não foi possível carregar as pessoas para menções.</Text><ToolbarButton label="Atualizar pessoas" onPress={people.refresh} /></View>}
    <CallDock onOpen={() => navigation.navigate("Call")} />
    <Composer key={params.channelId} conversation={conversation} state={state} people={people.data} online={presence.connected} title={params.title} fileUrl={workspace.api.fileUrl} onSend={jumpLatest} />
  </KeyboardAvoidingView></Page>;
}
const s = StyleSheet.create({
  messages: { flexGrow: 1, paddingBottom: 16, paddingTop: 16 },
  history: { paddingVertical: 12 }, welcome: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, gap: 8 },
  welcomeIcon: { width: 68, height: 68, borderRadius: 34, alignItems: "center", justifyContent: "center", backgroundColor: colors.elevated },
  message: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 2, paddingHorizontal: 16 },
  body: { fontFamily: fonts.body, fontSize: 16, color: colors.paperDim, lineHeight: 22 }, mention: { color: colors.paper, fontFamily: fonts.semibold, backgroundColor: colors.active },
  attachment: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: colors.line, borderRadius: 4, backgroundColor: colors.panel, padding: 10, marginTop: 4 },
  connection: { ...text.caption, backgroundColor: colors.input, paddingHorizontal: 16, paddingVertical: 8 },
  retry: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  newMessages: { alignSelf: "center", minHeight: 44, justifyContent: "center", paddingHorizontal: 16, paddingVertical: 8, borderWidth: 1, borderColor: colors.line, borderRadius: 22, backgroundColor: colors.input, marginTop: 4 },
});
