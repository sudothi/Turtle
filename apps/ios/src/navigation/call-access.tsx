import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useCall, useWorkspace } from "../workspace-context";
import { useAppNavigation } from "./types";
import { colors, styles as text } from "../ui/theme";

export function callStatus(status: string) {
  return status === "connecting" ? "Entrando…" : status === "reconnecting" ? "Reconectando…" : status === "leaving" ? "Saindo…" : "Na chamada";
}
export function useJoinCall() {
  const { workspace } = useWorkspace();
  const navigation = useAppNavigation();
  return (channelId: string, title: string) => {
    const current = workspace.voice.getSnapshot();
    if (current.channelId === channelId && current.status !== "idle") { navigation.navigate("Call"); return; }
    const start = async (microphone: boolean) => {
      if (workspace.voice.getSnapshot().status !== "idle") await workspace.voice.leave();
      const connecting = workspace.enter(channelId, title, microphone);
      navigation.navigate("Call");
      await connecting;
    };
    const message = current.status === "idle" ? "Como você quer entrar?" : `Você sairá de ${current.channelName} para entrar nesta chamada.`;
    Alert.alert(title, message, [
      { text: "Cancelar", style: "cancel" },
      { text: "Só ouvir", onPress: () => { void start(false); } },
      { text: "Com microfone", onPress: () => { void start(true); } },
    ]);
  };
}

export function CallDock({ onOpen }: { onOpen: () => void }) {
  const call = useCall();
  const { workspace } = useWorkspace();
  if (call.status === "idle") return null;
  return <View style={s.dock}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Abrir chamada ${call.channelName}. ${callStatus(call.status)}. ${call.muted ? "Microfone fechado" : "Microfone aberto"}`} onPress={onOpen} style={s.open}>
      <Text style={text.caption}>{callStatus(call.status)}</Text><Text style={text.label}>{call.channelName}</Text>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={call.muted ? "Abrir microfone" : "Fechar microfone"} accessibilityState={{ disabled: call.status !== "connected" || call.busy || call.deafened }} disabled={call.status !== "connected" || call.busy || call.deafened} onPress={() => { void workspace.voice.toggleMute(); }} style={s.control}>
      <Text style={[text.label, { textAlign: "center" }]}>{call.muted ? "Abrir mic" : "Fechar mic"}</Text>
    </Pressable>
  </View>;
}
const s = StyleSheet.create({
  dock: { flexDirection: "row", alignItems: "center", gap: 8, borderTopWidth: 2, borderColor: colors.paper, backgroundColor: colors.panel, paddingHorizontal: 16, paddingVertical: 6 },
  open: { flex: 1, minHeight: 44, justifyContent: "center", gap: 3, paddingVertical: 6 },
  control: { minWidth: 64, maxWidth: 112, minHeight: 44, alignItems: "center", justifyContent: "center", padding: 8, borderWidth: 1, borderColor: colors.line, borderRadius: 8 },
});
