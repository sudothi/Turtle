import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { AudioSession } from "@livekit/react-native";
import { Button, Notice } from "../ui/components";
import { Avatar, Content, layout, Page } from "../ui/layout";
import { styles as text, colors } from "../ui/theme";
import { useCall, useWorkspace } from "../workspace-context";
import { callStatus } from "../navigation/call-access";
import { useAppNavigation } from "../navigation/types";

export default function CallScreen() {
  const call = useCall();
  const { workspace } = useWorkspace();
  const navigation = useAppNavigation();
  const [error, setError] = useState<string>();
  useEffect(() => { if (call.status === "idle" && navigation.canGoBack()) navigation.goBack(); }, [call.status, navigation]);
  return <Page modal><Content>
    <Text style={text.caption}>{callStatus(call.status)}</Text>
    <Text accessibilityRole="header" style={text.title}>{call.channelName}</Text>
    <Notice>{error || call.error}</Notice>
    {call.members.map(member => <View key={member.id} style={[layout.row, member.speaking && { borderColor: colors.paper }]}>
      <Avatar name={member.name} />
      <View style={layout.rowText}><Text style={text.label}>{member.name}{member.local ? " (você)" : ""}</Text><Text style={text.caption}>{member.quality || (member.speaking ? "Falando" : member.muted ? "Microfone fechado" : "Na conversa")}</Text></View>
    </View>)}
    <Button secondary disabled={call.status !== "connected" || call.busy || call.deafened} onPress={() => { void workspace.voice.toggleMute(); }}>{call.muted ? "Abrir microfone" : "Fechar microfone"}</Button>
    <Button secondary disabled={call.status !== "connected" || call.busy} onPress={() => { void workspace.voice.toggleDeafened(); }}>{call.deafened ? "Voltar a ouvir" : "Ensurdecer"}</Button>
    <Button secondary disabled={call.status !== "connected"} onPress={() => { void AudioSession.showAudioRoutePicker().catch(() => setError("Não foi possível abrir as saídas de áudio.")); }}>Saída de áudio</Button>
    <Button disabled={call.status === "leaving"} onPress={() => { void workspace.voice.leave(); }}>Sair da chamada</Button>
    <Text style={text.footnote}>Fechar esta tela mantém a chamada. Ao voltar a ouvir, o microfone continua fechado.</Text>
  </Content></Page>;
}
