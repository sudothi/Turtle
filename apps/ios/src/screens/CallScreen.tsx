import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { AudioSession, VideoTrack } from "@livekit/react-native";
import { Button, Notice } from "../ui/components";
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
  const [focus, setFocus] = useState<string>();
  useFocusEffect(useCallback(() => { workspace.voice.setVideoVisible(true); return () => workspace.voice.setVideoVisible(false); }, [workspace]));
  const [error, setError] = useState<string>();
  const { width, fontScale } = useWindowDimensions();
  useEffect(() => { if (focus && !call.members.some(member => member.id === focus) && !call.screens.some(screen => screen.id === focus)) setFocus(undefined); }, [call.members, call.screens, focus]);
  const single = !!focus || call.members.length === 1 || fontScale > 1.5 || width < 360;
  useEffect(() => { if (call.status === "idle" && navigation.canGoBack()) navigation.goBack(); }, [call.status, navigation]);
  return <Page modal>
    <ScrollView contentContainerStyle={s.content}>
      <View style={s.heading}><Text accessibilityRole="header" accessibilityLabel={call.channelName} maxFontSizeMultiplier={2} numberOfLines={2} style={text.title}>{call.channelName}</Text><Text style={text.caption}>{callStatus(call.status)}</Text></View>
      <Notice>{error || call.error}</Notice>
      {!!focus && <Button secondary onPress={() => setFocus(undefined)}>Voltar à grade</Button>}
      <View style={s.tiles}>{call.members.filter(member => !focus || member.id === focus).map(member => <View key={member.id} accessibilityLabel={`${member.name}${member.local ? ", você" : ""}. ${member.speaking ? "Falando" : member.muted ? "Microfone fechado" : "Na conversa"}`} style={[s.tile, { width: single ? "100%" : "48%" }, member.speaking && { borderColor: colors.paper }]}>
        {member.video ? <VideoTrack trackRef={member.video} mirror={member.local && call.facing === "user"} objectFit="contain" style={{ width: "100%", height: "100%", borderRadius: 8 }} /> : <Avatar name={member.name} size={single ? 80 : 64} />}
        <Pressable accessibilityRole="button" accessibilityLabel={`Ampliar ${member.name}`} onPress={() => setFocus(member.id)} style={{ position: "absolute", right: 4, top: 4, minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", backgroundColor: colors.panel, borderRadius: 4 }}><Icon name="maximize" color={colors.paper} /></Pressable>
        {!!member.quality && <Text style={[text.caption, { position: "absolute", top: 8, left: 8 }]}>{member.quality}</Text>}
        <View style={s.memberName}>{member.muted && <Icon name="mic-off" size={16} color={colors.paper} />}<Text maxFontSizeMultiplier={2} numberOfLines={2} style={[text.label, { fontSize: 14, flexShrink: 1 }]}>{member.name}{member.local ? " (você)" : ""}{member.speaking ? " · Falando" : ""}</Text></View>
      </View>)}</View>
      {call.screens.filter(screen => !focus || screen.id === focus).map(screen => <View key={screen.id} style={{ gap: 8 }}>
        <Text style={text.label}>Tela de {screen.name}</Text>
        {screen.watching && <View style={{ width: "100%", aspectRatio: 16 / 9, backgroundColor: colors.rail }}>{screen.video ? <VideoTrack trackRef={screen.video} objectFit="contain" style={{ width: "100%", height: "100%" }} /> : <Text style={text.body}>Conectando transmissão…</Text>}</View>}
        <Button secondary onPress={() => workspace.voice.watchScreen(screen.id, !screen.watching)}>{screen.watching ? "Parar de assistir" : "Assistir transmissão"}</Button>
        {screen.watching && <><Button secondary onPress={() => setFocus(screen.id)}>Ampliar transmissão</Button><Volume label={`Volume da tela de ${screen.name}`} value={screen.volume} onChange={value => workspace.voice.setVolume(screen.participantId, "screen", value)} /></>}
      </View>)}
      {call.members.filter(member => !member.local).map(member => <Volume key={member.id} label={`Voz de ${member.name}`} value={member.volume} onChange={value => workspace.voice.setVolume(member.id, "voice", value)} />)}
    </ScrollView>
    <View style={s.controls}>
      <CallControl name={call.muted ? "mic-off" : "mic"} label={call.muted ? "Abrir microfone" : "Fechar microfone"} disabled={call.status !== "connected" || call.busy || call.deafened} onPress={() => { void workspace.voice.toggleMute(); }} />
      <CallControl name={call.deafened ? "headphones-off" : "headphones"} label={call.deafened ? "Voltar a ouvir" : "Ensurdecer"} disabled={call.status !== "connected" || call.busy} onPress={() => { void workspace.voice.toggleDeafened(); }} />
      <CallControl name={call.camera ? "video" : "video-off"} label={call.camera ? "Desligar câmera" : "Ligar câmera"} disabled={call.status !== "connected" || call.busy} onPress={() => { void workspace.voice.toggleCamera(); }} />
      {call.camera && <CallControl name="camera-flip" label="Trocar câmera" disabled={call.busy} onPress={() => { void workspace.voice.flipCamera(); }} />}
      <CallControl name="speaker" label="Saída de áudio" disabled={call.status !== "connected"} onPress={() => { void AudioSession.showAudioRoutePicker().catch(() => setError("Não foi possível abrir as saídas de áudio.")); }} />
      <CallControl name="phone-off" label="Sair da chamada" hangup disabled={call.status === "leaving"} onPress={() => { void workspace.voice.leave(); }} />
    </View>
  </Page>;
}
function Volume({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <View style={{ gap: 8 }}><Text style={text.caption}>{label} · {Math.round(value * 100)}%</Text><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}><Button secondary label={`Diminuir ${label}`} disabled={value <= 0} onPress={() => onChange(value - 0.25)}>Diminuir</Button><Button secondary label={`Aumentar ${label}`} disabled={value >= 2} onPress={() => onChange(value + 0.25)}>Aumentar</Button></View></View>;
}
const s = StyleSheet.create({
  content: { flexGrow: 1, padding: 16, gap: 16 }, heading: { gap: 4 },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 12, justifyContent: "center", flexGrow: 1, alignContent: "center" },
  tile: { aspectRatio: 1, maxWidth: 420, backgroundColor: colors.input, borderRadius: 10, borderWidth: 2, borderColor: "transparent", alignItems: "center", justifyContent: "center" },
  memberName: { position: "absolute", left: 8, bottom: 8, right: 8, borderRadius: 4, backgroundColor: "rgba(0,0,0,0.7)", padding: 6, flexDirection: "row", alignItems: "center", gap: 6 },
  controls: { flexDirection: "row", justifyContent: "center", flexWrap: "wrap", gap: 10, paddingVertical: 16, paddingHorizontal: 12 },
  control: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", backgroundColor: colors.elevated },
});
