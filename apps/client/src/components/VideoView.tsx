import { useEffect, useRef } from "react";
import type { Track } from "livekit-client";

/** Liga uma track de vídeo do LiveKit a um <video>. O áudio das transmissões vem em outra track, então o vídeo é sempre mudo. */
export function VideoView({ track, className = "", contain = false }: { track: Track; className?: string; contain?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
  return <video ref={ref} className={`video-view ${contain ? "contain" : ""} ${className}`} autoPlay playsInline muted />;
}
