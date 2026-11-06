import { useNavigation, type NavigationProp } from "@react-navigation/native";

export type ConversationParams = { channelId: string; title: string; serverId?: string };
export type RootRoutes = {
  Main: undefined;
  Friends: undefined;
  Conversation: ConversationParams;
  Settings: undefined;
  Call: undefined;
  Members: { serverId: string; title: string };
};

export const useAppNavigation = () => useNavigation<NavigationProp<RootRoutes>>();
