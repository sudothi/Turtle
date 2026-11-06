import { useCallback, useState } from "react";
import { Alert, Share, Text, View } from "react-native";
import { canInviteAccounts, shownName, type Account } from "@turtle/protocol";
import { useRead, useWorkspace } from "../workspace-context";
import { useMutation } from "../use-mutation";
import { Content, Page, ReadStatus } from "../ui/layout";
import { Button, Notice } from "../ui/components";
import { styles as text } from "../ui/theme";

export default function AdminScreen() {
  const { workspace, user } = useWorkspace();
  const accounts = useRead<Account[]>([], useCallback(() => user.isAdmin ? workspace.api.accounts() : Promise.resolve([]), [workspace, user.isAdmin]));
  const operation = useMutation();
  const [link, setLink] = useState("");
  const change = (id: string, body: { disabled?: boolean; canInvite?: boolean }) => { void operation.run(async () => { await workspace.api.setAccount(id, body); await accounts.refresh(); }); };
  return <Page modal><Content>
    <Notice>{operation.error}</Notice>
    {canInviteAccounts(user) && <>
      <Text style={text.body}>Convite de conta permite o cadastro. A conta nova começa sem servidor.</Text>
      <Button disabled={operation.busy} onPress={() => { void operation.run(async () => { const result = await workspace.api.createAccountInvite(); setLink(`${workspace.api.origin}/convite/${result.code}`); }); }}>Gerar convite de conta</Button>
      {!!link && <><Text selectable style={text.body}>{link}</Text><Button secondary onPress={() => { void operation.run(async () => { await Share.share({ message: link }); }); }}>Compartilhar convite</Button></>}
    </>}
    {user.isAdmin && <>
      <ReadStatus loading={accounts.loading} error={accounts.error} retry={accounts.refresh} />
      {accounts.data.map(account => <View key={account.id} style={{ gap: 8, paddingVertical: 12 }}>
        <Text style={text.label}>{shownName(account)}</Text><Text style={text.caption}>{account.isAdmin ? "Administrador" : account.canInvite ? "Convidador" : "Conta"}{account.disabled ? " · Desativada" : ""}</Text>
        {!account.isAdmin && <Button secondary disabled={operation.busy} onPress={() => change(account.id, { canInvite: !account.canInvite })}>{account.canInvite ? "Remover cargo Convidador" : "Dar cargo Convidador"}</Button>}
        {!account.isAdmin && account.id !== user.id && <Button secondary disabled={operation.busy} onPress={() => Alert.alert(account.disabled ? "Reativar conta?" : "Desativar conta?", account.disabled ? shownName(account) : "As sessões e chamadas desta pessoa serão encerradas.", [{ text: "Cancelar", style: "cancel" }, { text: "Confirmar", style: "destructive", onPress: () => change(account.id, { disabled: !account.disabled }) }])}>{account.disabled ? "Reativar conta" : "Desativar conta"}</Button>}
      </View>)}
    </>}
  </Content></Page>;
}
