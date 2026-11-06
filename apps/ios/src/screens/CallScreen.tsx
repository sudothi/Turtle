import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { AudioSession } from "@livekit/react-native";
import { Notice } from "../ui/components";
import { Avatar, Page } from "../ui/layout";
import { Icon, type IconName } from "../ui/Icon";
import { styles as text, colors } from "../ui/theme";
import { useCall, useWorkspace } from "../workspace-context";
import { callStatus } from "../navigation/call-access";
import { useAppNavigation } from "../navigation/types";

function CallControl({ name, label, onPress, disabled, hangup }: { name: IconName; label: string; onPress: () => void; disabled?: boolean; hangup?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [s.control, hangup && { width: 64, backgroundColor: colors.paper }, (pressed || disabled) && { opacity: disabled ? 0.35 : 0.65 }]}><Icon name={name} color={hangup ? colors.rail : colors.paper} size={24} /></Pressable>;
}
export default function CallScreen() {
  const call = useCall();
  const { workspace } = useWorkspace();
  const navigation = useAppNavigation();
  const [error, setError] = useState<string>();
  const { width, fontScale } = useWindowDimensions();
  const single = call.members.length === 1 || fontScale > 1.5 || width < 360;
  useEffect(() => { if (call.status === "idle" && navigation.canGoBack()) navigation.goBack(); }, [call.status, navigation]);
  return <Page modal>
    <ScrollView contentContainerStyle={s.content}>
      <View style={s.heading}><Text accessibilityRole="header" style={text.title}>{call.channelName}</Text><Text style={text.caption}>{callStatus(call.status)}</Text></View>
      <Notice>{error || call.error}</Notice>
      <View style={s.tiles}>{call.members.map(member => <View key={member.id} accessibilityLabel={`${member.name}${member.local ? ", você" : ""}. ${member.speaking ? "Falando" : member.muted ? "Microfone fechado" : "Na conversa"}`} style={[s.tile, { width: single ? "100%" : "48%" }, member.speaking && { borderColor: colors.paper }]}>
        <Avatar name={member.name} size={single ? 80 : 64} />
        <View style={s.memberName}>{member.muted && <Icon name="mic-off" size={16} color={colors.paper} />}<Text numberOfLines={1} style={[text.label, { fontSize: 14, flexShrink: 1 }]}>{member.name}{member.local ? " (você)" : ""}</Text></View>
      </View>)}</View>
    </ScrollView>
    <View style={s.controls}>
      <CallControl name={call.muted ? "mic-off" : "mic"} label={call.muted ? "Abrir microfone" : "Fechar microfone"} disabled={call.status !== "connected" || call.busy || call.deafened} onPress={() => { void workspace.voice.toggleMute(); }} />
      <CallControl name={call.deafened ? "headphones-off" : "headphones"} label={call.deafened ? "Voltar a ouvir" : "Ensurdecer"} disabled={call.status !== "connected" || call.busy} onPress={() => { void workspace.voice.toggleDeafened(); }} />
      <CallControl name="speaker" label="Saída de áudio" disabled={call.status !== "connected"} onPress={() => { void AudioSession.showAudioRoutePicker().catch(() => setError("Não foi possível abrir as saídas de áudio.")); }} />
      <CallControl name="phone-off" label="Sair da chamada" hangup disabled={call.status === "leaving"} onPress={() => { void workspace.voice.leave(); }} />
    </View>
  </Page>;
}
const s = StyleSheet.create({
  content: { flexGrow: 1, padding: 16, gap: 16 }, heading: { gap: 4 },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 12, justifyContent: "center", flexGrow: 1, alignContent: "center" },
  tile: { aspectRatio: 1, maxWidth: 420, backgroundColor: colors.input, borderRadius: 10, borderWidth: 2, borderColor: "transparent", alignItems: "center", justifyContent: "center" },
  memberName: { position: "absolute", left: 8, bottom: 8, right: 8, borderRadius: 4, backgroundColor: "rgba(0,0,0,0.7)", padding: 6, flexDirection: "row", alignItems: "center", gap: 6 },
  controls: { flexDirection: "row", justifyContent: "center", flexWrap: "wrap", gap: 10, paddingVertical: 16, paddingHorizontal: 12 },
  control: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", backgroundColor: colors.elevated },
});
