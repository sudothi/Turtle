import { View } from "react-native";
import { DarkTheme, NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import type { HomeRoutes, RootRoutes, ServerRoutes, TabRoutes } from "./types";
import TabBar from "./TabBar";
import { colors } from "../ui/theme";
import { Notice } from "../ui/components";
import { ToolbarButton } from "../ui/layout";
import { useCall, useWorkspace, useWorkspaceState } from "../workspace-context";
import HomeScreen from "../screens/HomeScreen";
import SettingsScreen from "../screens/SettingsScreen";
import CallScreen from "../screens/CallScreen";
import { ChannelsScreen, MembersAction, ServerActions, ServersScreen } from "../screens/ServersScreen";
import ConversationScreen from "../screens/ConversationScreen";
import MembersScreen from "../screens/MembersScreen";

const Root = createNativeStackNavigator<RootRoutes>();
const Home = createNativeStackNavigator<HomeRoutes>();
const Servers = createNativeStackNavigator<ServerRoutes>();
const Tabs = createBottomTabNavigator<TabRoutes>();
const theme = { ...DarkTheme, colors: { ...DarkTheme.colors, background: colors.background, card: colors.panel, primary: colors.paper, text: colors.paper, border: colors.line } };
const header = { headerStyle: { backgroundColor: colors.panel }, headerTitleStyle: { fontSize: 20, fontWeight: "800" as const }, headerTintColor: colors.paper, contentStyle: { backgroundColor: colors.background }, headerBackTitle: "Voltar" };

function HomeStack() {
  return <Home.Navigator screenOptions={header}>
    <Home.Screen name="Home" component={HomeScreen} options={{ title: "turtle." }} />
    <Home.Screen name="Conversation" component={ConversationScreen} getId={({ params }) => params.channelId} options={({ route }) => ({ title: route.params.title })} />
  </Home.Navigator>;
}
function ServerStack() {
  return <Servers.Navigator screenOptions={header}>
    <Servers.Screen name="Servers" component={ServersScreen} options={{ title: "Servidores" }} />
    <Servers.Screen name="Channels" component={ChannelsScreen} options={({ route }) => ({ title: route.params.title, headerRight: () => <ServerActions serverId={route.params.serverId} title={route.params.title} /> })} />
    <Servers.Screen name="Conversation" component={ConversationScreen} getId={({ params }) => params.channelId} options={({ route }) => ({ title: route.params.title, headerRight: () => route.params.serverId ? <MembersAction serverId={route.params.serverId} title={route.params.title} /> : null })} />
  </Servers.Navigator>;
}
function MainTabs() {
  return <Tabs.Navigator tabBar={props => <TabBar {...props} />} screenOptions={{
    headerStyle: header.headerStyle, headerTintColor: colors.paper,
    headerTitleStyle: header.headerTitleStyle,
  }}>
    <Tabs.Screen name="HomeTab" component={HomeStack} options={{ title: "Início", headerShown: false }} />
    <Tabs.Screen name="ServersTab" component={ServerStack} options={{ title: "Servidores", headerShown: false }} />
    <Tabs.Screen name="Settings" component={SettingsScreen} options={{ title: "Configurações" }} />
  </Tabs.Navigator>;
}
export default function AppNavigation() {
  const state = useWorkspaceState();
  const call = useCall();
  const { workspace } = useWorkspace();
  return <NavigationContainer theme={theme}>
    <View style={{ flex: 1 }}>
      <Root.Navigator screenOptions={header}>
        <Root.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
        <Root.Screen name="Call" component={CallScreen} options={({ navigation }) => ({ title: "Chamada", presentation: "modal", headerLeft: () => <ToolbarButton label="Fechar" onPress={() => navigation.goBack()} /> })} />
        <Root.Screen name="Members" component={MembersScreen} getId={({ params }) => params.serverId} options={({ navigation }) => ({ title: "Membros", presentation: "modal", headerLeft: () => <ToolbarButton label="Fechar" onPress={() => navigation.goBack()} /> })} />
      </Root.Navigator>
      {(state.error || (call.status === "idle" && call.error)) && <View style={{ padding: 12, gap: 4 }}><Notice>{state.error || call.error}</Notice><ToolbarButton label="Fechar aviso" onPress={() => { workspace.clearError(); workspace.voice.clearError(); }} /></View>}
    </View>
  </NavigationContainer>;
}
