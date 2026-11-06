import { expect, it } from "vitest";
import { inviteCode } from "./invites";

it("accepts a pasted code or a link on the configured origin", () => {
  expect(inviteCode(" abc-123 ", "https://turtle.test")).toBe("abc-123");
  expect(inviteCode("https://turtle.test/convite/abc-123", "https://turtle.test")).toBe("abc-123");
});
it.each([
  "https://another.test/convite/abc", "https://turtle.test.evil.test/convite/abc",
  "http://turtle.test/convite/abc", "https://other@turtle.test/convite/abc",
  "https://turtle.test/convite/abc?redirect=evil", "https://turtle.test/convite/a%2Fb",
  "https://turtle.test/not-an-invite/abc", "", "abc/def",
])("does not accept an unrelated or ambiguous invite: %s", value => {
  expect(() => inviteCode(value, "https://turtle.test")).toThrow("convite");
});
