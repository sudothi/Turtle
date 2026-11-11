import { expect, it } from "vitest";
import { keyboardOverlap } from "./keyboard";

it("keeps the composer at the same keyboard edge with different headers, banners and safe areas", () => {
  const keyboard = { screenY: 500, height: 344 };
  for (const [y, height] of [[100, 710], [160, 650], [0, 810]]) {
    expect(y! + height! - keyboardOverlap(y!, height!, keyboard)).toBe(500);
  }
});

it("resets for dismissed/hardware keyboards and clamps overlap when rotating or resizing", () => {
  expect(keyboardOverlap(100, 710)).toBe(0);
  expect(keyboardOverlap(100, 710, { screenY: 0, height: 0 })).toBe(0);
  expect(keyboardOverlap(100, 710, { screenY: 844, height: 200 })).toBe(0);
  expect(keyboardOverlap(100, 710, { screenY: 0, height: 344 })).toBe(710);
  expect(keyboardOverlap(60, 300, { screenY: 220, height: 170 })).toBe(140);
});
