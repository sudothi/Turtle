export function keyboardOverlap(y: number, height: number, keyboard?: { screenY: number; height: number }) {
  if (!keyboard || keyboard.height <= 0) return 0;
  return Math.min(height, Math.max(0, y + height - keyboard.screenY));
}
