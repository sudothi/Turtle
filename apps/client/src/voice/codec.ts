/**
 * O LiveKit negocia o perfil H.264 "Constrained Baseline" (42e01f), e o Chromium usa o codificador de
 * software (OpenH264) para ele, mesmo com placa NVIDIA/AMD/Intel disponível. Os perfis Main (4d) e High (64)
 * usam o codificador de hardware (MediaFoundation/NVENC no Windows). Antes de cada transceiver de vídeo,
 * colocamos esses perfis primeiro na lista de preferência; o servidor escolhe o primeiro que aceita.
 */
const rank = (c: RTCRtpCodec): number => {
  if (c.mimeType.toLowerCase() !== "video/h264") return 9;
  const id = /profile-level-id=([0-9a-f]{6})/i.exec(c.sdpFmtpLine ?? "")?.[1]?.toLowerCase() ?? "";
  const mode1 = /packetization-mode=1/.test(c.sdpFmtpLine ?? "");
  if (!mode1) return 8;
  if (id.startsWith("4d")) return 0; // Main
  if (id.startsWith("64")) return 1; // High
  if (id.startsWith("4200")) return 2; // Baseline
  return 5; // Constrained Baseline (42e0..) e o resto: software
};

export function sortH264(codecs: RTCRtpCodec[]): RTCRtpCodec[] {
  // sort é estável: mantém a ordem original dentro de cada perfil e deixa VP8/VP9/AV1 onde estavam.
  const h264 = codecs.filter((c) => c.mimeType.toLowerCase() === "video/h264").sort((a, b) => rank(a) - rank(b));
  let i = 0;
  return codecs.map((c) => (c.mimeType.toLowerCase() === "video/h264" ? h264[i++]! : c));
}

/**
 * O servidor só aceita o perfil 42e01f (Constrained Baseline) na resposta. Os dois perfis são o mesmo fluxo
 * de bits, mas 42001f (Baseline) é o que o codificador de hardware aceita. Na resposta do servidor,
 * ajustamos somente seções recvonly (o servidor recebe o vídeo que enviamos). Seções sendonly são
 * câmeras/telas recebidas e precisam manter o perfil negociado para o decodificador.
 */
export function useBaselineProfile(sdp: string): string {
  return sdp
    .split(/(?=\r?\nm=)/)
    .map((section) => (/^\r?\nm=video\b|^m=video\b/.test(section) && /^a=recvonly\r?$/m.test(section) ? section.replace(/profile-level-id=42e01f/gi, "profile-level-id=42001f") : section))
    .join("");
}

let installed = false;

export function preferHardwareH264() {
  if (installed || typeof RTCPeerConnection === "undefined" || !RTCRtpSender.getCapabilities) return;
  installed = true;
  const original = RTCPeerConnection.prototype.addTransceiver;
  RTCPeerConnection.prototype.addTransceiver = function (this: RTCPeerConnection, ...args: Parameters<RTCPeerConnection["addTransceiver"]>) {
    const transceiver = original.apply(this, args);
    try {
      const [what, init] = args;
      const isVideo = typeof what === "string" ? what === "video" : what.kind === "video";
      if (isVideo && (init?.direction ?? "sendrecv") !== "recvonly" && transceiver.setCodecPreferences) {
        const caps = RTCRtpSender.getCapabilities("video");
        if (caps) transceiver.setCodecPreferences(sortH264(caps.codecs));
      }
    } catch {
      // sem suporte: segue com a ordem padrão do navegador
    }
    return transceiver;
  };

  const setRemote = RTCPeerConnection.prototype.setRemoteDescription as (this: RTCPeerConnection, d?: RTCSessionDescriptionInit) => Promise<void>;
  RTCPeerConnection.prototype.setRemoteDescription = function (this: RTCPeerConnection, desc?: RTCSessionDescriptionInit): Promise<void> {
    // Só a resposta do servidor à nossa oferta de envio.
    if (desc?.type === "answer" && desc.sdp && this.localDescription?.sdp.includes("profile-level-id=42001f")) {
      return setRemote.call(this, { type: desc.type, sdp: useBaselineProfile(desc.sdp) });
    }
    return setRemote.call(this, desc);
  };
}
