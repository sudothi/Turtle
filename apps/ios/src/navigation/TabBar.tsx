import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import type { NavigationProp } from "@react-navigation/native";
import type { RootRoutes } from "./types";
import { CallDock } from "./call-access";
import { colors } from "../ui/theme";

const icons: Record<string, string> = { HomeTab: "⌂", ServersTab: "☷", Settings: "⚙" };

/** Keep the navigator's tab events/history, with labels allowed to grow at accessibility sizes. */
export default function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { fontScale } = useWindowDimensions();
  return <SafeAreaView edges={["left", "right", "bottom"]} style={s.safe}>
    <CallDock onOpen={() => navigation.getParent<NavigationProp<RootRoutes>>()?.navigate("Call")} />
    <View style={s.tabs}>
      {state.routes.map((route, index) => {
        const options = descriptors[route.key]!.options;
        const selected = state.index === index;
        const title = typeof options.tabBarLabel === "string" ? options.tabBarLabel : options.title || route.name;
        return <Pressable key={route.key} accessibilityRole="tab" accessibilityLabel={options.tabBarAccessibilityLabel || title}
          accessibilityState={{ selected }} testID={options.tabBarButtonTestID}
          onPress={() => {
            const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
            if (!selected && !event.defaultPrevented) navigation.navigate(route.name, route.params);
          }}
          onLongPress={() => navigation.emit({ type: "tabLongPress", target: route.key })}
          style={({ pressed }) => [s.tab, selected && s.selected, pressed && { opacity: 0.65 }]}
        >
          {fontScale < 1.5 && <Text accessible={false} allowFontScaling={false} style={[s.icon, !selected && s.inactive]}>{icons[route.name]}</Text>}
          <Text style={[s.label, !selected && s.inactive]}>{title}</Text>
        </Pressable>;
      })}
    </View>
  </SafeAreaView>;
}
const s = StyleSheet.create({
  safe: { backgroundColor: colors.panel },
  tabs: { flexDirection: "row", alignItems: "stretch", borderTopWidth: 1, borderColor: colors.line },
  tab: { flex: 1, minWidth: 0, minHeight: 56, alignItems: "center", justifyContent: "center", paddingHorizontal: 6, paddingVertical: 8, gap: 3, borderTopWidth: 2, borderTopColor: "transparent" },
  selected: { borderTopColor: colors.paper },
  icon: { fontSize: 22, color: colors.paper },
  label: { fontSize: 13, fontWeight: "600", color: colors.paper, textAlign: "center", flexShrink: 1 },
  inactive: { color: colors.muted },
});
