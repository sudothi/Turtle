import { useCallback } from "react";
import { Text, View } from "react-native";
import { shownName, type Person } from "@turtle/protocol";
import { useRead, useWorkspace } from "../workspace-context";
import { useMutation } from "../use-mutation";
import { Avatar, Content, Empty, Page, ReadStatus } from "../ui/layout";
import { Button, Notice } from "../ui/components";
import { styles as text } from "../ui/theme";

export default function BlocksScreen() {
  const { workspace } = useWorkspace();
  const people = useRead<Person[]>([], useCallback(() => workspace.api.blocks(), [workspace]));
  const operation = useMutation();
  return <Page modal><Content>
    <ReadStatus loading={people.loading} error={people.error} retry={people.refresh} />
    <Notice>{operation.error}</Notice>
    {people.data.map(person => <View key={person.id} style={{ gap: 12, paddingVertical: 12 }}>
      <Avatar name={shownName(person)} uri={workspace.api.fileUrl(person.avatar)} />
      <Text style={text.label}>{shownName(person)}</Text>
      <Button secondary disabled={operation.busy} onPress={() => { void operation.run(async () => { await workspace.api.unblock(person.id); await people.refresh(); }); }}>Desbloquear</Button>
    </View>)}
    {!people.loading && !people.error && !people.data.length && <Empty title="Nenhuma pessoa bloqueada">Você pode bloquear alguém pelo perfil.</Empty>}
  </Content></Page>;
}
