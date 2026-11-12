import { useState } from "react";
import { ActionSheetIOS, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Notice } from "../ui/components";
import KeyboardViewport from "../ui/KeyboardViewport";
import { colors, fonts, styles as text } from "../ui/theme";

export function showMessageActions({ mine, canDelete, onReply, onReact, onEdit, onDelete }: {
  mine: boolean; canDelete: boolean; onReply: () => void; onReact: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const actions = [{ title: "Responder", run: onReply }, { title: "Reagir", run: onReact }, ...(mine ? [{ title: "Editar mensagem", run: onEdit }] : []), ...(canDelete ? [{ title: "Excluir mensagem", run: onDelete }] : [])];
  const destructive = actions.findIndex(action => action.title === "Excluir mensagem");
  ActionSheetIOS.showActionSheetWithOptions({
    title: "Opções da mensagem", options: [...actions.map(action => action.title), "Cancelar"],
    cancelButtonIndex: actions.length, destructiveButtonIndex: destructive < 0 ? undefined : destructive,
    userInterfaceStyle: "dark",
  }, index => actions[index]?.run());
}

const emojis = ["👍", "❤️", "😂", "🎉", "😮", "😢", "🔥", "👀", "✅", "🙏", "🐢", "👎"];
export function ReactionPicker({ selected, busy, error, onPick, onClose }: {
  selected: string[]; busy: boolean; error?: string; onPick: (emoji: string) => void; onClose: () => void;
}) {
  const [custom, setCustom] = useState("");
  return <Modal visible transparent animationType="slide" onRequestClose={() => { if (!busy) onClose(); }}>
    <SafeAreaView style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.65)" }}>
      <KeyboardViewport>
        <Pressable accessibilityRole="button" accessibilityLabel="Fechar reações" disabled={busy} onPress={onClose} style={{ flex: 1 }} />
        <ScrollView keyboardShouldPersistTaps="handled" style={{ flexGrow: 0, maxHeight: "80%", backgroundColor: colors.panel, borderTopLeftRadius: 16, borderTopRightRadius: 16 }} contentContainerStyle={{ padding: 20, gap: 12 }}>
          <Text accessibilityRole="header" style={text.subtitle}>Reagir à mensagem</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {emojis.map(emoji => <Pressable key={emoji} accessibilityRole="button" accessibilityLabel={`${selected.includes(emoji) ? "Remover" : "Adicionar"} reação ${emoji}`} accessibilityState={{ selected: selected.includes(emoji), disabled: busy }} disabled={busy} onPress={() => onPick(emoji)}
              style={({ pressed }) => [{ minWidth: 48, minHeight: 48, borderWidth: 1, borderRadius: 8, borderColor: selected.includes(emoji) ? colors.paper : colors.line, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? colors.active : colors.input, opacity: busy ? 0.4 : 1 }]}><Text style={{ fontSize: 26 }}>{emoji}</Text></Pressable>)}
          </View>
          <Text style={text.label}>Outro emoji</Text>
          <TextInput accessibilityLabel="Outro emoji para reagir" value={custom} onChangeText={setCustom} editable={!busy} maxLength={32} placeholder="Escolha no teclado de emojis" placeholderTextColor={colors.faint}
            style={{ minHeight: 44, padding: 10, backgroundColor: colors.input, borderRadius: 8, color: colors.paper, fontFamily: fonts.body, fontSize: 18 }} />
          <Button disabled={busy || !custom.trim()} onPress={() => onPick(custom.trim())}>Usar emoji</Button>
          <Notice>{error}</Notice>
          <Button secondary disabled={busy} onPress={onClose}>Fechar</Button>
        </ScrollView>
      </KeyboardViewport>
    </SafeAreaView>
  </Modal>;
}
