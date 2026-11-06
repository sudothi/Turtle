import { useMemo, useRef, useState } from "react";
import { Image, PanResponder, Text, View, useWindowDimensions } from "react-native";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { File } from "expo-file-system";
import { AVATAR_MAX_BYTES, BANNER_MAX_BYTES } from "@turtle/protocol";
import { Button, Notice } from "./components";
import { centerCrop, cropGeometry, type CropPosition } from "./crop";
import { colors, styles as text } from "./theme";
import { errorText } from "../session";

export type CropImage = { uri: string; width: number; height: number; kind: "avatar" | "banner" };
export default function ImageCropper({ image, onCancel, onSave }: { image: CropImage; onCancel: () => void; onSave: (uri: string) => Promise<void> }) {
  const { width } = useWindowDimensions();
  const [availableWidth, setAvailableWidth] = useState(0);
  const frameWidth = Math.max(1, Math.min(600, availableWidth || width - 32));
  const frame = { width: frameWidth, height: frameWidth / (image.kind === "banner" ? 3 : 1) };
  const [position, setPosition] = useState(() => centerCrop(image, frame));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const current = useRef(position); current.current = position;
  const gesture = useRef({ ...position, dx: 0, dy: 0, distance: 0 });
  const geometry = cropGeometry(image, frame, position);
  const zoom = (factor: number, base = current.current) => {
    const next = Math.max(1, Math.min(4, factor));
    const ratio = next / base.zoom;
    setPosition({ zoom: next, x: frame.width / 2 - (frame.width / 2 - base.x) * ratio, y: frame.height / 2 - (frame.height / 2 - base.y) * ratio });
  };
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !busy,
    onMoveShouldSetPanResponder: () => !busy,
    onPanResponderGrant: () => { const clamped = cropGeometry(image, frame, current.current); gesture.current = { ...current.current, x: clamped.x, y: clamped.y, dx: 0, dy: 0, distance: 0 }; },
    onPanResponderMove: (event, state) => {
      const touches = event.nativeEvent.touches;
      const first = touches[0], second = touches[1];
      if (first && second) {
        const distance = Math.hypot(first.pageX - second.pageX, first.pageY - second.pageY);
        if (!gesture.current.distance) gesture.current = { ...current.current, distance, dx: state.dx, dy: state.dy };
        zoom(gesture.current.zoom * distance / gesture.current.distance, gesture.current);
      } else {
        if (gesture.current.distance) { gesture.current = { ...current.current, distance: 0, dx: state.dx, dy: state.dy }; }
        setPosition({ ...current.current, x: gesture.current.x + state.dx - gesture.current.dx, y: gesture.current.y + state.dy - gesture.current.dy });
      }
    },
  }), [image, frame.width, frame.height, busy]);
  const save = async () => {
    if (busy) return;
    setBusy(true); setError(undefined);
    try {
      const context = ImageManipulator.manipulate(image.uri);
      context.crop(geometry.rect).resize({ width: image.kind === "avatar" ? 256 : 960, height: image.kind === "avatar" ? 256 : 320 });
      const rendered = await context.renderAsync();
      const output = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 });
      const size = new File(output.uri).size;
      if (!size || size > (image.kind === "avatar" ? AVATAR_MAX_BYTES : BANNER_MAX_BYTES)) throw new Error("Imagem grande demais. Escolha outra foto.");
      await onSave(output.uri);
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  return <View onLayout={({ nativeEvent }) => setAvailableWidth(nativeEvent.layout.width)} style={{ gap: 12 }}>
    <Text style={text.subtitle}>Recortar {image.kind === "avatar" ? "avatar" : "banner"}</Text>
    <Text style={text.caption}>Arraste para posicionar. Use dois dedos ou os botões para ajustar o zoom.</Text>
    <View {...responder.panHandlers} style={{ width: frame.width, height: frame.height, overflow: "hidden", backgroundColor: colors.rail, borderRadius: image.kind === "avatar" ? frame.width / 2 : 4 }}>
      <Image source={{ uri: image.uri }} style={{ position: "absolute", width: geometry.width, height: geometry.height, left: geometry.x, top: geometry.y }} />
    </View>
    <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}><Button secondary disabled={busy} onPress={() => zoom(position.zoom - 0.25)}>Menos zoom</Button><Button secondary disabled={busy} onPress={() => zoom(position.zoom + 0.25)}>Mais zoom</Button><Button secondary disabled={busy} onPress={() => setPosition(centerCrop(image, frame))}>Centralizar</Button></View>
    <Notice>{error}</Notice>
    <Button disabled={busy} onPress={() => { void save(); }}>{busy ? "Enviando imagem…" : "Salvar imagem"}</Button>
    <Button secondary disabled={busy} onPress={onCancel}>Cancelar recorte</Button>
  </View>;
}
