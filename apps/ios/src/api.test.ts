import { expect, it, vi } from "vitest";
import { Api, ApiError } from "./api";

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
