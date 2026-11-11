import { describe, expect, it } from "vitest";
import { appSurface } from "./routes";

describe("app entry", () => {
  it("shows authentication to visitors on any route, including the old public pages", () => {
    expect(appSurface(false)).toBe("auth");
  });
  it("opens the workspace once logged in", () => {
    expect(appSurface(true)).toBe("workspace");
  });
});
