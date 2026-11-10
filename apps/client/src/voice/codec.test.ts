import { describe, expect, it } from "vitest";
import { useBaselineProfile } from "./codec";

const video = (mid: string, direction: string, profile = "42e01f") => [
  "m=video 9 UDP/TLS/RTP/SAVPF 108 109",
  `a=mid:${mid}`,
  `a=${direction}`,
  "a=rtpmap:108 H264/90000",
  `a=fmtp:108 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=${profile}`,
  "a=rtpmap:109 rtx/90000",
  "a=fmtp:109 apt=108",
  "",
].join("\r\n");

describe("hardware H264 negotiation", () => {
  it("preserves the received camera profile in a mixed publisher/subscriber answer", () => {
    const remoteCamera = video("3", "sendonly");
    const localCamera = video("7", "recvonly");
    const header = "v=0\r\n";
    expect(useBaselineProfile(header + remoteCamera + localCamera)).toBe(header + remoteCamera + video("7", "recvonly", "42001f"));
  });

  it.each(["sendonly", "sendrecv", "inactive"])("leaves %s video sections unchanged", direction => {
    const sdp = "v=0\r\n" + video("3", direction);
    expect(useBaselineProfile(sdp)).toBe(sdp);
  });

  it("keeps audio and other H264 profiles unchanged", () => {
    const sdp = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=recvonly\r\na=rtpmap:111 opus/48000/2\r\n" + video("7", "recvonly", "64001f");
    expect(useBaselineProfile(sdp)).toBe(sdp);
  });

  it("supports LF-only SDP while retaining the publisher hardware workaround", () => {
    const sdp = video("7", "recvonly").replaceAll("\r\n", "\n");
    expect(useBaselineProfile(sdp)).toBe(sdp.replace("42e01f", "42001f"));
  });
});
