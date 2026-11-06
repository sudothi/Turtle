import { useNavigation, type NavigationProp, type NavigatorScreenParams } from "@react-navigation/native";

export type ConversationParams = { channelId: string; title: string; serverId?: string };
export type HomeRoutes = { Home: undefined; Conversation: ConversationParams };
export type ServerRoutes = { Servers: undefined; Channels: { serverId: string; title: string }; Conversation: ConversationParams };
export type TabRoutes = {
  HomeTab: NavigatorScreenParams<HomeRoutes> | undefined;
  ServersTab: NavigatorScreenParams<ServerRoutes> | undefined;
  Settings: undefined;
};
export type RootRoutes = {
  Main: NavigatorScreenParams<TabRoutes> | undefined;
  Call: undefined;
  Members: { serverId: string; title: string };
};

// Unhandled root routes bubble from each content stack to the root navigator.
export const useAppNavigation = () => useNavigation<NavigationProp<RootRoutes & HomeRoutes & ServerRoutes>>();
