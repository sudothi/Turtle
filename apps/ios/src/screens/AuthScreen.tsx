import AsyncStorage from "@react-native-async-storage/async-storage";
import { inviteCode } from "../invites";
import { apiOrigin } from "../api";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { registerBody } from "@turtle/protocol";
import { session } from "../runtime";
import { errorText } from "../session";
import { Button, Field, Heading, Notice } from "../ui/components";
import { styles as s } from "../ui/theme";

const defaultOrigin = process.env.EXPO_PUBLIC_API_ORIGIN || "https://turtlechat.tech";

export default function AuthScreen({ initialError }: { initialError?: string }) {
  const [origin, setOrigin] = useState(defaultOrigin);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [serverInvite, setServerInvite] = useState("");
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
    try {
      const normalized = apiOrigin(origin.trim());
      if (serverInvite.trim()) await AsyncStorage.setItem("turtle.pendingServerInvite", JSON.stringify({ origin: normalized, code: inviteCode(serverInvite, normalized) }));
      else await AsyncStorage.removeItem("turtle.pendingServerInvite");
      await session.authenticate(normalized, username.trim(), password, register ? inviteCode(invite, normalized) : undefined);
    }
    catch (error) { setError(errorText(error)); }
    finally { setBusy(false); }
  };
  return <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={s.auth}>
      <Heading detail="Uma conversa entre amigos." />
      <View style={s.form}>
        <Text accessibilityRole="header" style={s.title}>{register ? "Chegou seu convite." : "Bom ter você aqui."}</Text>
        <Text style={s.body}>{register ? "Crie sua conta para entrar na conversa." : "Entre na sua conta para encontrar sua turma."}</Text>
        {register && <Field label="Convite de conta" value={invite} onChangeText={setInvite} editable={!busy} placeholder="Cole o código do convite" />}
        <Field label="Usuário" value={username} onChangeText={setUsername} editable={!busy} textContentType="username" autoComplete="username" placeholder="Seu nome de usuário" />
        <Field label="Senha" value={password} onChangeText={setPassword} editable={!busy} secureTextEntry textContentType={register ? "newPassword" : "password"} autoComplete={register ? "new-password" : "current-password"} onSubmitEditing={() => void submit()} returnKeyType="go" placeholder="Sua senha" />
        <Field label="Convite de servidor (opcional, após entrar)" value={serverInvite} onChangeText={setServerInvite} editable={!busy} placeholder="Código ou link do servidor" />
        <Notice>{error}</Notice>
        <Button disabled={busy} onPress={() => void submit()}>{busy ? "Conectando…" : register ? "Criar conta" : "Entrar"}</Button>
        <Button secondary disabled={busy} onPress={() => { setRegister(!register); setError(undefined); }}>{register ? "Já tenho uma conta" : "Tenho um convite"}</Button>
      </View>
      <Pressable accessibilityRole="button" onPress={() => setServerSettings(!serverSettings)} disabled={busy} style={s.link}><Text style={s.caption}>Configurar servidor</Text></Pressable>
      {serverSettings && <Field label="Endereço do servidor" value={origin} onChangeText={setOrigin} editable={!busy} keyboardType="url" placeholder="https://turtlechat.tech" />}
      <Text style={s.footnote}>Turtle para iPhone</Text>
    </ScrollView>
  </KeyboardAvoidingView>;
}

