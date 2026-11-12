import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "../ui/components";
import { Icon, type IconName } from "../ui/Icon";
import KeyboardViewport from "../ui/KeyboardViewport";
import { colors, fonts, styles as text } from "../ui/theme";

const quickEmojis = ["❤️", "👍", "✅", "😂", "🔥"];
const emojis = ["❤️", "👍", "✅", "😂", "🔥", "🎉", "😮", "😢", "👀", "🙏", "🐢", "👎"];
const danger = "#ef7474";

export default function MessageActions({ mine, canDelete, selected, online, busy, onReply, onEdit, onDelete, onReact, onClose }: {
  mine: boolean; canDelete: boolean; selected: string[]; online: boolean; busy: boolean;
  onReply: () => void; onEdit: () => void; onDelete: () => void; onReact: (emoji: string) => void; onClose: () => void;
}) {
  const { height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [custom, setCustom] = useState("");
  const motion = useRef(new Animated.Value(0)).current;
  const drag = useRef(new Animated.Value(0)).current;
  const reducedMotion = useRef(false);
  const closing = useRef(false);
  const dismissed = useRef(false);
  const action = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (mounted) reducedMotion.current = value; });
    const listener = AccessibilityInfo.addEventListener("reduceMotionChanged", value => { reducedMotion.current = value; });
    return () => { mounted = false; listener.remove(); motion.stopAnimation(); drag.stopAnimation(); };
  }, [motion, drag]);
  const close = useCallback((after?: () => void) => {
    if (closing.current) return;
    closing.current = true; action.current = after;
    Animated.timing(motion, { toValue: 0, duration: reducedMotion.current ? 0 : 160, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(({ finished }) => { if (finished) setVisible(false); });
  }, [motion]);
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => gesture.dy > 6 && gesture.dy > Math.abs(gesture.dx),
    onPanResponderMove: (_event, gesture) => drag.setValue(Math.max(0, gesture.dy)),
    onPanResponderRelease: (_event, gesture) => {
      if (gesture.dy > 72 || gesture.vy > 1.2) close();
      else Animated.spring(drag, { toValue: 0, useNativeDriver: true, overshootClamping: true }).start();
    },
    onPanResponderTerminate: () => Animated.spring(drag, { toValue: 0, useNativeDriver: true, overshootClamping: true }).start(),
  }), [close, drag]);
  const disabled = busy || !online;
  const emojiButton = (emoji: string, compact = false) => <Pressable key={emoji} accessibilityRole="button" accessibilityLabel={`${selected.includes(emoji) ? "Remover" : "Adicionar"} reação ${emoji}`} accessibilityState={{ selected: selected.includes(emoji), disabled }} disabled={disabled}
    onPress={() => close(() => onReact(emoji))} style={({ pressed }) => [s.emoji, compact ? s.quickEmoji : s.gridEmoji, selected.includes(emoji) && s.selectedEmoji, pressed && s.pressed, disabled && s.disabled]}>
    <Text allowFontScaling={false} style={s.emojiText}>{emoji}</Text>
  </Pressable>;
  const row = (label: string, icon: IconName, run: () => void, destructive = false, rowDisabled = false) => <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: rowDisabled }} disabled={rowDisabled} onPress={() => close(run)}
    style={({ pressed }) => [s.row, pressed && s.pressed, rowDisabled && s.disabled]}>
    <Icon name={icon} size={24} color={destructive ? danger : colors.paperDim} /><Text style={[s.actionText, destructive && { color: danger }]}>{label}</Text>
  </Pressable>;
  return <Modal visible={visible} transparent animationType="none" presentationStyle="overFullScreen" onRequestClose={() => close()}
    onShow={() => Animated.timing(motion, { toValue: 1, duration: reducedMotion.current ? 0 : 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()}
    onDismiss={() => {
      if (dismissed.current) return;
      dismissed.current = true;
      const next = action.current; action.current = undefined;
      // Focus the composer or show confirmation only after the native modal has gone away.
      onClose(); next?.();
    }}>
    <View style={s.overlay} onAccessibilityEscape={() => close()}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: "#000", opacity: motion.interpolate({ inputRange: [0, 1], outputRange: [0, 0.65] }) }]}>
        <Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={() => close()} />
      </Animated.View>
      <KeyboardViewport pointerEvents="box-none">
        <View pointerEvents="box-none" style={s.anchor}>
          <Animated.View accessibilityViewIsModal style={[s.sheet, { maxHeight: height * 0.82, paddingBottom: Math.max(insets.bottom, 12), transform: [{ translateY: Animated.add(motion.interpolate({ inputRange: [0, 1], outputRange: [height, 0] }), drag) }] }]}>
            <View {...pan.panHandlers}>
              <Pressable accessibilityRole="button" accessibilityLabel="Fechar opções da mensagem" onPress={() => close()} style={s.grabberTarget}><View style={s.grabber} /></Pressable>
            </View>
            <ScrollView bounces={false} keyboardShouldPersistTaps="handled" style={{ flexGrow: 0 }} contentContainerStyle={s.content}>
              <View style={[s.quickRow, { gap: width < 360 ? 4 : 8 }]}>
                {quickEmojis.map(emoji => emojiButton(emoji, true))}
                <Pressable accessibilityRole="button" accessibilityLabel="Mais emojis" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={({ pressed }) => [s.emoji, s.quickEmoji, expanded && s.selectedEmoji, pressed && s.pressed]}><Icon name="smile" size={28} color={colors.paperDim} /></Pressable>
              </View>
              {expanded ? <View style={{ gap: 12 }}>
                <View style={s.pickerHeader}><Pressable accessibilityRole="button" accessibilityLabel="Voltar às ações da mensagem" onPress={() => setExpanded(false)} style={s.back}><Icon name="chevron-left" /></Pressable><Text style={text.label}>Reações</Text></View>
                <View style={s.grid}>{emojis.map(emoji => emojiButton(emoji))}</View>
                <TextInput accessibilityLabel="Outro emoji para reagir" value={custom} onChangeText={setCustom} editable={!disabled} maxLength={32} placeholder="Outro emoji" placeholderTextColor={colors.faint} style={s.input} />
                <Button disabled={disabled || !custom.trim()} onPress={() => close(() => onReact(custom.trim()))}>Usar emoji</Button>
              </View> : <>
                <View style={s.group}>
                  {mine && <>{row("Editar mensagem", "pencil", onEdit, false, busy)}<View style={s.divider} /></>}
                  {row("Responder", "reply", onReply, false, busy)}
                </View>
                {canDelete && <View style={s.group}>{row("Excluir mensagem", "trash", onDelete, true, disabled)}</View>}
              </>}
            </ScrollView>
          </Animated.View>
        </View>
      </KeyboardViewport>
    </View>
  </Modal>;
}

const s = StyleSheet.create({
  overlay: { flex: 1 }, anchor: { flex: 1, justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.panel, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: "hidden", flexShrink: 1 },
  grabberTarget: { height: 28, alignItems: "center", justifyContent: "center" }, grabber: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.line },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4, gap: 16 }, quickRow: { flexDirection: "row" },
  emoji: { backgroundColor: colors.input, borderRadius: 13, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "transparent" },
  quickEmoji: { flex: 1, minWidth: 44, minHeight: 44, maxHeight: 56, aspectRatio: 1 }, gridEmoji: { width: 48, height: 48 },
  emojiText: { fontSize: 27 }, selectedEmoji: { borderColor: colors.paperDim, backgroundColor: colors.elevated },
  group: { backgroundColor: colors.input, borderRadius: 16, overflow: "hidden" }, row: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 16, paddingHorizontal: 18, paddingVertical: 14 },
  actionText: { flexShrink: 1, fontFamily: fonts.medium, fontSize: 16, lineHeight: 22, color: colors.paper }, divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginLeft: 58, marginRight: 16 },
  pickerHeader: { flexDirection: "row", alignItems: "center", gap: 8 }, back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  input: { minHeight: 48, padding: 12, backgroundColor: colors.input, borderRadius: 12, color: colors.paper, fontFamily: fonts.body, fontSize: 18 },
  pressed: { backgroundColor: colors.elevated }, disabled: { opacity: 0.4 },
});
