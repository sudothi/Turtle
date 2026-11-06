import { useCallback, useState, type ReactNode } from "react";
import { ActionSheetIOS, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { dmTitle, shownName, type Dm } from "@turtle/protocol";
import { useCall, useDirectory, usePresence, useRead, useWorkspace } from "../workspace-context";
import { useAppNavigation } from "../navigation/types";
import { useJoinCall } from "../navigation/call-access";
import { Avatar, Empty, ReadStatus } from "../ui/layout";
import { Icon } from "../ui/Icon";
import { TurtleMark } from "../ui/brand";
import ProfileBar from "../navigation/ProfileBar";
import { colors, fonts, styles as text } from "../ui/theme";

function SidebarRow({ title, leading, selected, onPress }: { title: string; leading: ReactNode; selected?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected: !!selected }} onPress={onPress} style={({ pressed }) => [s.row, (selected || pressed) && s.active]}>{leading}<Text numberOfLines={1} style={[s.rowLabel, selected && { color: colors.paper }]}>{title}</Text></Pressable>;
}
function Category({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return <View style={s.category}><Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={s.categoryHead}><Icon name={open ? "chevron-down" : "chevron-right"} size={12} /><Text style={[text.serverTitle, { flexShrink: 1 }]}>{title}</Text></Pressable>{open && children}</View>;
}
function RailItem({ title, selected, children, onPress }: { title: string; selected: boolean; children: ReactNode; onPress: () => void }) {
  return <View style={s.railSlot}>{selected && <View style={s.marker} />}<Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ selected }} onPress={onPress} style={({ pressed }) => [s.railIcon, selected && s.railSelected, pressed && { opacity: 0.7 }]}>{children}</Pressable></View>;
}
// Keep rail and contextual sidebar together, as on web/Android. Native-stack
// transitions provide the iPhone content/back gesture without owning the call.
export default function NavigationScreen() {
  const { workspace } = useWorkspace();
  const directory = useDirectory();
  const presence = usePresence();
  const call = useCall();
  const navigation = useAppNavigation();
  const join = useJoinCall();
  const insets = useSafeAreaInsets();
  const [profileHeight, setProfileHeight] = useState(72);
  const [place, setPlace] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const conversations = useRead<Dm[]>([], useCallback(() => workspace.api.dms(), [workspace]));
  const unread = useRead([], useCallback(() => workspace.api.unread(), [workspace]));
  const count = (id: string) => unread.data.find(item => item.channelId === id)?.count ?? 0;
  const entry = directory.data.find(value => value.server.id === place);
  const serverActions = () => {
    if (!entry) return;
    ActionSheetIOS.showActionSheetWithOptions({ title: entry.server.name, options: ["Ver membros", "Atualizar canais", "Cancelar"], cancelButtonIndex: 2 }, choice => {
      if (choice === 0) navigation.navigate("Members", { serverId: entry.server.id, title: entry.server.name });
      if (choice === 1) void workspace.directory.refresh();
    });
  };
  const openConversation = (channelId: string, title: string, serverId?: string) => {
    setSelected(channelId);
    navigation.navigate("Conversation", { channelId, title, serverId });
  };
  return <SafeAreaView edges={["left", "right"]} style={s.shell}><View style={{ flex: 1 }}>
    <View style={s.panes}>
    <SafeAreaView edges={["top", "bottom"]} style={s.rail}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[s.railContent, { paddingBottom: profileHeight + 24 }]}>
        <RailItem title="Mensagens diretas" selected={!entry} onPress={() => setPlace(undefined)}><TurtleMark color={!entry ? colors.rail : colors.paper} /></RailItem>
        <View style={s.divider} />
        {directory.data.map(({ server }) => <RailItem key={server.id} title={server.name} selected={server.id === entry?.server.id} onPress={() => setPlace(server.id)}>
          {server.icon ? <Image source={{ uri: workspace.api.fileUrl(server.icon) }} style={s.serverImage} /> : <Text allowFontScaling={false} style={[s.initials, server.id === entry?.server.id && { color: colors.rail }]}>{server.name.split(/\s+/).map(word => Array.from(word)[0]).slice(0, 3).join("").toUpperCase()}</Text>}
        </RailItem>)}
      </ScrollView>
    </SafeAreaView>
    <View style={s.sidebar}>
      <View style={{ paddingTop: insets.top }}>
        <Pressable disabled={!entry} accessibilityRole={entry ? "button" : "header"} accessibilityLabel={entry ? `Opções de ${entry.server.name}` : undefined} onPress={serverActions} style={s.header}>
          <Text numberOfLines={1} accessibilityRole="header" style={s.headerTitle}>{entry?.server.name || "Mensagens diretas"}</Text>{entry && <Icon name="chevron-down" size={18} color={colors.paper} />}
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={[s.list, { paddingBottom: profileHeight + insets.bottom + 24 }]} refreshControl={<RefreshControl refreshing={directory.loading || (!entry && conversations.loading)} onRefresh={() => { void workspace.directory.refresh(); if (!entry) conversations.refresh(); }} tintColor={colors.paper} />}>
        <ReadStatus loading={directory.loading && !directory.data.length} error={directory.error} retry={workspace.directory.refresh} />
        {!entry ? <>
          <SidebarRow title="Amigos" leading={<Icon name="users" size={24} />} selected={selected === "friends"} onPress={() => { setSelected("friends"); navigation.navigate("Friends"); }} />
          <View style={s.dmCategory}><Text style={text.serverTitle}>Conversas</Text></View>
          <ReadStatus loading={conversations.loading && !conversations.data.length} error={conversations.error} retry={conversations.refresh} />
          {conversations.data.map(dm => <SidebarRow key={dm.channelId} title={`${dmTitle(dm)}${count(dm.channelId) ? ` · ${count(dm.channelId)} não lidas` : ""}`} selected={selected === dm.channelId} leading={dm.group ? <View style={s.groupAvatar}><Icon name="users" color={colors.paperDim} /></View> : <Avatar name={dmTitle(dm)} uri={workspace.api.fileUrl(dm.users[0]?.avatar)} size={32} online={presence.online.includes(dm.users[0]?.id || "")} />} onPress={() => openConversation(dm.channelId, dmTitle(dm))} />)}
          {!conversations.loading && !conversations.error && !conversations.data.length && <Text style={[text.caption, { paddingHorizontal: 8 }]}>Nenhuma conversa ainda.</Text>}
        </> : <>
          {([['text', 'Canais de texto', 'hash'], ['voice', 'Canais de voz', 'speaker']] as const).map(([kind, title, icon]) => <Category key={kind} title={title}>
            {entry.channels.filter(channel => channel.kind === kind).map(channel => <View key={channel.id}>
              <SidebarRow title={channel.name} leading={<Icon name={icon} color={colors.faint} />} selected={kind === "voice" ? call.channelId === channel.id : selected === channel.id} onPress={() => kind === "voice" ? join(channel.id, channel.name) : openConversation(channel.id, channel.name, entry.server.id)} />
              {kind === "voice" && presence.states.filter(member => member.channelId === channel.id).map(member => <View key={member.userId} style={s.voiceMember}>
                <Avatar name={shownName(member)} uri={workspace.api.fileUrl(member.avatar)} size={24} /><Text numberOfLines={1} style={[text.caption, { flex: 1 }]}>{shownName(member)}</Text>{member.deafened ? <Icon name="headphones-off" size={14} /> : member.muted ? <Icon name="mic-off" size={14} /> : null}
              </View>)}
            </View>)}
          </Category>)}
          {!entry.channels.length && <Empty title="Nenhum canal">Os canais deste servidor aparecerão aqui.</Empty>}
        </>}
      </ScrollView>
    </View>
    </View>
    <ProfileBar onHeightChange={setProfileHeight} />
  </View></SafeAreaView>;
}

const s = StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.rail },
  panes: { flex: 1, flexDirection: "row" },
  rail: { width: 72, backgroundColor: colors.rail }, railContent: { paddingVertical: 12, gap: 8, alignItems: "center" },
  railSlot: { width: 72, alignItems: "center", justifyContent: "center", minHeight: 48 },
  railIcon: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: colors.input, overflow: "hidden" },
  railSelected: { borderRadius: 16, backgroundColor: colors.paper }, marker: { position: "absolute", left: 0, width: 4, height: 40, borderTopRightRadius: 4, borderBottomRightRadius: 4, backgroundColor: colors.paper },
  divider: { width: 32, height: 2, backgroundColor: colors.elevated, marginVertical: 2 },
  serverImage: { width: 48, height: 48 }, initials: { fontFamily: fonts.semibold, fontSize: 16, color: colors.paper },
  sidebar: { flex: 1, backgroundColor: colors.panel },
  header: { minHeight: 48, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 2, borderColor: colors.rail, flexDirection: "row", alignItems: "center", gap: 8 },
  headerTitle: { flex: 1, fontFamily: fonts.display, fontSize: 16, color: colors.paper },
  list: { paddingHorizontal: 8, paddingTop: 8, paddingBottom: 16 },
  row: { minHeight: 44, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 4, flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 },
  active: { backgroundColor: colors.active }, rowLabel: { fontFamily: fonts.medium, fontSize: 16, color: colors.muted, flex: 1 },
  category: { marginTop: 8, marginBottom: 8 }, categoryHead: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 4 },
  dmCategory: { paddingHorizontal: 8, marginTop: 16, marginBottom: 8 },
  groupAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.elevated, alignItems: "center", justifyContent: "center" },
  voiceMember: { minHeight: 32, marginLeft: 30, paddingHorizontal: 6, flexDirection: "row", alignItems: "center", gap: 8 },
});
