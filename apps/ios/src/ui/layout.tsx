import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View, type ScrollViewProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { ReactNode } from "react";
import { Button, Notice } from "./components";
import { colors, fonts, styles as text } from "./theme";
import { Icon, type IconName } from "./Icon";

export const layout = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, gap: 12, width: "100%", maxWidth: 800, alignSelf: "center", paddingBottom: 24 },
  row: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 8, borderBottomWidth: 1, borderColor: colors.line },
  rowText: { flex: 1, gap: 4, minWidth: 0 },
  avatar: { backgroundColor: colors.elevated, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  avatarText: { fontFamily: fonts.semibold, color: colors.paper },
  section: { gap: 10 },
  toolbar: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
});

export function Page({ children, modal = false }: { children: ReactNode; modal?: boolean }) {
  return <SafeAreaView edges={["left", "right", "bottom"]} style={layout.page}>{children}</SafeAreaView>;
}
export function Content({ children, ...props }: ScrollViewProps) {
  return <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets contentContainerStyle={layout.content} {...props}>{children}</ScrollView>;
}
export function Empty({ title, children }: { title: string; children: string }) {
  return <View style={layout.section}><Text accessibilityRole="header" style={text.subtitle}>{title}</Text><Text style={text.body}>{children}</Text></View>;
}
export function ReadStatus({ loading, error, retry }: { loading: boolean; error?: string; retry: () => void }) {
  return <>
    {loading && <ActivityIndicator color={colors.paper} accessibilityLabel="Atualizando conteúdo" />}
    <Notice>{error}</Notice>
    {error && <Button secondary onPress={retry}>Tentar novamente</Button>}
  </>;
}
export function Avatar({ name, uri, size = 40, online }: { name: string; uri?: string; size?: number; online?: boolean }) {
  return <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><View style={[layout.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
    {uri ? <Image source={{ uri }} style={{ width: "100%", height: "100%" }} /> : <Text allowFontScaling={false} style={[layout.avatarText, { fontSize: size * 0.38 }]}>{Array.from(name).slice(0, 2).join("").toUpperCase()}</Text>}
  </View>{online !== undefined && <View style={{ position: "absolute", right: -1, bottom: -1, width: 12, height: 12, borderRadius: 6, borderWidth: 3, borderColor: colors.panel, backgroundColor: online ? colors.paper : colors.faint }} />}
  </View>;
}
export function ListRow({ title, detail, leading, onPress, label, selected = false }: { title: string; detail?: string; leading?: ReactNode; onPress?: () => void; label?: string; selected?: boolean }) {
  const children = <>{leading}<View style={layout.rowText}><Text style={text.subtitle}>{title}</Text>{detail && <Text style={text.caption}>{detail}</Text>}</View></>;
  if (!onPress) return <View style={layout.row}>{children}</View>;
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label || `${title}${detail ? `. ${detail}` : ""}`} accessibilityState={{ selected }} style={({ pressed }) => [layout.row, (selected || pressed) && { backgroundColor: colors.active }]}>{children}</Pressable>;
}
export function IconButton({ name, label, onPress, disabled = false, selected = false }: { name: IconName; label: string; onPress: () => void; disabled?: boolean; selected?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, selected }} disabled={disabled} onPress={onPress} style={({ pressed }) => [layout.toolbar, { borderRadius: 4 }, (pressed || selected) && { backgroundColor: colors.active }, disabled && { opacity: 0.35 }]}><Icon name={name} color={colors.paperDim} /></Pressable>;
}
export function ToolbarButton({ label, onPress }: { label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={layout.toolbar}><Text style={text.label}>{label}</Text></Pressable>;
}
