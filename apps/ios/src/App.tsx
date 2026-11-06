import { useEffect, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Linking, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { session } from "./runtime";
import { errorText } from "./session";
import AuthScreen from "./screens/AuthScreen";
import AppNavigation from "./navigation/AppNavigation";
import { WorkspaceProvider } from "./workspace-context";
import { Button, Heading, Notice } from "./ui/components";
import { colors, styles as s } from "./ui/theme";
import { useBrandFonts } from "./ui/fonts";

export default function App() {
  const [fontsReady, fontError] = useBrandFonts();
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [localError, setLocalError] = useState<string>();
  useEffect(() => { void session.restore(); }, []);
  if (!fontsReady && !fontError) return <View style={[s.center, { backgroundColor: colors.background }]}><StatusBar style="light" /><ActivityIndicator color={colors.paper} accessibilityLabel="Abrindo Turtle" /></View>;
  return <SafeAreaProvider>
    <View style={s.safe}>
      <StatusBar style="light" />
      {state.phase === "signedIn" ? (
        <WorkspaceProvider api={state.api} user={state.user}><AppNavigation /></WorkspaceProvider>
      ) : (
        <SafeAreaView style={s.flex}>
          {state.phase === "restoring" && <View style={s.center}>
            <Heading detail="Abrindo sua conversa…" />
            <ActivityIndicator color={colors.paper} accessibilityLabel="Restaurando sessão" />
          </View>}
          {state.phase === "signedOut" && <AuthScreen initialError={state.error} />}
          {state.phase === "offline" && <View style={s.center}>
            <Heading detail="Vamos tentar de novo." />
            <Notice>{localError || state.error}</Notice>
            <Text style={s.body}>Sua sessão continua salva neste iPhone.</Text>
            <Button onPress={() => { setLocalError(undefined); void session.restore(); }}>Tentar novamente</Button>
            <Button secondary onPress={() => { void session.logout().catch(error => setLocalError(errorText(error))); }}>Sair da conta</Button>
            <Button secondary onPress={() => { void Linking.openSettings().catch(error => setLocalError(errorText(error))); }}>Abrir Ajustes</Button>
          </View>}
        </SafeAreaView>
      )}
    </View>
  </SafeAreaProvider>;
}
