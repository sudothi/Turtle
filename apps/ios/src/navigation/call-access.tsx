import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useCall, useWorkspace } from "../workspace-context";
import { useAppNavigation } from "./types";
import { colors, styles as text } from "../ui/theme";
import { Icon } from "../ui/Icon";
import { IconButton } from "../ui/layout";

export function callStatus(status: string) {
  return status === "connecting" ? "Conectando…" : status === "reconnecting" ? "Reconectando…" : status === "leaving" ? "Saindo…" : "Voz conectada";
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

export function CallDock({ onOpen, controls = true }: { onOpen: () => void; controls?: boolean }) {
  const call = useCall();
  const { workspace } = useWorkspace();
  if (call.status === "idle") return null;
  return <View style={s.dock}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Abrir chamada ${call.channelName}. ${callStatus(call.status)}. ${call.muted ? "Microfone fechado" : "Microfone aberto"}`} onPress={onOpen} style={s.open}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><Icon name="signal" size={16} color={colors.paper} /><Text style={[text.label, { fontSize: 14, flexShrink: 1 }]}>{callStatus(call.status)}</Text></View><Text numberOfLines={1} style={text.caption}>{call.channelName}</Text>
    </Pressable>
    {controls && <IconButton name={call.muted ? "mic-off" : "mic"} label={call.muted ? "Abrir microfone" : "Fechar microfone"} disabled={call.status !== "connected" || call.busy || call.deafened} onPress={() => { void workspace.voice.toggleMute(); }} />}
    <IconButton name="phone-off" label="Sair da chamada" disabled={call.status === "leaving"} onPress={() => { void workspace.voice.leave(); }} />
  </View>;
}
const s = StyleSheet.create({
  dock: { flexDirection: "row", alignItems: "center", gap: 4, borderTopWidth: 2, borderColor: colors.rail, backgroundColor: colors.userPanel, paddingHorizontal: 8, paddingVertical: 4 },
  open: { flex: 1, minHeight: 44, justifyContent: "center", gap: 3, paddingVertical: 6 },
});
