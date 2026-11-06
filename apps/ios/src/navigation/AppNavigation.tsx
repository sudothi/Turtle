import AsyncStorage from "@react-native-async-storage/async-storage";
import { Alert, Text, View } from "react-native";
import { DarkTheme, NavigationContainer, useNavigationContainerRef } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { RootRoutes } from "./types";
import { colors, fonts, styles as text } from "../ui/theme";
import { SafeAreaView } from "react-native-safe-area-context";
import { shownName } from "@turtle/protocol";
import { Button, Notice } from "../ui/components";
import { IconButton } from "../ui/layout";
import { Icon } from "../ui/Icon";
import { useCall, usePresence, useWorkspace, useWorkspaceState } from "../workspace-context";
import NavigationScreen from "../screens/NavigationScreen";
import FriendsScreen from "../screens/HomeScreen";
import SettingsScreen from "../screens/SettingsScreen";
import CallScreen from "../screens/CallScreen";
import ConversationScreen from "../screens/ConversationScreen";
import MembersScreen from "../screens/MembersScreen";

import EditProfileScreen from "../screens/EditProfileScreen";
import ServerScreen from "../screens/ServerScreen";
import AdminScreen from "../screens/AdminScreen";
import BlocksScreen from "../screens/BlocksScreen";
import ProfileScreen from "../screens/ProfileScreen";
import GroupScreen from "../screens/GroupScreen";

const Root = createNativeStackNavigator<RootRoutes>();
const theme = { ...DarkTheme, colors: { ...DarkTheme.colors, background: colors.background, card: colors.panel, primary: colors.paper, text: colors.paper, border: colors.rail } };

export default function AppNavigation() {
  const navigationRef = useNavigationContainerRef<RootRoutes>();
  const state = useWorkspaceState();
  const call = useCall();
  const presence = usePresence();
  const { workspace } = useWorkspace();
  return <NavigationContainer ref={navigationRef} theme={theme} onReady={() => {
    void AsyncStorage.getItem("turtle.pendingServerInvite").then(async raw => {
      if (!raw) return;
      const saved = JSON.parse(raw) as { origin?: string; code?: string };
      if (saved.origin === workspace.api.origin && typeof saved.code === "string") navigationRef.navigate("Server", { invite: saved.code });
      await AsyncStorage.removeItem("turtle.pendingServerInvite");
    }).catch(() => {});
  }}>
    <View style={{ flex: 1 }}>
      {presence.ring && presence.ring.channelId !== call.channelId && <SafeAreaView edges={["top", "left", "right"]} accessibilityLiveRegion="polite" style={{ padding: 12, gap: 8, backgroundColor: colors.userPanel }}>
        <Text style={text.label}>{shownName(presence.ring.from)} está chamando</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
          <Button onPress={() => {
            const ring = presence.ring;
            if (!ring) return;
            const accept = async () => { workspace.gateway.dismissRing(); if (workspace.voice.getSnapshot().status !== "idle") await workspace.voice.leave(); const entering = workspace.enter(ring.channelId, `Chamada com ${shownName(ring.from)}`, true); navigationRef.navigate("Call"); await entering; };
            if (call.status !== "idle") Alert.alert("Trocar de chamada?", "Você sairá da chamada atual para atender.", [{ text: "Cancelar", style: "cancel" }, { text: "Atender", onPress: () => { void accept(); } }]); else void accept();
          }}>Atender</Button>
          <Button secondary onPress={() => workspace.gateway.dismissRing(true)}>Recusar</Button>
        </View>
      </SafeAreaView>}
      <Root.Navigator screenOptions={({ navigation }) => ({
        headerStyle: { backgroundColor: colors.panel }, headerTintColor: colors.paper,
        headerTitleStyle: { fontFamily: fonts.semibold, fontSize: 16 },
        headerShadowVisible: false, contentStyle: { backgroundColor: colors.background },
        headerLeft: () => <IconButton name="chevron-left" label="Voltar" onPress={() => navigation.goBack()} />,
      })}>
        <Root.Screen name="Main" component={NavigationScreen} options={{ headerShown: false }} />
        <Root.Screen name="Friends" component={FriendsScreen} options={{ title: "Amigos" }} />
        <Root.Screen name="Conversation" component={ConversationScreen} getId={({ params }) => params.channelId} options={({ route, navigation }) => ({
          title: route.params.title,
          headerTitle: () => <View style={{ flexDirection: "row", alignItems: "center", gap: 8, maxWidth: 240 }}><Icon name={route.params.serverId ? "hash" : "chat"} /><Text numberOfLines={1} style={[text.label, { flexShrink: 1 }]}>{route.params.title}</Text></View>,
          headerRight: () => route.params.serverId ? <IconButton name="users" label="Membros do servidor" onPress={() => navigation.navigate("Members", { serverId: route.params.serverId!, title: route.params.title })} /> : <IconButton name="users" label="Participantes e opções" onPress={() => navigation.navigate("Group", { channelId: route.params.channelId })} />,
        })} />
        <Root.Screen name="EditProfile" component={EditProfileScreen} options={{ title: "Meu perfil", presentation: "modal" }} />
        <Root.Screen name="Server" component={ServerScreen} options={{ title: "Servidor", presentation: "modal" }} />
        <Root.Screen name="Admin" component={AdminScreen} options={{ title: "Administração", presentation: "modal" }} />
        <Root.Screen name="Blocks" component={BlocksScreen} options={{ title: "Pessoas bloqueadas", presentation: "modal" }} />
        <Root.Screen name="Profile" component={ProfileScreen} options={{ title: "Perfil", presentation: "modal" }} />
        <Root.Screen name="Group" component={GroupScreen} options={{ title: "Grupo e participantes", presentation: "modal" }} />
        <Root.Screen name="Call" component={CallScreen} options={({ navigation }) => ({ title: "Chamada", presentation: "modal", headerLeft: () => <IconButton name="chevron-down" label="Fechar chamada sem sair" onPress={() => navigation.goBack()} /> })} />
        <Root.Screen name="Members" component={MembersScreen} getId={({ params }) => params.serverId} options={({ navigation }) => ({ title: "Membros", presentation: "modal", headerLeft: () => <IconButton name="close" label="Fechar membros" onPress={() => navigation.goBack()} /> })} />
        <Root.Screen name="Settings" component={SettingsScreen} options={({ navigation }) => ({ title: "Configurações", presentation: "modal", headerLeft: () => <IconButton name="close" label="Fechar configurações" onPress={() => navigation.goBack()} /> })} />
      </Root.Navigator>
      {(state.error || (call.status === "idle" && call.error)) && <View style={{ padding: 12, gap: 4 }}><Notice>{state.error || call.error}</Notice><IconButton name="close" label="Fechar aviso" onPress={() => { workspace.clearError(); workspace.voice.clearError(); }} /></View>}
    </View>
  </NavigationContainer>;
}
