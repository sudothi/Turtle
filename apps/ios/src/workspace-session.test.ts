import { describe, expect, it, vi } from "vitest";
import { ApiError, type Api } from "./api";
const fake = vi.hoisted(() => ({ voices: [] as { leave: ReturnType<typeof vi.fn>; join: ReturnType<typeof vi.fn> }[], gateways: [] as { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] }));
vi.mock("react-native", () => ({ AppState: { currentState: "active" } }));
vi.mock("./voice", () => ({ Voice: class {
  leave = vi.fn(async () => {}); join = vi.fn(async () => {});
  constructor() { fake.voices.push(this); }
} }));
vi.mock("./gateway", () => ({ Gateway: class {
  start = vi.fn(); stop = vi.fn(); resume = vi.fn(); update = vi.fn();
  constructor() { fake.gateways.push(this); }
} }));
import { WorkspaceSession } from "./workspace-session";

function setup() {
  const api = { servers: vi.fn(async () => []), channels: vi.fn(async () => []) } as unknown as Api;
  const auth = { logout: vi.fn(async () => {}), rejectIfUnauthorized: vi.fn(async () => true) };
  return { workspace: new WorkspaceSession(api, auth), auth, voice: fake.voices.at(-1)!, gateway: fake.gateways.at(-1)! };
}
describe("workspace lifetime", () => {
  it("starts transport only once and view subscriptions never stop the call", async () => {
    const { workspace, voice, gateway } = setup();
    workspace.start(); workspace.start();
    const firstScreen = workspace.subscribe(vi.fn()); firstScreen();
    const nextScreen = workspace.subscribe(vi.fn());
    await workspace.enter("channel", "Amigos", false);
    nextScreen();
    expect(gateway.start).toHaveBeenCalledOnce();
    expect(voice.join).toHaveBeenCalledWith("channel", "Amigos", false);
    expect(voice.leave).not.toHaveBeenCalled();
    await workspace.dispose(); await workspace.dispose();
    expect(voice.leave).toHaveBeenCalledOnce(); expect(gateway.stop).toHaveBeenCalledOnce();
  });
  it("logout awaits native media shutdown before clearing the saved session", async () => {
    const { workspace, voice, auth } = setup();
    let finish!: () => void;
    voice.leave.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const leaving = workspace.logout();
    expect(auth.logout).not.toHaveBeenCalled();
    finish(); await leaving;
    expect(auth.logout).toHaveBeenCalledOnce();
  });
  it("temporary HTTP failure does not close the call or delete the session", async () => {
    const { workspace, voice, auth } = setup();
    expect(await workspace.reject(new ApiError(503, "maintenance"))).toBe(false);
    expect(voice.leave).not.toHaveBeenCalled(); expect(auth.rejectIfUnauthorized).not.toHaveBeenCalled();
  });
  it("rejecting revoked credentials stops capture before returning to login", async () => {
    const { workspace, voice, auth } = setup();
    const error = new ApiError(401, "invalid"); await workspace.reject(error);
    expect(voice.leave).toHaveBeenCalledOnce(); expect(auth.rejectIfUnauthorized).toHaveBeenCalledWith(error);
  });
});
