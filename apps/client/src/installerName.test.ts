import { describe, expect, it } from "vitest";
import { installerName } from "./components/DesktopDownload";

describe("installerName", () => {
  it("põe o domínio no nome do instalador", () => {
    expect(installerName("app.Exemplo.com")).toBe("Turtle-Setup@app.exemplo.com.exe");
  });
  it("ignora hosts que não são domínio (localhost, IP com porta, vazio)", () => {
    expect(installerName("localhost")).toBeNull();
    expect(installerName("")).toBeNull();
    expect(installerName("a b.com")).toBeNull();
  });
});
