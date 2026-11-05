import { useEffect, useRef, useState } from "react";
import { Button, Modal } from "@turtle/ui";

/** Tela de recorte (arrastar + zoom) antes de enviar foto ou banner. Gera um PNG no tamanho final. */
export function ImageCropper({
  file,
  width,
  height,
  round,
  title,
  onCancel,
  onDone,
}: {
  file: File;
  width: number;
  height: number;
  round?: boolean;
  title: string;
  onCancel: () => void;
  onDone: (blob: Blob) => void;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  /** Dedos na tela (para o zoom de pinça no celular). */
  const fingers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  // Tamanho da área de recorte na tela (cabe no celular: largura da tela menos as margens do modal).
  const [viewW] = useState(() => Math.max(200, Math.min(round ? 280 : 480, (typeof window === "undefined" ? 480 : window.innerWidth) - 72)));
  const viewH = (viewW * height) / width;

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const i = new Image();
    i.onload = () => setImg(i);
    i.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Escala mínima para a imagem cobrir a área de recorte.
  const base = img ? Math.max(viewW / img.naturalWidth, viewH / img.naturalHeight) : 1;
  const scale = base * zoom;
  const dw = img ? img.naturalWidth * scale : 0;
  const dh = img ? img.naturalHeight * scale : 0;
  const clamp = (p: { x: number; y: number }) => ({
    x: Math.min(0, Math.max(viewW - dw, p.x)),
    y: Math.min(0, Math.max(viewH - dh, p.y)),
  });

  // Centraliza ao carregar e mantém dentro dos limites ao mudar o zoom.
  useEffect(() => { if (img) setPos(clamp({ x: (viewW - dw) / 2, y: (viewH - dh) / 2 })); }, [img]); // eslint-disable-line react-hooks/exhaustive-deps
  const changeZoom = (z: number) => {
    const nz = Math.min(4, Math.max(1, z));
    const ns = base * nz;
    // Zoom em torno do centro da área.
    const cx = (viewW / 2 - pos.x) / scale;
    const cy = (viewH / 2 - pos.y) / scale;
    setZoom(nz);
    const ndw = img!.naturalWidth * ns, ndh = img!.naturalHeight * ns;
    setPos({
      x: Math.min(0, Math.max(viewW - ndw, viewW / 2 - cx * ns)),
      y: Math.min(0, Math.max(viewH - ndh, viewH / 2 - cy * ns)),
    });
  };

  const save = () => {
    if (!img) return;
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    const k = width / viewW;
    ctx.drawImage(img, pos.x * k, pos.y * k, dw * k, dh * k);
    c.toBlob((b) => b && onDone(b), "image/png");
  };

  return (
    <Modal
      title={title}
      subtitle="Arraste para posicionar e use o zoom (ou pince com dois dedos)."
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
          <Button disabled={!img} onClick={save}>Aplicar</Button>
        </>
      }
    >
      <div
        className={`cropper${round ? " cropper-round" : ""}`}
        style={{ width: viewW, height: viewH }}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          const pts = [...fingers.current.values()];
          if (pts.length === 2) {
            drag.current = null;
            pinch.current = { dist: Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y), zoom };
          } else {
            drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
          }
        }}
        onPointerMove={(e) => {
          if (fingers.current.has(e.pointerId)) fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          const pts = [...fingers.current.values()];
          if (pinch.current && pts.length === 2) {
            const dist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
            return changeZoom((pinch.current.zoom * dist) / pinch.current.dist);
          }
          const d = drag.current;
          if (d) setPos(clamp({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y }));
        }}
        onPointerUp={(e) => {
          fingers.current.delete(e.pointerId);
          pinch.current = null;
          drag.current = null;
        }}
        onPointerCancel={(e) => {
          fingers.current.delete(e.pointerId);
          pinch.current = null;
          drag.current = null;
        }}
        onWheel={(e) => changeZoom(zoom - e.deltaY * 0.002)}
      >
        {img && <img src={img.src} alt="" draggable={false} style={{ width: dw, height: dh, transform: `translate(${pos.x}px, ${pos.y}px)` }} />}
      </div>
      <input
        className="cropper-zoom"
        type="range"
        min={1}
        max={4}
        step={0.01}
        value={zoom}
        aria-label="Zoom"
        onChange={(e) => changeZoom(Number(e.target.value))}
      />
    </Modal>
  );
}
