import { useCallback, useEffect, useState } from "react";
import { Alert, Share, Text, View } from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { MAX_OWNED_SERVERS, shownName, type Member, type InvitePreview } from "@turtle/protocol";
import { useDirectory, useRead, useWorkspace } from "../workspace-context";
import { useAppNavigation, type RootRoutes } from "../navigation/types";
import { Content, ListRow, Page, ReadStatus } from "../ui/layout";
import { Button, Field, Notice } from "../ui/components";
import { styles as text } from "../ui/theme";
import { useMutation } from "../use-mutation";
import { inviteCode } from "../invites";

export default function ServerScreen() {
  const { params } = useRoute<RouteProp<RootRoutes, "Server">>();
  const { workspace, user } = useWorkspace();
  const navigation = useAppNavigation();
  const directory = useDirectory();
  const entry = directory.data.find(item => item.server.id === params?.serverId);
  const server = entry?.server;
  const [name, setName] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [channelName, setChannelName] = useState("");
  const [kind, setKind] = useState<"text" | "voice">("text");
  const [code, setCode] = useState(params?.invite || "");
  const [preview, setPreview] = useState<{ code: string; value: InvitePreview }>();
  const [link, setLink] = useState("");
  const operation = useMutation();
  const members = useRead<Member[]>([], useCallback(() => server ? workspace.api.members(server.id) : Promise.resolve([]), [workspace, server?.id]));
  useEffect(() => { setName(server?.name || ""); }, [server?.name]);
  const change = (action: () => Promise<unknown>) => { void operation.run(async () => { await action(); await workspace.directory.refresh(); await members.refresh(); }); };
  const confirm = (title: string, detail: string, action: () => Promise<unknown>) => Alert.alert(title, detail, [{ text: "Cancelar", style: "cancel" }, { text: "Confirmar", style: "destructive", onPress: () => change(action) }]);
  const share = (value: string) => { void operation.run(async () => { await Share.share({ message: value }); }); };
  return <Page modal><Content>
    <Notice>{operation.error}</Notice>
    {params?.serverId ? server ? <>
      <Text accessibilityRole="header" style={text.title}>{server.name}</Text>
      <Text style={text.caption}>{server.role === "owner" ? "Você é o dono" : server.role === "admin" ? "Você é administrador" : "Você é membro"}</Text>
      <Button secondary disabled={operation.busy} onPress={() => change(async () => { const invite = await workspace.api.createInvite(server.id); setLink(`${workspace.api.origin}/convite/${invite.code}`); })}>Gerar convite de servidor (7 dias)</Button>
      {!!link && <><Text selectable style={text.body}>{link}</Text><Text style={text.caption}>Este convite só adiciona uma conta existente ao servidor.</Text><Button secondary disabled={operation.busy} onPress={() => share(link)}>Compartilhar convite</Button></>}
      {server.role === "owner" && <>
        <Field label="Nome do servidor" value={name} onChangeText={setName} maxLength={40} />
        <Button disabled={operation.busy || name.trim().length < 2 || name === server.name} onPress={() => change(() => workspace.api.renameServer(server.id, name))}>Salvar nome</Button>
      </>}
      {server.role !== "member" && <>
        <Text style={text.serverTitle}>Criar canal</Text>
        <Field label="Nome do canal" value={channelName} onChangeText={setChannelName} maxLength={40} />
        <View style={{ gap: 8, flexDirection: "row", flexWrap: "wrap" }}>{(["text", "voice"] as const).map(value => <Button key={value} secondary={kind !== value} onPress={() => setKind(value)}>{value === "text" ? "Texto" : "Voz"}</Button>)}</View>
        <Button disabled={operation.busy || !channelName.trim()} onPress={() => change(async () => { await workspace.api.createChannel(server.id, channelName, kind); setChannelName(""); })}>Criar canal</Button>
      </>}
      <ReadStatus loading={members.loading} error={members.error} retry={members.refresh} />
      <Text style={text.serverTitle}>Membros</Text>
      {members.data.map(member => <View key={member.userId} style={{ gap: 8, paddingVertical: 12 }}>
        <ListRow title={shownName(member)} detail={member.role === "owner" ? "Dono" : member.role === "admin" ? "Administrador" : "Membro"} onPress={() => navigation.navigate("Profile", { userId: member.userId })} />
        {member.userId !== user.id && member.role !== "owner" && <>
          {server.role === "owner" && <>
            <Button secondary disabled={operation.busy} onPress={() => confirm("Alterar cargo?", shownName(member), () => workspace.api.setRole(server.id, member.userId, member.role === "admin" ? "member" : "admin"))}>{member.role === "admin" ? "Rebaixar para membro" : "Promover a administrador"}</Button>
            <Button secondary disabled={operation.busy} onPress={() => confirmation === server.name ? confirm("Transferir posse?", `${shownName(member)} será o dono de ${server.name}. Você se tornará administrador.`, () => workspace.api.transferServer(server.id, member.userId)) : Alert.alert("Confirme o nome", "Digite o nome do servidor no campo de confirmação abaixo.")}>Transferir posse</Button>
          </>}
          {(server.role === "owner" || server.role === "admin" && member.role === "member") && <Button secondary disabled={operation.busy} onPress={() => confirm("Expulsar membro?", shownName(member), () => workspace.api.removeMember(server.id, member.userId))}>Expulsar membro</Button>}
        </>}
      </View>)}
      {server.role === "owner" ? <>
        <Field label={`Confirmação: digite ${server.name}`} value={confirmation} onChangeText={setConfirmation} />
        <Button secondary disabled={operation.busy || confirmation !== server.name} onPress={() => confirm("Excluir servidor?", "Todos os canais, mensagens e anexos serão apagados.", async () => { await workspace.api.deleteServer(server.id, confirmation); navigation.popTo("Main"); })}>Excluir servidor</Button>
      </> : <Button secondary disabled={operation.busy} onPress={() => confirm("Sair do servidor?", server.name, async () => { await workspace.api.removeMember(server.id, user.id); if (entry.channels.some(channel => channel.id === workspace.voice.getSnapshot().channelId)) await workspace.voice.leave(); navigation.popTo("Main"); })}>Sair do servidor</Button>}
    </> : !directory.loading && <Text style={text.body}>Você não tem mais acesso a este servidor.</Text> : <>
      <Text accessibilityRole="header" style={text.title}>Seu próximo servidor</Text>
      <Field label="Nome do novo servidor" value={name} onChangeText={setName} maxLength={40} />
      <Text style={text.caption}>Você pode ser dono de até {MAX_OWNED_SERVERS} servidores.</Text>
      <Button disabled={operation.busy || name.trim().length < 2 || directory.data.filter(item => item.server.ownerId === user.id).length >= MAX_OWNED_SERVERS} onPress={() => change(async () => { await workspace.api.createServer(name); navigation.popTo("Main"); })}>Criar servidor</Button>
      <Text style={text.serverTitle}>Entrar em servidor existente</Text>
      <Field label="Código ou link do convite de servidor" value={code} onChangeText={value => { setCode(value); setPreview(undefined); }} />
      <Button secondary disabled={operation.busy || !code.trim()} onPress={() => change(async () => { const parsed = inviteCode(code, workspace.api.origin); const value = await workspace.api.invitePreview(parsed); setPreview({ code: parsed, value }); })}>Conferir convite</Button>
      {preview && <><Text style={text.body}>{preview.value.serverName} · {preview.value.members} membros</Text><Button disabled={operation.busy} onPress={() => change(async () => { await workspace.api.joinInvite(preview.code); navigation.popTo("Main"); })}>Entrar no servidor</Button></>}
    </>}
  </Content></Page>;
}
