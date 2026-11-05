import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { newId } from "./auth.js";

export type ImageKind = "avatar" | "banner" | "icon";

/** Tamanho final: a foto é quadrada, o banner é largo (3:1). Sempre WebP, sem metadados. */
const SIZES: Record<ImageKind, { w: number; h: number }> = {
  avatar: { w: 256, h: 256 },
  banner: { w: 960, h: 320 },
  icon: { w: 256, h: 256 },
};
const ALLOWED = new Set(["jpeg", "png", "webp", "gif"]);

/** Valida pelos bytes (não pelo tipo que o cliente declarou) e devolve o WebP reprocessado, ou null se não for imagem aceita. */
export async function processImage(input: Buffer, kind: ImageKind): Promise<Buffer | null> {
  try {
    const img = sharp(input, { limitInputPixels: 50_000_000 });
    const meta = await img.metadata();
    if (!meta.format || !ALLOWED.has(meta.format)) return null;
    const { w, h } = SIZES[kind];
    return await img.rotate().resize(w, h, { fit: "cover" }).webp({ quality: 85 }).toBuffer();
  } catch {
    return null;
  }
}

/**
 * Anexo do chat. Imagens comuns são regravadas sem metadados (tira a localização do GPS das fotos do celular),
 * no mesmo formato; GIF fica como veio para não perder a animação. Outros arquivos são guardados como estão.
 */
export async function processAttachment(input: Buffer): Promise<{ data: Buffer; ext: string; mime: string; width: number | null; height: number | null }> {
  try {
    const meta = await sharp(input, { limitInputPixels: 100_000_000 }).metadata();
    if (meta.format && ALLOWED.has(meta.format)) {
      if (meta.format === "gif") return { data: input, ext: "gif", mime: "image/gif", width: meta.width ?? null, height: meta.pageHeight ?? meta.height ?? null };
      const img = sharp(input, { limitInputPixels: 100_000_000 }).rotate();
      const out = meta.format === "jpeg" ? img.jpeg({ quality: 90, mozjpeg: true }) : meta.format === "png" ? img.png() : img.webp({ quality: 90 });
      const { data, info } = await out.toBuffer({ resolveWithObject: true });
      const ext = meta.format === "jpeg" ? "jpg" : meta.format;
      return { data, ext, mime: `image/${meta.format}`, width: info.width, height: info.height };
    }
  } catch {
    // não é imagem que o sharp entende: vai como arquivo comum
  }
  return { data: input, ext: "bin", mime: "application/octet-stream", width: null, height: null };
}

const KEY = /^[A-Za-z0-9_-]{8,64}\.(webp|png|jpg|gif|bin)$/;
export const isFileKey = (k: string) => KEY.test(k);

export function fileStore(dir: string) {
  return {
    async save(data: Buffer, ext = "webp"): Promise<string> {
      await mkdir(dir, { recursive: true });
      const key = `${newId()}.${ext}`;
      await writeFile(join(dir, key), data);
      return key;
    },
    async remove(key: string | null | undefined) {
      if (key && isFileKey(key)) await rm(join(dir, key), { force: true });
    },
    dir,
  };
}
