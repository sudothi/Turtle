import { expect, it, vi } from "vitest";
import { Api, ApiError } from "./api";
import { userSchema } from "@turtle/protocol";

vi.mock("expo-file-system", () => ({
  File: class extends Blob {
    constructor(readonly uri: string) { super([new Uint8Array([255, 216, 255, 217])], { type: "image/jpeg" }); }
  },
}));

it("does not send an invalid or oversized group to the server", async () => {
  const transport = vi.fn<typeof fetch>();
  const api = new Api("https://example.test", "session", transport);
  expect(() => api.createGroup(["only-one"])).toThrow();
  expect(() => api.createGroup(Array.from({ length: 10 }, (_, i) => String(i)))).toThrow();
  expect(transport).not.toHaveBeenCalled();
});

it("preserves a blocked DM error without retrying the mutation", async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: "não é possível conversar com essa pessoa" }), { status: 403 }));
  const api = new Api("https://example.test", "session", transport);
  await expect(api.openDm("a/b")).rejects.toEqual(new ApiError(403, "não é possível conversar com essa pessoa"));
  expect(transport).toHaveBeenCalledOnce();
  expect(transport).toHaveBeenCalledWith("https://example.test/dms/a%2Fb", expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer session" }) }));
});

it("rejects an incompatible group response rather than navigating with incomplete data", async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ channelId: "room" })));
  await expect(new Api("https://example.test", "session", transport).createGroup(["a", "b"])).rejects.toThrow("incompatível");
});

it.each(["avatar", "banner"] as const)("uploads %s as real multipart bytes with auth and an automatically generated boundary", async kind => {
  const user = userSchema.parse({ id: "self", username: "self", isAdmin: false });
  const transport = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    expect(url).toBe(`https://example.test/me/${kind}`);
    expect(init?.method).toBe("PUT");
    expect(init?.headers).toMatchObject({ authorization: "Bearer session" });
    expect(new Headers(init?.headers).has("content-type")).toBe(false);
    const request = new Request(url, init);
    expect(request.headers.get("content-type")).toMatch(/^multipart\/form-data; boundary=/);
    const form = await request.formData() as unknown as { get(name: string): File };
    const file = form.get("file");
    expect(file.type).toBe("image/jpeg");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([255, 216, 255, 217]));
    return new Response(JSON.stringify(user));
  });
  await expect(new Api("https://example.test", "session", transport).uploadImage(kind, "file:///crop.jpg")).resolves.toEqual(user);
});
