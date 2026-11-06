import { Text, View } from "react-native";
import { DarkTheme, NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { BottomTabBar, createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import type { HomeRoutes, RootRoutes, ServerRoutes, TabRoutes } from "./types";
import { CallDock } from "./call-access";
import { colors, styles as text } from "../ui/theme";
import { Notice } from "../ui/components";
import { ToolbarButton } from "../ui/layout";
import { useCall, useWorkspaceState } from "../workspace-context";
import HomeScreen from "../screens/HomeScreen";
import SettingsScreen from "../screens/SettingsScreen";
import CallScreen from "../screens/CallScreen";
import { ChannelsScreen, ServersScreen } from "../screens/ServersScreen";

const Root = createNativeStackNavigator<RootRoutes>();
const Home = createNativeStackNavigator<HomeRoutes>();
const Servers = createNativeStackNavigator<ServerRoutes>();
const Tabs = createBottomTabNavigator<TabRoutes>();
const theme = { ...DarkTheme, colors: { ...DarkTheme.colors, background: colors.background, card: colors.panel, primary: colors.paper, text: colors.paper, border: colors.line } };
const header = { headerStyle: { backgroundColor: colors.panel }, headerTintColor: colors.paper, contentStyle: { backgroundColor: colors.background }, headerBackTitle: "Voltar" };

function HomeStack() {
  return <Home.Navigator screenOptions={header}><Home.Screen name="Home" component={HomeScreen} options={{ title: "turtle." }} /></Home.Navigator>;
}
function ServerStack() {
  return <Servers.Navigator screenOptions={header}>
    <Servers.Screen name="Servers" component={ServersScreen} options={{ title: "Servidores" }} />
    <Servers.Screen name="Channels" component={ChannelsScreen} options={({ route }) => ({ title: route.params.title })} />
  </Servers.Navigator>;
}
function MainTabs() {
  return <Tabs.Navigator tabBar={props => <View><CallDock /><BottomTabBar {...props} /></View>} screenOptions={{
    headerStyle: header.headerStyle, headerTintColor: colors.paper,
    tabBarActiveTintColor: colors.paper, tabBarInactiveTintColor: colors.muted,
    tabBarStyle: { backgroundColor: colors.panel, borderTopColor: colors.line },
    tabBarLabelStyle: { fontSize: 12, fontWeight: "600" },
  }}>
    <Tabs.Screen name="HomeTab" component={HomeStack} options={{ title: "Início", headerShown: false, tabBarIcon: ({ color }) => <Text accessible={false} style={{ color, fontSize: 22 }}>⌂</Text> }} />
    <Tabs.Screen name="ServersTab" component={ServerStack} options={{ title: "Servidores", headerShown: false, tabBarIcon: ({ color }) => <Text accessible={false} style={{ color, fontSize: 22 }}>☷</Text> }} />
    <Tabs.Screen name="Settings" component={SettingsScreen} options={{ title: "Configurações", tabBarIcon: ({ color }) => <Text accessible={false} style={{ color, fontSize: 22 }}>⚙</Text> }} />
  </Tabs.Navigator>;
}
export default function AppNavigation() {
  const state = useWorkspaceState();
  const call = useCall();
  return <NavigationContainer theme={theme}>
    <View style={{ flex: 1 }}>
      <Root.Navigator screenOptions={header}>
        <Root.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
        <Root.Screen name="Call" component={CallScreen} options={({ navigation }) => ({ title: "Chamada", presentation: "modal", headerLeft: () => <ToolbarButton label="Fechar" onPress={() => navigation.goBack()} /> })} />
      </Root.Navigator>
      {(state.error || (call.status === "idle" && call.error)) && <View style={{ padding: 12 }}><Notice>{state.error || call.error}</Notice></View>}
    </View>
  </NavigationContainer>;
}
