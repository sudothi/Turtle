import type React from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { colors, styles as s } from "./theme";

export function Button({ children, onPress, disabled, secondary = false, label }: { children: string; onPress: () => void; disabled?: boolean; secondary?: boolean; label?: string }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label || children} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [s.button, secondary && s.secondary, (pressed || disabled) && { opacity: disabled ? 0.4 : 0.7 }]}>
    <Text style={[s.buttonText, secondary && { color: colors.paper }]}>{children}</Text>
  </Pressable>;
}
export function Notice({ children }: { children?: string }) {
  return children ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.notice}>{children}</Text> : null;
}
export function Heading({ detail }: { detail: string }) {
  return <View style={s.heading}><Text style={s.wordmark}>turtle<Text style={{ color: colors.muted }}>.</Text></Text><Text style={s.caption}>{detail}</Text></View>;
}

export function Field({ label, ...props }: React.ComponentProps<typeof TextInput> & { label: string }) {
  return <View style={s.field}><Text style={s.label}>{label}</Text><TextInput accessibilityLabel={label} autoCapitalize="none" autoCorrect={false} placeholderTextColor={colors.muted} selectionColor={colors.paper} style={s.input} {...props} /></View>;
}

