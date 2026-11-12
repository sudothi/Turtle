import { useEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { shownName, type Person } from "@turtle/protocol";
import { Avatar } from "../ui/layout";
import { Icon } from "../ui/Icon";
import { colors, fonts, styles as text } from "../ui/theme";
import { chooseMention, encodeDraft, mentionQuery } from "./draft";
import type { Conversation, ConversationState } from "./conversation";
import ReplyQuote from "./ReplyQuote";

const searchable = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR");
export default function Composer({ conversation, state, people, online, title, fileUrl, onSend }: { conversation: Conversation; state: ConversationState; people: Person[]; online: boolean; title: string; fileUrl: (key?: string | null) => string | undefined; onSend: () => void }) {
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  useEffect(() => { if (state.draft.reply) input.current?.focus(); }, [state.draft.reply?.id]);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [requestedSelection, requestSelection] = useState<{ start: number; end: number }>();
  const [height, setHeight] = useState(44);
  const query = selection.start === selection.end ? mentionQuery(state.draft.text, selection.start) : undefined;
  const matching = useMemo(() => query ? people.filter(person => searchable(`${shownName(person)} ${person.username}`).includes(searchable(query.query))).slice(0, 8) : [], [people, query?.query]);
  const length = encodeDraft(state.draft).length;
  const disabled = state.restoring || !online || !length || length > 4000 || state.draft.reply?.preview === null;
  const names = useMemo(() => new Map(people.map(person => [person.id, shownName(person)])), [people]);
  return <View style={s.composer}>
    {state.draft.reply && <ReplyQuote reply={state.draft.reply} names={names} fileUrl={fileUrl} onCancel={conversation.cancelReply} />}
    {!!matching.length && query && <ScrollView style={s.mentions} keyboardShouldPersistTaps="always" accessibilityLabel="Sugestões de menção">
      {matching.map(person => <Pressable key={person.id} accessibilityRole="button" accessibilityLabel={`Mencionar ${shownName(person)}, @${person.username}`} style={({ pressed }) => [s.option, pressed && { backgroundColor: colors.active }]} onPress={() => {
        const next = chooseMention(state.draft, query, person);
        const caret = { start: next.caret, end: next.caret };
        conversation.setDraft(next.draft); setSelection(caret); requestSelection(caret); input.current?.focus();
      }}><Avatar name={shownName(person)} uri={fileUrl(person.avatar)} size={28} /><View style={{ flex: 1 }}><Text style={text.label}>{shownName(person)}</Text><Text style={text.caption}>@{person.username}</Text></View></Pressable>)}
    </ScrollView>}
    <View style={s.field}>
      <TextInput ref={input} accessibilityLabel={`Mensagem em ${title}`} placeholder={state.restoring ? "Restaurando rascunho…" : `Conversar em ${title}`} placeholderTextColor={colors.faint} value={state.draft.text} editable={!state.restoring}
        multiline submitBehavior="newline" selection={requestedSelection} onSelectionChange={({ nativeEvent }) => { setSelection(nativeEvent.selection); if (nativeEvent.selection.start === requestedSelection?.start) requestSelection(undefined); }}
        onChangeText={value => { requestSelection(undefined); conversation.edit(value); }} onContentSizeChange={({ nativeEvent }) => setHeight(Math.min(140, Math.max(44, nativeEvent.contentSize.height)))}
        style={[s.input, { height }]} selectionColor={colors.paper} />
      <Pressable accessibilityRole="button" accessibilityLabel="Enviar mensagem" accessibilityState={{ disabled }} disabled={disabled} onPress={() => { onSend(); void conversation.send(); }} style={({ pressed }) => [s.send, (disabled || pressed) && { opacity: disabled ? 0.3 : 0.7 }]}><Icon name="send" color={colors.rail} /></Pressable>
    </View>
    {length >= 3600 && <Text accessibilityLiveRegion={length > 4000 ? "polite" : "none"} style={[text.caption, { textAlign: "right" }]}>{length}/4000 caracteres</Text>}
  </View>;
}
const s = StyleSheet.create({
  composer: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10, gap: 6, backgroundColor: colors.background },
  field: { flexDirection: "row", alignItems: "flex-end", backgroundColor: colors.input, borderRadius: 8, padding: 4, gap: 4 },
  input: { flex: 1, minWidth: 0, color: colors.paper, fontFamily: fonts.body, fontSize: 16, lineHeight: 22, paddingHorizontal: 10, paddingVertical: 10 },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.paper, alignItems: "center", justifyContent: "center" },
  mentions: { maxHeight: 180, borderRadius: 8, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel },
  option: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10, padding: 10 },
});
