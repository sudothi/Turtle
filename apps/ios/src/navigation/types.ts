import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

export type ConversationParams = { channelId: string; title: string; serverId?: string };
export type RootRoutes = {
  Main: undefined;
  Friends: undefined;
  Server: { serverId?: string; invite?: string } | undefined;
  Admin: undefined;
  Blocks: undefined;
  Profile: { userId: string };
  Group: { channelId?: string } | undefined;
  Conversation: ConversationParams;
  Settings: undefined;
  Call: undefined;
  Members: { serverId: string; title: string };
};

export const useAppNavigation = () => useNavigation<NativeStackNavigationProp<RootRoutes>>();
