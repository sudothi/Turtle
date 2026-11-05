import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Alert, AppState, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { AudioSession } from "@livekit/react-native";
import { shownName, type Channel, type Server, type User } from "@turtle/protocol";
import { Api, ApiError } from "./api";
import { Gateway } from "./gateway";
import { session } from "./runtime";
import { errorText } from "./session";
import { Voice } from "./voice";
import AuthScreen from "./screens/AuthScreen";
import { Button, Heading, Notice } from "./ui/components";
import { colors, styles as s } from "./ui/theme";

type Directory = { server: Server; channels: Channel[] }[];
function Workspace({ api, user }: { api: Api; user: User }) {
  const refreshRef = useRef<() => void>(() => {});
  const [gateway] = useState(() => new Gateway(api, () => { void session.rejectIfUnauthorized(new ApiError(401, "Sessão inválida")); }, () => refreshRef.current()));
  const [voice] = useState(() => new Voice(api, gateway.update, () => AppState.currentState === "active"));
  const call = useSyncExternalStore(voice.subscribe, voice.getSnapshot);
  const presence = useSyncExternalStore(gateway.subscribe, gateway.getSnapshot);
  const [directory, setDirectory] = useState<Directory>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [leavingAccount, setLeavingAccount] = useState(false);
  const mounted = useRef(true);
  const loadGeneration = useRef(0);

  const refresh = useCallback(async () => {
    const generation = ++loadGeneration.current;
    try {
      const servers = await api.servers();
      const next = await Promise.all(servers.map(async server => ({ server, channels: (await api.channels(server.id)).filter(channel => channel.kind === "voice") })));
      if (mounted.current && generation === loadGeneration.current) { setDirectory(next); setError(undefined); }
    } catch (error) {
      if (mounted.current && generation === loadGeneration.current) {
        if (!(await session.rejectIfUnauthorized(error))) setError(errorText(error));
      }
    } finally { if (mounted.current && generation === loadGeneration.current) setLoading(false); }
  }, [api]);
  refreshRef.current = () => { void refresh(); };

  useEffect(() => {
    mounted.current = true;
    gateway.start();
    void refresh();
    const listener = AppState.addEventListener("change", state => {
      if (state === "active") gateway.resume();
    });
    return () => { mounted.current = false; ++loadGeneration.current; listener.remove(); gateway.stop(); void voice.leave(); };
  }, [gateway, voice, refresh]);

  const join = (channel: Channel) => {
    Alert.alert(channel.name, "Como você quer entrar na chamada?", [
      { text: "Cancelar", style: "cancel" },
      { text: "Só ouvir", onPress: () => void enter(channel, false) },
      { text: "Com microfone", onPress: () => void enter(channel, true) },
    ]);
  };
  const enter = async (channel: Channel, microphone: boolean) => {
    setError(undefined);
    try { await voice.join(channel.id, channel.name, microphone); }
    catch (error) { if (!(await session.rejectIfUnauthorized(error))) setError(error instanceof ApiError ? error.message : "Não foi possível entrar na chamada. Confira sua conexão e tente novamente."); }
  };
  const logout = async () => {
    setLeavingAccount(true);
    try { await voice.leave(); await session.logout(); }
    catch (error) { setError(errorText(error)); setLeavingAccount(false); }
  };
  const status = call.status === "connecting" ? "Entrando…" : call.status === "reconnecting" ? "Reconectando…" : call.status === "leaving" ? "Saindo…" : "Na chamada";
  const activeCall = call.status !== "idle";

  return <View style={s.flex}>
    <View style={s.topbar}><View style={s.flex}><Text style={s.smallWordmark}>turtle.</Text><Text style={s.caption}>{shownName(user)}</Text></View><Pressable accessibilityRole="button" onPress={() => Alert.alert("Sair da conta?", "A chamada será encerrada neste iPhone.", [{ text: "Cancelar", style: "cancel" }, { text: "Sair", style: "destructive", onPress: () => void logout() }])} disabled={leavingAccount} style={s.exit}><Text style={s.label}>Sair</Text></Pressable></View>
    <ScrollView contentContainerStyle={s.content}>
      <View style={s.sectionHeading}><Text accessibilityRole="header" style={s.title}>Vamos conversar.</Text><Text style={s.body}>Escolha um canal de voz.</Text></View>
      {!presence.connected && <Text style={s.caption}>Atualizando presença… A conexão de voz é independente.</Text>}
      <Notice>{error}</Notice>
      {loading && <ActivityIndicator color={colors.paper} accessibilityLabel="Carregando canais" />}
      {!loading && directory.length === 0 && <View style={s.empty}><Text style={s.subtitle}>Sua turma ainda não está aqui.</Text><Text style={s.body}>Entre em um servidor pelo Turtle no navegador ou desktop. Depois atualize esta lista.</Text></View>}
      {directory.map(({ server, channels }) => <View key={server.id} style={s.server}>
        <Text style={s.serverTitle}>{server.name}</Text>
        {channels.length === 0 && <Text style={s.caption}>Este servidor ainda não tem canais de voz.</Text>}
        {channels.map(channel => {
          const occupants = presence.states.filter(state => state.channelId === channel.id);
          const selected = call.channelId === channel.id;
          return <Pressable key={channel.id} accessibilityRole="button" accessibilityLabel={`Entrar em ${channel.name}`} accessibilityState={{ disabled: activeCall, selected }} disabled={activeCall} onPress={() => join(channel)} style={({ pressed }) => [s.channel, selected && s.selectedChannel, pressed && { opacity: 0.65 }]}>
            <Text style={s.channelSymbol}>↗</Text><View style={s.flex}><Text style={s.subtitle}>{channel.name}</Text><Text style={s.caption}>{selected ? status : occupants.length ? `${occupants.length} na conversa` : "Pode entrar"}</Text></View><Text style={s.caption}>{selected ? "●" : "+"}</Text>
          </Pressable>;
        })}
      </View>)}
      <Button secondary disabled={loading} onPress={() => { setLoading(true); void refresh(); }}>Atualizar canais</Button>
      {activeCall && <View style={s.call}>
        <Text style={s.caption}>{status}</Text><Text accessibilityRole="header" style={s.title}>{call.channelName}</Text>
        <Notice>{call.error}</Notice>
        {call.members.map(member => <View key={member.id} style={s.member}><View style={[s.avatar, member.speaking && s.speaking]}><Text style={s.initial}>{member.name.slice(0, 1).toUpperCase()}</Text></View><View style={s.flex}><Text style={s.label}>{member.name}{member.local ? " (você)" : ""}</Text><Text style={s.caption}>{member.quality || (member.speaking ? "Falando" : member.muted ? "Microfone fechado" : "Na conversa")}</Text></View><Text style={s.caption}>{member.muted ? "MUDO" : ""}</Text></View>)}
        <View style={s.controls}>
          <Button secondary disabled={call.status !== "connected" || call.busy || call.deafened} onPress={() => void voice.toggleMute()}>{call.muted ? "Abrir microfone" : "Fechar microfone"}</Button>
          <Button secondary disabled={call.status !== "connected" || call.busy} onPress={() => void voice.toggleDeafened()}>{call.deafened ? "Voltar a ouvir" : "Ensurdecer"}</Button>
          <Button secondary disabled={call.status !== "connected"} onPress={() => { void AudioSession.showAudioRoutePicker().catch(() => setError("Não foi possível abrir as saídas de áudio.")); }}>Saída de áudio</Button>
          <Button disabled={call.status === "leaving"} onPress={() => void voice.leave()}>Sair da chamada</Button>
        </View>
        <Text style={s.footnote}>Ao voltar a ouvir, o microfone continua fechado.</Text>
      </View>}
      {!activeCall && <Notice>{call.error}</Notice>}
      <Text style={s.footnote}>Versão inicial · canais de voz{activeCall ? "\nVocê pode bloquear a tela para testar o áudio." : ""}</Text>
    </ScrollView>
  </View>;
}

export default function App() {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [localError, setLocalError] = useState<string>();
  useEffect(() => { void session.restore(); }, []);
  return <SafeAreaProvider><SafeAreaView style={s.safe}><StatusBar style="light" />
    {state.phase === "restoring" && <View style={s.center}><Heading detail="Abrindo sua conversa…" /><ActivityIndicator color={colors.paper} /></View>}
    {state.phase === "signedOut" && <AuthScreen initialError={state.error} />}
    {state.phase === "signedIn" && <Workspace api={state.api} user={state.user} />}
    {state.phase === "offline" && <View style={s.center}><Heading detail="Vamos tentar de novo." /><Notice>{localError || state.error}</Notice><Text style={s.body}>Sua sessão continua salva neste iPhone.</Text><Button onPress={() => void session.restore()}>Tentar novamente</Button><Button secondary onPress={() => { void session.logout().catch(error => setLocalError(errorText(error))); }}>Sair da conta</Button><Button secondary onPress={() => { void Linking.openSettings(); }}>Abrir Ajustes</Button></View>}
  </SafeAreaView></SafeAreaProvider>;
}
