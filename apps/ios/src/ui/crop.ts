export type Size = { width: number; height: number };
export type CropPosition = { x: number; y: number; zoom: number };
export function cropGeometry(image: Size, frame: Size, position: CropPosition) {
  const scale = Math.max(frame.width / image.width, frame.height / image.height) * Math.max(1, Math.min(4, position.zoom));
  const width = image.width * scale, height = image.height * scale;
  const x = Math.max(frame.width - width, Math.min(0, position.x));
  const y = Math.max(frame.height - height, Math.min(0, position.y));
  const cropWidth = Math.min(image.width, Math.max(1, Math.round(frame.width / scale)));
  const cropHeight = Math.min(image.height, Math.max(1, Math.round(frame.height / scale)));
  return { width, height, x, y, rect: {
    originX: Math.max(0, Math.min(image.width - cropWidth, Math.round(-x / scale))),
    originY: Math.max(0, Math.min(image.height - cropHeight, Math.round(-y / scale))),
    width: cropWidth, height: cropHeight,
  } };
}
export function centerCrop(image: Size, frame: Size): CropPosition {
  const scale = Math.max(frame.width / image.width, frame.height / image.height);
  return { x: (frame.width - image.width * scale) / 2, y: (frame.height - image.height * scale) / 2, zoom: 1 };
}
