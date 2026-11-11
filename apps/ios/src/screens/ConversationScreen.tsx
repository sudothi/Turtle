import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useRoute, useIsFocused, type RouteProp } from "@react-navigation/native";
import { shownName, splitMentions, type Message, type Person } from "@turtle/protocol";
import { useConversation, useDirectory, usePresence, useRead, useWorkspace } from "../workspace-context";
import { useAppNavigation, type RootRoutes } from "../navigation/types";
import { CallDock, useJoinCall } from "../navigation/call-access";
import { Avatar, Empty, layout, Page, ToolbarButton } from "../ui/layout";
import { Notice } from "../ui/components";
import { styles as text, colors, fonts } from "../ui/theme";
import { Icon } from "../ui/Icon";
import Composer from "../chat/Composer";
import type { PendingSend } from "../chat/conversation";
import KeyboardViewport from "../ui/KeyboardViewport";
import MessageEditor from "../chat/MessageEditor";
import { ReactionPicker, showMessageActions } from "../chat/MessageActions";

const timestamp = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
function stamp(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : timestamp.format(date); }
type Row = { kind: "message"; id: string; value: Message } | { kind: "pending"; id: string; value: PendingSend };
function MessageBody({ content, names }: { content: string; names: Map<string, string> }) {
  return <Text selectable style={s.body}>{splitMentions(content).map((part, i) => "text" in part ? part.text : <Text key={i} style={s.mention}>@{names.get(part.userId) || "pessoa"}</Text>)}</Text>;
}

export default function ConversationScreen() {
  const { params } = useRoute<RouteProp<RootRoutes, "Conversation">>();
  const navigation = useAppNavigation();
  const joinCall = useJoinCall();
  const { workspace, user } = useWorkspace();
  const presence = usePresence();
  const directory = useDirectory();
  const state = useConversation(params.channelId);
  const { conversation } = state;
  const focused = useIsFocused();
  const [atLatest, setAtLatest] = useState(true);
  const [editing, setEditing] = useState<string>();
  const [reacting, setReacting] = useState<string>();
  const editingMessage = state.messages.find(message => message.id === editing);
  const reactingMessage = state.messages.find(message => message.id === reacting);
  const role = directory.data.find(entry => entry.server.id === params.serverId)?.server.role;
  const canModerate = role === "owner" || role === "admin";
  useEffect(() => {
    if (editing && !editingMessage) setEditing(undefined);
    if (reacting && !reactingMessage) setReacting(undefined);
  }, [editing, editingMessage, reacting, reactingMessage]);
  const latestId = state.messages.at(-1)?.id;
  useEffect(() => { if (focused && atLatest && latestId) void workspace.api.markRead(params.channelId).then(() => workspace.gateway.invalidate()).catch(() => {}); }, [workspace, params.channelId, latestId, atLatest, focused]);
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
  const jumpLatest = () => { setAtLatest(true); conversation.setAtLatest(true); list.current?.scrollToOffset({ offset: 0, animated: true }); };
  const openActions = (message: Message) => {
    conversation.clearActionError();
    showMessageActions({ mine: message.userId === user.id, canDelete: message.userId === user.id || canModerate,
      onReact: () => setReacting(message.id), onEdit: () => setEditing(message.id),
      onDelete: () => Alert.alert("Excluir mensagem?", "A mensagem será removida para todos. Essa ação não pode ser desfeita.", [
        { text: "Cancelar", style: "cancel" }, { text: "Excluir", style: "destructive", onPress: () => { void conversation.deleteMessage(message.id); } },
      ]),
    });
  };
  return <Page><KeyboardViewport>
    {!params.serverId && <ToolbarButton label="Entrar na chamada" onPress={() => joinCall(params.channelId, params.title)} />}
    {!presence.connected && <Text accessibilityLiveRegion="polite" style={s.connection}>Sem conexão. Você pode continuar escrevendo.</Text>}
    <Notice>{state.storageError || state.error}</Notice>
    {!editingMessage && !reactingMessage && <Notice>{state.actionError}</Notice>}
    {state.error && <ToolbarButton label="Atualizar conversa" onPress={() => { void conversation.refresh(); }} />}
    <FlatList key={`history:${params.channelId}`} ref={list} data={rows} inverted style={{ flex: 1 }} keyExtractor={item => item.id}
      contentContainerStyle={s.messages} keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled"
      maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 80 }}
      onScroll={({ nativeEvent }) => { const latest = nativeEvent.contentOffset.y < 80; setAtLatest(latest); conversation.setAtLatest(latest); }} scrollEventThrottle={100}
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
        return <Pressable accessible={false} onLongPress={() => openActions(message)} disabled={!!state.acting} style={[s.message, !grouped && { marginTop: 16 }]}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Ver perfil de ${shownName(message)}`} onPress={() => navigation.navigate("Profile", { userId: message.userId })} style={{ width: 40, minHeight: 44 }}>{!grouped && <Avatar name={shownName(message)} uri={workspace.api.fileUrl(message.avatar)} />}</Pressable>
          <View style={[layout.rowText, { gap: 2 }]}>
            {!grouped && <Text style={[text.label, { fontFamily: fonts.bold }]}>{shownName(message)} <Text style={[text.caption, { color: colors.faint }]}>{stamp(message.createdAt)}</Text></Text>}
            {!!message.content && <MessageBody content={message.content} names={names} />}
            {!!message.editedAt && <Text style={text.caption}>(editado)</Text>}
            {message.attachments.map(attachment => <View key={attachment.id} style={s.attachment}><Icon name="file" /><Text style={[text.caption, { flex: 1 }]}>{attachment.name}</Text></View>)}
            {!!message.reactions.length && <View style={s.reactions}>{message.reactions.map(reaction => {
              const selected = reaction.userIds.includes(user.id), disabled = !presence.connected || !!state.acting;
              return <Pressable key={reaction.emoji} accessibilityRole="button" accessibilityLabel={`${selected ? "Remover" : "Adicionar"} reação ${reaction.emoji}, ${reaction.userIds.length} ${reaction.userIds.length === 1 ? "pessoa" : "pessoas"}`} accessibilityState={{ selected, disabled }} disabled={disabled} onPress={() => { void conversation.setReaction(message.id, reaction.emoji, !selected); }}
                style={[s.reaction, selected && { borderColor: colors.paper }, disabled && { opacity: 0.4 }]}><Text style={text.label}>{reaction.emoji} {reaction.userIds.length}</Text></Pressable>;
            })}</View>}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={`Opções da mensagem de ${shownName(message)}`} disabled={!!state.acting} accessibilityState={{ disabled: !!state.acting }} onPress={() => openActions(message)} style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}><Text style={[text.label, { fontSize: 24 }]}>⋯</Text></Pressable>
        </Pressable>;
      }}
    />
    {!!state.newCount && <Pressable accessibilityRole="button" onPress={jumpLatest} style={s.newMessages}><Text style={text.label}>{state.newCount === 1 ? "Nova mensagem" : `${state.newCount} novas mensagens`} ↓</Text></Pressable>}
    {!!people.error && <View style={{ paddingHorizontal: 16 }}><Text style={text.caption}>Não foi possível carregar as pessoas para menções.</Text><ToolbarButton label="Atualizar pessoas" onPress={people.refresh} /></View>}
    <CallDock onOpen={() => navigation.navigate("Call")} />
    {editingMessage ? <MessageEditor key={editingMessage.id} message={editingMessage} names={names} conversation={conversation} busy={!!state.acting} error={state.actionError} online={presence.connected} onClose={() => { setEditing(undefined); conversation.clearActionError(); }} /> :
      <Composer key={`composer:${params.channelId}`} conversation={conversation} state={state} people={people.data} online={presence.connected} title={params.title} fileUrl={workspace.api.fileUrl} onSend={jumpLatest} />}
    {reactingMessage && <ReactionPicker selected={reactingMessage.reactions.filter(reaction => reaction.userIds.includes(user.id)).map(reaction => reaction.emoji)} busy={!!state.acting} error={state.actionError} onClose={() => { setReacting(undefined); conversation.clearActionError(); }} onPick={emoji => {
      const selected = reactingMessage.reactions.some(reaction => reaction.emoji === emoji && reaction.userIds.includes(user.id));
      void conversation.setReaction(reactingMessage.id, emoji, !selected).then(saved => { if (saved) setReacting(undefined); });
    }} />}
  </KeyboardViewport></Page>;
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
  reactions: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  reaction: { minWidth: 44, minHeight: 44, paddingHorizontal: 10, justifyContent: "center", borderWidth: 1, borderColor: colors.line, borderRadius: 16, backgroundColor: colors.input },
  newMessages: { alignSelf: "center", minHeight: 44, justifyContent: "center", paddingHorizontal: 16, paddingVertical: 8, borderWidth: 1, borderColor: colors.line, borderRadius: 22, backgroundColor: colors.input, marginTop: 4 },
});
