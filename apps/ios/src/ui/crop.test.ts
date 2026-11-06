import { expect, it } from "vitest";
import { centerCrop, cropGeometry } from "./crop";

it.each([
  [{ width: 4000, height: 3000 }, { width: 320, height: 320 }],
  [{ width: 3000, height: 4000 }, { width: 343, height: 343 / 3 }],
  [{ width: 200, height: 100 }, { width: 600, height: 200 }],
])("keeps crops within the decoded image when dragging beyond the viewport", (image, frame) => {
  for (const zoom of [0, 1, 2, 4, 20]) for (const x of [-100000, 0, 100000]) {
    const crop = cropGeometry(image, frame, { x, y: x, zoom });
    expect(crop.rect.originX).toBeGreaterThanOrEqual(0);
    expect(crop.rect.originY).toBeGreaterThanOrEqual(0);
    expect(crop.rect.originX + crop.rect.width).toBeLessThanOrEqual(image.width);
    expect(crop.rect.originY + crop.rect.height).toBeLessThanOrEqual(image.height);
    expect(crop.width).toBeGreaterThanOrEqual(frame.width);
    expect(crop.height).toBeGreaterThanOrEqual(frame.height);
  }
});
it("centers a portrait photo in the banner without stretching it", () => {
  const image = { width: 1200, height: 2400 }, frame = { width: 360, height: 120 };
  const crop = cropGeometry(image, frame, centerCrop(image, frame));
  expect(crop.rect).toEqual({ originX: 0, originY: 1000, width: 1200, height: 400 });
});
