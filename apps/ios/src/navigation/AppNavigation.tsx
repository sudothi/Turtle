import { Text, View } from "react-native";
import { DarkTheme, NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { RootRoutes } from "./types";
import { colors, fonts, styles as text } from "../ui/theme";
import { Notice } from "../ui/components";
import { IconButton } from "../ui/layout";
import { Icon } from "../ui/Icon";
import { useCall, useWorkspace, useWorkspaceState } from "../workspace-context";
import NavigationScreen from "../screens/NavigationScreen";
import FriendsScreen from "../screens/HomeScreen";
import SettingsScreen from "../screens/SettingsScreen";
import CallScreen from "../screens/CallScreen";
import ConversationScreen from "../screens/ConversationScreen";
import MembersScreen from "../screens/MembersScreen";

const Root = createNativeStackNavigator<RootRoutes>();
const theme = { ...DarkTheme, colors: { ...DarkTheme.colors, background: colors.background, card: colors.panel, primary: colors.paper, text: colors.paper, border: colors.rail } };

export default function AppNavigation() {
  const state = useWorkspaceState();
  const call = useCall();
  const { workspace } = useWorkspace();
  return <NavigationContainer theme={theme}>
    <View style={{ flex: 1 }}>
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
          headerRight: () => route.params.serverId ? <IconButton name="users" label="Membros do servidor" onPress={() => navigation.navigate("Members", { serverId: route.params.serverId!, title: route.params.title })} /> : null,
        })} />
        <Root.Screen name="Call" component={CallScreen} options={({ navigation }) => ({ title: "Chamada", presentation: "modal", headerLeft: () => <IconButton name="chevron-down" label="Fechar chamada sem sair" onPress={() => navigation.goBack()} /> })} />
        <Root.Screen name="Members" component={MembersScreen} getId={({ params }) => params.serverId} options={({ navigation }) => ({ title: "Membros", presentation: "modal", headerLeft: () => <IconButton name="close" label="Fechar membros" onPress={() => navigation.goBack()} /> })} />
        <Root.Screen name="Settings" component={SettingsScreen} options={({ navigation }) => ({ title: "Configurações", presentation: "modal", headerLeft: () => <IconButton name="close" label="Fechar configurações" onPress={() => navigation.goBack()} /> })} />
      </Root.Navigator>
      {(state.error || (call.status === "idle" && call.error)) && <View style={{ padding: 12, gap: 4 }}><Notice>{state.error || call.error}</Notice><IconButton name="close" label="Fechar aviso" onPress={() => { workspace.clearError(); workspace.voice.clearError(); }} /></View>}
    </View>
  </NavigationContainer>;
}
