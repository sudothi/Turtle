import { StyleSheet } from "react-native";

// Same ink/paper roles as packages/ui/src/tokens.css.
export const colors = { rail: "#000000", panel: "#0a0a0a", background: "#111111", input: "#1a1a1a", elevated: "#242424", userPanel: "#070707", paper: "#f5f3ee", paperDim: "#c9c6bf", muted: "#9a9790", faint: "#66645f", line: "#2a2a2a", hover: "rgba(245,243,238,0.06)", active: "rgba(245,243,238,0.11)" };
export const fonts = { body: "Figtree_400Regular", medium: "Figtree_500Medium", semibold: "Figtree_600SemiBold", bold: "Figtree_700Bold", display: "BricolageGrotesque_700Bold" };

export const styles = StyleSheet.create({
  flex: { flex: 1 }, safe: { flex: 1, backgroundColor: colors.background },
  auth: { flexGrow: 1, width: "100%", maxWidth: 560, alignSelf: "center", paddingHorizontal: 24, paddingTop: 40, paddingBottom: 24, gap: 20 },
  heading: { gap: 8, marginBottom: 28 }, wordmark: { fontFamily: fonts.display, fontSize: 64, color: colors.paper, letterSpacing: -4 },
  serverTitle: { fontFamily: fonts.bold, fontSize: 12, color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5 },
  form: { gap: 16 }, title: { fontFamily: fonts.display, fontSize: 32, color: colors.paper, letterSpacing: -0.8 }, subtitle: { fontFamily: fonts.semibold, fontSize: 16, color: colors.paper },
  body: { fontFamily: fonts.body, fontSize: 16, color: colors.paperDim, lineHeight: 24 }, caption: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, lineHeight: 18 }, label: { fontFamily: fonts.semibold, fontSize: 16, color: colors.paper },
  field: { gap: 8 }, input: { fontFamily: fonts.body, minHeight: 44, borderRadius: 4, backgroundColor: colors.input, color: colors.paper, fontSize: 16, paddingHorizontal: 12, paddingVertical: 10 },
  button: { minHeight: 50, borderRadius: 8, backgroundColor: colors.paper, justifyContent: "center", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1, borderColor: colors.paper },
  secondary: { backgroundColor: "transparent", borderColor: colors.line }, buttonText: { fontFamily: fonts.bold, fontSize: 16, textAlign: "center", color: colors.background },
  notice: { fontFamily: fonts.body, padding: 12, borderLeftWidth: 2, borderLeftColor: colors.paper, backgroundColor: colors.input, color: colors.paper, fontSize: 15, lineHeight: 22 },
  link: { minHeight: 44, justifyContent: "center" }, footnote: { fontFamily: fonts.body, color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 8 }, center: { flex: 1, justifyContent: "center", padding: 24, gap: 16 },
});
