import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Alert, AppState, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { AudioSession } from "@livekit/react-native";
import { registerBody, shownName, type Channel, type Server, type User } from "@turtle/protocol";
import { Api, ApiError } from "./api";
import { Gateway } from "./gateway";
import { session } from "./runtime";
import { errorText } from "./session";
import { Voice } from "./voice";

const defaultOrigin = process.env.EXPO_PUBLIC_API_ORIGIN || "https://app.ogturtle.xyz";
const colors = { background: "#111111", panel: "#0a0a0a", input: "#1a1a1a", paper: "#f5f3ee", muted: "#9a9790", line: "#2a2a2a" };

function Button({ children, onPress, disabled, secondary = false, label }: { children: string; onPress: () => void; disabled?: boolean; secondary?: boolean; label?: string }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label || children} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [s.button, secondary && s.secondary, (pressed || disabled) && { opacity: disabled ? 0.4 : 0.7 }]}>
    <Text style={[s.buttonText, secondary && { color: colors.paper }]}>{children}</Text>
  </Pressable>;
}
function Notice({ children }: { children?: string }) {
  return children ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.notice}>{children}</Text> : null;
}
function Heading({ detail }: { detail: string }) {
  return <View style={s.heading}><Text style={s.wordmark}>turtle<Text style={{ color: colors.muted }}>.</Text></Text><Text style={s.caption}>{detail}</Text></View>;
}

function Auth({ initialError }: { initialError?: string }) {
  const [origin, setOrigin] = useState(defaultOrigin);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [invite, setInvite] = useState("");
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const [serverSettings, setServerSettings] = useState(false);
  const submit = async () => {
    if (busy) return;
    if (!username.trim() || !password) return setError("Preencha seu usuário e sua senha.");
    if (register && !registerBody.safeParse({ username: username.trim(), password, inviteCode: invite.trim() }).success) {
      return setError("Use um convite de conta, usuário de 2 a 32 caracteres (letras, números, _, . ou -) e senha de 8 a 200 caracteres.");
    }
    setBusy(true); setError(undefined);
    try { await session.authenticate(origin.trim(), username.trim(), password, register ? invite.trim() : undefined); }
    catch (error) { setError(errorText(error)); }
    finally { setBusy(false); }
  };
  return <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.auth}>
      <Heading detail="Uma conversa entre amigos." />
      <View style={s.form}>
        <Text accessibilityRole="header" style={s.title}>{register ? "Chegou seu convite." : "Bom ter você aqui."}</Text>
        <Text style={s.body}>{register ? "Crie sua conta para entrar na conversa." : "Entre na sua conta para encontrar sua turma."}</Text>
        {register && <Field label="Convite de conta" value={invite} onChangeText={setInvite} editable={!busy} placeholder="Cole o código do convite" />}
        <Field label="Usuário" value={username} onChangeText={setUsername} editable={!busy} textContentType="username" autoComplete="username" placeholder="Seu nome de usuário" />
        <Field label="Senha" value={password} onChangeText={setPassword} editable={!busy} secureTextEntry textContentType={register ? "newPassword" : "password"} autoComplete={register ? "new-password" : "current-password"} onSubmitEditing={() => void submit()} returnKeyType="go" placeholder="Sua senha" />
        <Notice>{error}</Notice>
        <Button disabled={busy} onPress={() => void submit()}>{busy ? "Conectando…" : register ? "Criar conta" : "Entrar"}</Button>
        <Button secondary disabled={busy} onPress={() => { setRegister(!register); setError(undefined); }}>{register ? "Já tenho uma conta" : "Tenho um convite"}</Button>
      </View>
      <Pressable accessibilityRole="button" onPress={() => setServerSettings(!serverSettings)} disabled={busy} style={s.link}><Text style={s.caption}>Configurar servidor</Text></Pressable>
      {serverSettings && <Field label="Endereço do servidor" value={origin} onChangeText={setOrigin} editable={!busy} keyboardType="url" placeholder="https://app.ogturtle.xyz" />}
      <Text style={s.footnote}>Primeira versão · voz no iPhone</Text>
    </ScrollView>
  </KeyboardAvoidingView>;
}

function Field({ label, ...props }: React.ComponentProps<typeof TextInput> & { label: string }) {
  return <View style={s.field}><Text style={s.label}>{label}</Text><TextInput accessibilityLabel={label} autoCapitalize="none" autoCorrect={false} placeholderTextColor={colors.muted} selectionColor={colors.paper} style={s.input} {...props} /></View>;
}

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
    {state.phase === "signedOut" && <Auth initialError={state.error} />}
    {state.phase === "signedIn" && <Workspace api={state.api} user={state.user} />}
    {state.phase === "offline" && <View style={s.center}><Heading detail="Vamos tentar de novo." /><Notice>{localError || state.error}</Notice><Text style={s.body}>Sua sessão continua salva neste iPhone.</Text><Button onPress={() => void session.restore()}>Tentar novamente</Button><Button secondary onPress={() => { void session.logout().catch(error => setLocalError(errorText(error))); }}>Sair da conta</Button><Button secondary onPress={() => { void Linking.openSettings(); }}>Abrir Ajustes</Button></View>}
  </SafeAreaView></SafeAreaProvider>;
}

const s = StyleSheet.create({
  flex: { flex: 1 }, safe: { flex: 1, backgroundColor: colors.background },
  auth: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 40, paddingBottom: 24, gap: 20 },
  heading: { gap: 8, marginBottom: 28 }, wordmark: { fontSize: 64, fontWeight: "900", color: colors.paper, letterSpacing: -4 }, smallWordmark: { fontSize: 25, fontWeight: "900", color: colors.paper, letterSpacing: -1 },
  form: { gap: 16 }, title: { fontSize: 28, fontWeight: "800", color: colors.paper, letterSpacing: -0.8 }, subtitle: { fontSize: 18, fontWeight: "600", color: colors.paper },
  body: { fontSize: 16, color: colors.muted, lineHeight: 24 }, caption: { fontSize: 13, color: colors.muted, lineHeight: 19 }, label: { fontSize: 15, color: colors.paper, fontWeight: "600" },
  field: { gap: 8 }, input: { minHeight: 52, borderWidth: 1, borderColor: colors.line, borderRadius: 8, backgroundColor: colors.input, color: colors.paper, fontSize: 17, paddingHorizontal: 14, paddingVertical: 12 },
  button: { minHeight: 50, borderRadius: 8, backgroundColor: colors.paper, justifyContent: "center", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1, borderColor: colors.paper },
  secondary: { backgroundColor: "transparent", borderColor: colors.line }, buttonText: { fontSize: 16, fontWeight: "700", textAlign: "center", color: colors.background },
  notice: { padding: 12, borderLeftWidth: 2, borderLeftColor: colors.paper, backgroundColor: colors.input, color: colors.paper, fontSize: 15, lineHeight: 22 },
  link: { minHeight: 44, justifyContent: "center" }, footnote: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 8 }, center: { flex: 1, justifyContent: "center", padding: 24, gap: 16 },
  topbar: { paddingHorizontal: 24, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.line, flexDirection: "row", alignItems: "center" }, exit: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  content: { padding: 24, gap: 20, paddingBottom: 40 }, sectionHeading: { gap: 8 }, empty: { paddingVertical: 20, gap: 12 }, server: { gap: 10 }, serverTitle: { fontSize: 12, fontWeight: "800", color: colors.muted, textTransform: "uppercase", letterSpacing: 1.5 },
  channel: { minHeight: 76, borderWidth: 1, borderColor: colors.line, borderRadius: 8, padding: 16, flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: colors.panel }, selectedChannel: { borderColor: colors.paper }, channelSymbol: { color: colors.paper, fontSize: 24 },
  call: { gap: 14, paddingTop: 24, borderTopWidth: 2, borderTopColor: colors.paper }, controls: { gap: 10, marginTop: 8 }, member: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56 }, avatar: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: colors.line, backgroundColor: colors.input, alignItems: "center", justifyContent: "center" }, speaking: { borderColor: colors.paper }, initial: { color: colors.paper, fontSize: 18, fontWeight: "700" },
});
