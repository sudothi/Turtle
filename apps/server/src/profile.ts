import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { newId } from "./auth.js";

export type ImageKind = "avatar" | "banner";

/** Tamanho final: a foto é quadrada, o banner é largo (3:1). Sempre WebP, sem metadados. */
const SIZES: Record<ImageKind, { w: number; h: number }> = {
  avatar: { w: 256, h: 256 },
  banner: { w: 960, h: 320 },
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

const KEY = /^[A-Za-z0-9_-]{8,64}\.webp$/;
export const isFileKey = (k: string) => KEY.test(k);

export function fileStore(dir: string) {
  return {
    async save(data: Buffer): Promise<string> {
      await mkdir(dir, { recursive: true });
      const key = `${newId()}.webp`;
      await writeFile(join(dir, key), data);
      return key;
    },
    async remove(key: string | null | undefined) {
      if (key && isFileKey(key)) await rm(join(dir, key), { force: true });
    },
    dir,
  };
}
