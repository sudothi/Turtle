import { describe, expect, it, vi } from "vitest";
import { Api, ApiError, apiOrigin } from "./api";
import { Session, type SecretStore } from "./session";

const user = { id: "u1", username: "amigo", isAdmin: false, canInvite: false, displayName: null, bio: null, avatar: null, banner: null, status: "online" };
const origin = "https://app.example.test";
function setup(transport: typeof fetch, initial: string | null = JSON.stringify({ origin, token: "saved-token" })) {
  let value = initial;
  const store: SecretStore = { read: vi.fn(async () => value), write: vi.fn(async next => { value = next; }), remove: vi.fn(async () => { value = null; }) };
  return { store, session: new Session(store, transport), value: () => value };
}
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

describe("protected mobile session", () => {
  it("restores only after validating the saved token with the backend", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(response(user));
    const { session, store } = setup(transport);
    await session.restore();
    expect(session.getSnapshot()).toMatchObject({ phase: "signedIn", user });
    expect(transport).toHaveBeenCalledWith(`${origin}/me`, expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer saved-token" }) }));
    expect(store.remove).not.toHaveBeenCalled();
  });
  it.each([new TypeError("offline"), new ApiError(503, "maintenance")])("keeps the credential on temporary failure", async error => {
    const transport = vi.fn<typeof fetch>().mockRejectedValue(error);
    const { session, store, value } = setup(transport);
    await session.restore();
    expect(session.getSnapshot().phase).toBe("offline");
    expect(store.remove).not.toHaveBeenCalled();
    expect(value()).toContain("saved-token");
  });
  it("removes a revoked session only on a confirmed 401", async () => {
    const { session, value } = setup(vi.fn<typeof fetch>().mockResolvedValue(response({ error: "unauthorized" }, 401)));
    await session.restore();
    expect(session.getSnapshot().phase).toBe("signedOut");
    expect(value()).toBeNull();
  });
  it("does not enter the account if Keychain persistence fails", async () => {
    const { session, store } = setup(vi.fn<typeof fetch>().mockResolvedValue(response({ token: "new", user })), null);
    await session.restore();
    vi.mocked(store.write).mockRejectedValue(new Error("keychain unavailable"));
    await expect(session.authenticate(origin, "amigo", "password")).rejects.toThrow("keychain");
    expect(session.getSnapshot().phase).toBe("signedOut");
  });
  it("logout prevents a late restore from signing the account back in", async () => {
    let resolve!: (value: Response) => void;
    const { session, value } = setup(vi.fn<typeof fetch>().mockImplementation(() => new Promise(done => { resolve = done; })));
    const restoring = session.restore();
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    await session.logout();
    resolve(response(user));
    await restoring;
    expect(session.getSnapshot().phase).toBe("signedOut");
    expect(value()).toBeNull();
  });
  it("serializes logout after an in-flight Keychain write", async () => {
    const { session, store, value } = setup(vi.fn<typeof fetch>().mockResolvedValue(response({ token: "new", user })), null);
    await session.restore();
    let release!: () => void;
    const originalWrite = vi.mocked(store.write).getMockImplementation()!;
    vi.mocked(store.write).mockImplementationOnce(async next => {
      await new Promise<void>(done => { release = done; });
      await originalWrite(next);
    });
    const authenticating = session.authenticate(origin, "amigo", "password");
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const logout = session.logout();
    release();
    await Promise.all([authenticating, logout]);
    expect(session.getSnapshot().phase).toBe("signedOut");
    expect(value()).toBeNull();
  });
});

describe("mobile transport boundaries", () => {
  it.each(["http://example.test", "https://user:secret@example.test", "https://example.test/api", "https://example.test/?token=secret"])("rejects insecure or ambiguous origins: %s", value => {
    expect(() => apiOrigin(value)).toThrow();
  });
  it("validates successful HTTP responses against the shared protocol", async () => {
    const api = new Api(origin, "token", vi.fn<typeof fetch>().mockResolvedValue(response({ unexpected: true })));
    await expect(api.me()).rejects.toThrow("incompatível");
  });
  it("preserves status and backend errors for login and invitation failures", async () => {
    const api = new Api(origin, undefined, vi.fn<typeof fetch>().mockResolvedValue(response({ error: "convite inválido" }, 403)));
    await expect(api.register({ username: "amigo", password: "longpassword", inviteCode: "invalid" })).rejects.toMatchObject({ status: 403, message: "convite inválido" });
  });
});
