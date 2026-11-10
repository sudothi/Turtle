import { describe, expect, it } from "vitest";
import { appSurface } from "./routes";

describe("public and app entry routes", () => {
  it.each([false, true])("keeps the browser root public with loggedIn=%s", loggedIn => {
    expect(appSurface("/", loggedIn, false)).toBe("waitlist");
    expect(appSurface("/inicio", loggedIn, false)).toBe("home");
    expect(appSurface("/inicio/", loggedIn, false)).toBe("home");
    expect(appSurface("/download", loggedIn, false)).toBe("download");
  });
  it("keeps the installed desktop/PWA root connected directly to authentication or the workspace", () => {
    expect(appSurface("/", false, true)).toBe("auth");
    expect(appSurface("/", true, true)).toBe("workspace");
  });
  it.each(["/app", "/entrar", "/entrar/", "/login", "/convite/test-code"])("keeps %s behind authentication", route => {
    expect(appSurface(route, false, false)).toBe("auth");
    expect(appSurface(route, true, false)).toBe("workspace");
  });
});
