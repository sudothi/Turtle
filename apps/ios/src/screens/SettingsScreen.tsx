import { Alert, Text, View } from "react-native";
import { canInviteAccounts, shownName } from "@turtle/protocol";
import { Button } from "../ui/components";
import { Avatar, Content, layout, Page } from "../ui/layout";
import { styles as text } from "../ui/theme";
import { useCall, useWorkspace, useWorkspaceState } from "../workspace-context";
import { useAppNavigation } from "../navigation/types";
import { CallDock } from "../navigation/call-access";
import { version } from "../../package.json";

export default function SettingsScreen() {
  const { workspace, user } = useWorkspace();
  const state = useWorkspaceState();
  const call = useCall();
  const navigation = useAppNavigation();
  return <Page><Content>
    <View style={layout.row}><Avatar name={shownName(user)} uri={workspace.api.fileUrl(user.avatar)} /><View style={layout.rowText}><Text accessibilityRole="header" style={text.subtitle}>{shownName(user)}</Text><Text style={text.caption}>@{user.username}</Text></View></View>
    {canInviteAccounts(user) && <Button secondary onPress={() => navigation.navigate("Admin")}>Administração e convites de conta</Button>}
    <Button secondary onPress={() => navigation.navigate("Blocks")}>Pessoas bloqueadas</Button>
    <Text accessibilityRole="header" style={text.serverTitle}>Conexão</Text>
    <Text selectable style={text.body}>{workspace.api.origin}</Text>
    {call.status !== "idle" && <Button secondary onPress={() => navigation.navigate("Call")}>Abrir chamada e áudio</Button>}
    <Button secondary disabled={state.signingOut} onPress={() => Alert.alert("Sair da conta?", call.status === "idle" ? "Você precisará entrar novamente neste iPhone." : "A chamada será encerrada neste iPhone.", [
      { text: "Cancelar", style: "cancel" }, { text: "Sair da conta", style: "destructive", onPress: () => { void workspace.logout(); } },
    ])}>{state.signingOut ? "Saindo…" : "Sair da conta"}</Button>
    <Text style={text.footnote}>Turtle para iPhone · versão {version}</Text>
  </Content><CallDock onOpen={() => navigation.navigate("Call")} /></Page>;
}
