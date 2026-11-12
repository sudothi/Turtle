import { describe, expect, it, vi } from "vitest";
import { messageSchema, sentMessageId } from "@turtle/protocol";
import { ApiError, type Api } from "./api";
const fake = vi.hoisted(() => ({ voices: [] as { leave: ReturnType<typeof vi.fn>; join: ReturnType<typeof vi.fn>; expired: (error: unknown) => void }[], gateways: [] as { sendText: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] }));
vi.mock("react-native", () => ({ AppState: { currentState: "active" } }));
vi.mock("./voice", () => ({ Voice: class {
  leave = vi.fn(async () => {}); join = vi.fn(async () => {});
  constructor(_api: unknown, _report: unknown, _active: unknown, readonly expired: (error: unknown) => void) { fake.voices.push(this); }
} }));
vi.mock("./gateway", () => ({ Gateway: class {
  start = vi.fn(); stop = vi.fn(); resume = vi.fn(); update = vi.fn();
  sendText = vi.fn(async (channelId: string, body: { requestId: string; content: string }) => messageSchema.parse({ id: sentMessageId("test", body.requestId), channelId, userId: "test", username: "test", content: body.content, createdAt: new Date().toISOString(), attachments: [] }));
  subscribe = vi.fn(() => () => {}); subscribeEvents = vi.fn(() => () => {});
  constructor() { fake.gateways.push(this); }
} }));
import { WorkspaceSession } from "./workspace-session";

function setup() {
  const api = { servers: vi.fn(async () => []), channels: vi.fn(async () => []), sendText: vi.fn() } as unknown as Api;
  const auth = { logout: vi.fn(async () => {}), rejectIfUnauthorized: vi.fn(async () => true) };
  return { workspace: new WorkspaceSession(api, auth, { userId: "test", id: () => "c1a1876a-fdf5-44fa-9ae2-399c691d9ccc", storage: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} } }), api, auth, voice: fake.voices.at(-1)!, gateway: fake.gateways.at(-1)! };
}
describe("workspace lifetime", () => {
  it("routes confirmed chat delivery through the gateway transport", async () => {
    const { workspace, api, gateway } = setup();
    await workspace.chat.ready; workspace.chat.setConnected(true);
    const conversation = workspace.chat.get("channel"); conversation.edit("confirmada"); await conversation.send();
    expect(gateway.sendText).toHaveBeenCalledWith("channel", { requestId: "c1a1876a-fdf5-44fa-9ae2-399c691d9ccc", content: "confirmada" });
    expect(api.sendText).not.toHaveBeenCalled();
    expect(conversation.getSnapshot().outbox).toHaveLength(0);
    await workspace.dispose();
  });
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
  it("invalidates a session revoked during automatic call recovery after native media stops", async () => {
    const { workspace, voice, auth } = setup();
    let finish!: () => void;
    voice.leave.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const error = new ApiError(401, "invalid");
    voice.expired(error);
    expect(auth.rejectIfUnauthorized).not.toHaveBeenCalled();
    finish();
    await vi.waitFor(() => expect(auth.rejectIfUnauthorized).toHaveBeenCalledExactlyOnceWith(error));
    await workspace.dispose();
  });
  it("a failed logout leaves drafts editable for the still authenticated user", async () => {
    const { workspace, auth } = setup(); await workspace.chat.ready;
    auth.logout.mockRejectedValueOnce(new Error("Keychain indisponível"));
    await workspace.logout();
    workspace.chat.get("a").edit("continuar escrevendo");
    expect(workspace.chat.get("a").getSnapshot().draft.text).toBe("continuar escrevendo");
    await workspace.dispose();
  });
});
