import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View, type ScrollViewProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { ReactNode } from "react";
import { Button, Notice } from "./components";
import { colors, styles as text } from "./theme";

export const layout = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, gap: 16, width: "100%", maxWidth: 680, alignSelf: "center", paddingBottom: 28 },
  row: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.line, borderRadius: 8, backgroundColor: colors.panel },
  rowText: { flex: 1, gap: 4, minWidth: 0 },
  avatar: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.input, alignItems: "center", justifyContent: "center", overflow: "hidden", borderWidth: 1, borderColor: colors.line },
  avatarText: { fontSize: 20, fontWeight: "800", color: colors.paper },
  section: { gap: 10 },
  toolbar: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
});

export function Page({ children, modal = false }: { children: ReactNode; modal?: boolean }) {
  return <SafeAreaView edges={modal ? ["left", "right", "bottom"] : ["left", "right"]} style={layout.page}>{children}</SafeAreaView>;
}
export function Content({ children, ...props }: ScrollViewProps) {
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={layout.content} {...props}>{children}</ScrollView>;
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
export function Avatar({ name, uri }: { name: string; uri?: string }) {
  return <View style={layout.avatar} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    {uri ? <Image source={{ uri }} style={{ width: "100%", height: "100%" }} /> : <Text allowFontScaling={false} style={layout.avatarText}>{Array.from(name)[0]?.toUpperCase()}</Text>}
  </View>;
}
export function ListRow({ title, detail, leading, onPress, label, selected = false }: { title: string; detail?: string; leading?: ReactNode; onPress?: () => void; label?: string; selected?: boolean }) {
  const children = <>{leading}<View style={layout.rowText}><Text style={text.subtitle}>{title}</Text>{detail && <Text style={text.caption}>{detail}</Text>}</View>{onPress && <Text accessibilityElementsHidden style={text.caption}>›</Text>}</>;
  if (!onPress) return <View style={layout.row}>{children}</View>;
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label || `${title}${detail ? `. ${detail}` : ""}`} accessibilityState={{ selected }} style={({ pressed }) => [layout.row, selected && { borderColor: colors.paper }, pressed && { opacity: 0.65 }]}>{children}</Pressable>;
}
export function ToolbarButton({ label, onPress }: { label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={layout.toolbar}><Text style={text.label}>{label}</Text></Pressable>;
}
