import { Text } from "react-native";
import { shownName } from "@turtle/protocol";
import { useWorkspace } from "../workspace-context";
import { Button } from "../ui/components";
import { Content, Page } from "../ui/layout";
import { styles as text } from "../ui/theme";
import { useAppNavigation } from "../navigation/types";

export default function HomeScreen() {
  const { user } = useWorkspace();
  const navigation = useAppNavigation();
  return <Page><Content>
    <Text accessibilityRole="header" style={text.title}>Olá, {shownName(user)}.</Text>
    <Text style={text.body}>Um lugar para encontrar sua turma e continuar a conversa.</Text>
    <Button onPress={() => navigation.navigate("Main", { screen: "ServersTab" })}>Ver servidores</Button>
  </Content></Page>;
}
