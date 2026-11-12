import { useCallback, useEffect, useRef, useState, type ComponentRef, type ReactNode } from "react";
import { Keyboard, View, type KeyboardEvent, type KeyboardMetrics, type ViewProps } from "react-native";
import { keyboardOverlap } from "./keyboard";

/** Measure in window coordinates: headers, safe areas and call banners can move this view. */
export default function KeyboardViewport({ children, pointerEvents }: { children: ReactNode; pointerEvents?: ViewProps["pointerEvents"] }) {
  const view = useRef<ComponentRef<typeof View>>(null);
  const keyboard = useRef<KeyboardMetrics | undefined>(Keyboard.metrics() ?? undefined);
  const [bottom, setBottom] = useState(0);
  const measure = useCallback(() => {
    view.current?.measureInWindow((_x, y, _width, height) => {
      setBottom(keyboardOverlap(y, height, keyboard.current));
    });
  }, []);
  useEffect(() => {
    const change = (event: KeyboardEvent) => {
      keyboard.current = event.endCoordinates;
      Keyboard.scheduleLayoutAnimation(event);
      measure();
    };
    const hide = (event: KeyboardEvent) => {
      keyboard.current = undefined;
      Keyboard.scheduleLayoutAnimation(event);
      setBottom(0);
    };
    const listeners = [Keyboard.addListener("keyboardWillChangeFrame", change), Keyboard.addListener("keyboardWillHide", hide)];
    measure();
    return () => listeners.forEach(listener => listener.remove());
  }, [measure]);
  return <View ref={view} collapsable={false} pointerEvents={pointerEvents} onLayout={measure} style={{ flex: 1, paddingBottom: bottom }}>{children}</View>;
}
