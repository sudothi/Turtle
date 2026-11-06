import { useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { shownName } from "@turtle/protocol";
import { useCall, usePresence, useWorkspace } from "../workspace-context";
import { Avatar, IconButton } from "../ui/layout";
import { Icon, type IconName } from "../ui/Icon";
import { colors, fonts, styles as text } from "../ui/theme";
import { useAppNavigation } from "./types";
import { callStatus } from "./call-access";

function ProfileAction({ icon, label, onPress, disabled = false }: { icon: IconName; label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [s.action, pressed && { backgroundColor: colors.active }, disabled && { opacity: 0.35 }]}><Icon name={icon} color={colors.paperDim} /><Text style={[text.label, { flex: 1 }]}>{label}</Text></Pressable>;
}

/** Floating account access across both navigation columns; media stays in WorkspaceSession. */
export default function ProfileBar({ onHeightChange }: { onHeightChange: (height: number) => void }) {
  const { user, workspace } = useWorkspace();
  const call = useCall();
  const presence = usePresence();
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const afterDismiss = useRef<(() => void) | undefined>(undefined);
  const inCall = call.status !== "idle";
  const status = inCall ? callStatus(call.status) : !presence.connected ? "Reconectando…" : presence.busy.includes(user.id) ? "Não perturbe" : "Online";
  const dismiss = (next?: () => void) => { afterDismiss.current = next; setOpen(false); };
  const openRoute = (route: "Settings" | "Call") => dismiss(() => navigation.navigate(route));
  return <>
    <View pointerEvents="box-none" style={[s.floating, { bottom: insets.bottom + 8 }]}>
      <View onLayout={({ nativeEvent }) => onHeightChange(nativeEvent.layout.height)} style={s.bar}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${shownName(user)}. ${status}. Abrir perfil e ações`} accessibilityState={{ expanded: open }} onPress={() => setOpen(true)} style={({ pressed }) => [s.identity, pressed && { opacity: 0.7 }]}>
          <Avatar name={shownName(user)} uri={workspace.api.fileUrl(user.avatar)} size={56} online={presence.connected} />
          <View style={s.summary}>
            <View style={s.nameRow}><Text numberOfLines={1} style={s.name}>{shownName(user)}</Text><Icon name="chevron-down" size={16} /></View>
            <View style={s.statusRow}>{inCall && <Icon name="speaker" size={14} color={colors.paper} />}<Text numberOfLines={1} style={text.caption}>{status}</Text></View>
          </View>
        </Pressable>
        <IconButton name={inCall ? "speaker" : "settings"} label={inCall ? `Abrir chamada ${call.channelName}` : "Configurações"} onPress={() => navigation.navigate(inCall ? "Call" : "Settings")} />
      </View>
    </View>
    <Modal visible={open} transparent animationType="slide" supportedOrientations={["portrait", "landscape"]} onRequestClose={() => dismiss()} onDismiss={() => {
      // Wait for the native sheet to dismiss before presenting another native modal.
      const next = afterDismiss.current;
      afterDismiss.current = undefined;
      next?.();
    }}>
      <View style={s.overlay}>
        <Pressable accessibilityRole="button" accessibilityLabel="Fechar perfil" onPress={() => dismiss()} style={StyleSheet.absoluteFill} />
        <View accessibilityViewIsModal style={[s.sheet, { maxHeight: height - insets.top - 16, paddingLeft: Math.max(insets.left, 16), paddingRight: Math.max(insets.right, 16), paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={s.handle} />
          <View style={s.sheetHeader}>
            <Avatar name={shownName(user)} uri={workspace.api.fileUrl(user.avatar)} size={56} online={presence.connected} />
            <View style={s.summary}><Text accessibilityRole="header" style={text.subtitle}>{shownName(user)}</Text><Text style={text.caption}>@{user.username}</Text><Text style={text.caption}>{status}</Text></View>
            <IconButton name="close" label="Fechar perfil" onPress={() => dismiss()} />
          </View>
          <ScrollView bounces={false} contentContainerStyle={s.actions}>
            {inCall && <>
              <Text accessibilityRole="header" style={[text.serverTitle, { paddingHorizontal: 12, marginTop: 8 }]}>{call.channelName}</Text>
              <ProfileAction icon="speaker" label="Abrir chamada e áudio" onPress={() => openRoute("Call")} />
              <ProfileAction icon={call.muted ? "mic-off" : "mic"} label={call.muted ? "Abrir microfone" : "Fechar microfone"} disabled={call.status !== "connected" || call.busy || call.deafened} onPress={() => { void workspace.voice.toggleMute(); }} />
              <ProfileAction icon={call.deafened ? "headphones-off" : "headphones"} label={call.deafened ? "Voltar a ouvir" : "Ensurdecer"} disabled={call.status !== "connected" || call.busy} onPress={() => { void workspace.voice.toggleDeafened(); }} />
              <ProfileAction icon="phone-off" label="Sair da chamada" disabled={call.status === "leaving"} onPress={() => { void workspace.voice.leave(); }} />
              <View style={s.divider} />
            </>}
            <ProfileAction icon="settings" label="Configurações" onPress={() => openRoute("Settings")} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  </>;
}

const s = StyleSheet.create({
  floating: { position: "absolute", left: 0, right: 0, paddingHorizontal: 16, alignItems: "center" },
  bar: { width: "100%", maxWidth: 560, minHeight: 72, flexDirection: "row", alignItems: "center", padding: 8, paddingRight: 12, gap: 8, borderRadius: 24, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.userPanel, shadowColor: colors.rail, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12 },
  identity: { flex: 1, minWidth: 0, minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12 },
  summary: { flex: 1, minWidth: 0, gap: 3 }, nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: { flexShrink: 1, fontFamily: fonts.bold, fontSize: 16, color: colors.paper },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.65)" },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderBottomWidth: 0, borderColor: colors.line },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.faint, alignSelf: "center", marginTop: 10, marginBottom: 16 },
  sheetHeader: { flexDirection: "row", alignItems: "center", gap: 12, paddingBottom: 16 },
  actions: { gap: 4, paddingBottom: 8 }, action: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 8 },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 8 },
});
