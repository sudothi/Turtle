import { useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import type { Message } from "@turtle/protocol";
import { Button, Notice } from "../ui/components";
import { colors, fonts, styles as text } from "../ui/theme";
import type { Conversation } from "./conversation";
import { decodeDraft, editDraft, encodeDraft } from "./draft";

export default function MessageEditor({ message, names, conversation, busy, error, online, onClose }: {
  message: Message; names: Map<string, string>; conversation: Conversation;
  busy: boolean; error?: string; online: boolean; onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => decodeDraft(message.content, names));
  const content = encodeDraft(draft);
  return <ScrollView keyboardShouldPersistTaps="handled" style={{ flexGrow: 0, maxHeight: "70%", backgroundColor: colors.panel }} contentContainerStyle={{ padding: 16, gap: 8 }}>
    <Text accessibilityRole="header" style={text.label}>Editar mensagem</Text>
    <TextInput autoFocus accessibilityLabel="Texto da mensagem em edição" multiline value={draft.text}
      editable={!busy} onChangeText={value => setDraft(editDraft(draft, value))}
      style={{ minHeight: 44, maxHeight: 140, padding: 10, borderRadius: 8, backgroundColor: colors.input, color: colors.paper, fontFamily: fonts.body, fontSize: 16 }} />
    <Notice>{error}</Notice>
    {content.length >= 3600 && <Text style={text.caption}>{content.length}/4000 caracteres</Text>}
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
      <Button secondary disabled={busy} onPress={onClose}>Cancelar edição</Button>
      <Button disabled={busy || !online || !content || content.length > 4000 || content === message.content} onPress={() => {
        void conversation.editMessage(message.id, content).then(saved => { if (saved) onClose(); });
      }}>{busy ? "Salvando…" : "Salvar edição"}</Button>
    </View>
  </ScrollView>;
}
