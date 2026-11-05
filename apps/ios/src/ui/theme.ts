import { StyleSheet } from "react-native";

export const colors = { background: "#111111", panel: "#0a0a0a", input: "#1a1a1a", paper: "#f5f3ee", muted: "#9a9790", line: "#2a2a2a" };

export const styles = StyleSheet.create({
  flex: { flex: 1 }, safe: { flex: 1, backgroundColor: colors.background },
  auth: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 40, paddingBottom: 24, gap: 20 },
  heading: { gap: 8, marginBottom: 28 }, wordmark: { fontSize: 64, fontWeight: "900", color: colors.paper, letterSpacing: -4 }, smallWordmark: { fontSize: 25, fontWeight: "900", color: colors.paper, letterSpacing: -1 },
  form: { gap: 16 }, title: { fontSize: 28, fontWeight: "800", color: colors.paper, letterSpacing: -0.8 }, subtitle: { fontSize: 18, fontWeight: "600", color: colors.paper },
  body: { fontSize: 16, color: colors.muted, lineHeight: 24 }, caption: { fontSize: 13, color: colors.muted, lineHeight: 19 }, label: { fontSize: 15, color: colors.paper, fontWeight: "600" },
  field: { gap: 8 }, input: { minHeight: 52, borderWidth: 1, borderColor: colors.line, borderRadius: 8, backgroundColor: colors.input, color: colors.paper, fontSize: 17, paddingHorizontal: 14, paddingVertical: 12 },
  button: { minHeight: 50, borderRadius: 8, backgroundColor: colors.paper, justifyContent: "center", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1, borderColor: colors.paper },
  secondary: { backgroundColor: "transparent", borderColor: colors.line }, buttonText: { fontSize: 16, fontWeight: "700", textAlign: "center", color: colors.background },
  notice: { padding: 12, borderLeftWidth: 2, borderLeftColor: colors.paper, backgroundColor: colors.input, color: colors.paper, fontSize: 15, lineHeight: 22 },
  link: { minHeight: 44, justifyContent: "center" }, footnote: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 8 }, center: { flex: 1, justifyContent: "center", padding: 24, gap: 16 },
  topbar: { paddingHorizontal: 24, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.line, flexDirection: "row", alignItems: "center" }, exit: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  content: { padding: 24, gap: 20, paddingBottom: 40 }, sectionHeading: { gap: 8 }, empty: { paddingVertical: 20, gap: 12 }, server: { gap: 10 }, serverTitle: { fontSize: 12, fontWeight: "800", color: colors.muted, textTransform: "uppercase", letterSpacing: 1.5 },
  channel: { minHeight: 76, borderWidth: 1, borderColor: colors.line, borderRadius: 8, padding: 16, flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: colors.panel }, selectedChannel: { borderColor: colors.paper }, channelSymbol: { color: colors.paper, fontSize: 24 },
  call: { gap: 14, paddingTop: 24, borderTopWidth: 2, borderTopColor: colors.paper }, controls: { gap: 10, marginTop: 8 }, member: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56 }, avatar: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: colors.line, backgroundColor: colors.input, alignItems: "center", justifyContent: "center" }, speaking: { borderColor: colors.paper }, initial: { color: colors.paper, fontSize: 18, fontWeight: "700" },
});
