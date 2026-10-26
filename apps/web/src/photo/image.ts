// Reading a photo in the browser (IMG-01, ENR-01): checked by its content, size and pixels, shown
// at once, and copied without metadata for the vision model. The original file is never changed;
// orientation comes from the file (EXIF), as every photo here is displayed.
import type { ImageBox } from "@replay-world/contracts";
import type { Pixels } from "./colour";

export const PHOTO_LIMITS = { maxBytes: 15 * 1024 * 1024, maxPixels: 50_000_000, minSide: 64, analysisSide: 1600 } as const;
export interface Photo {
  file: File;
  url: string;
  widthPx: number;
  heightPx: number;
  sha256: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  /** A small decoded copy, for suggesting each object's colour; null if it could not be made. */
  pixels: Pixels | null;
}

/** Longest side of the decoded copy used for colours. */
const COLOUR_SIDE = 480;

function smallPixels(bitmap: ImageBitmap): Pixels | null {
  const scale = Math.min(1, COLOUR_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const context = Object.assign(document.createElement("canvas"), { width, height }).getContext("2d");
  if (!context) return null;
  context.drawImage(bitmap, 0, 0, width, height);
  return { data: context.getImageData(0, 0, width, height).data, width, height };
}

export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

function sniff(bytes: Uint8Array): Photo["mediaType"] | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  const text = String.fromCharCode(...bytes.slice(0, 12));
  if (text.startsWith("RIFF") && text.slice(8, 12) === "WEBP") return "image/webp";
  return null;
}

/** Check the file in the browser first (format by content, size, pixels) and show it. */
export async function readPhoto(file: File): Promise<Photo | string> {
  if (file.size > PHOTO_LIMITS.maxBytes) return `The photo is ${(file.size / 1048576).toFixed(1)} MB; the limit is 15 MB.`;
  const buffer = await file.arrayBuffer();
  const mediaType = sniff(new Uint8Array(buffer.slice(0, 16)));
  if (!mediaType) return "Only JPEG, PNG and WebP photos are supported.";
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return "The photo could not be read; it may be damaged.";
  }
  const { width, height } = bitmap;
  let pixels: Pixels | null;
  try {
    pixels = smallPixels(bitmap);
  } catch {
    pixels = null; // colours then come from the model alone
  }
  bitmap.close();
  if (Math.min(width, height) < PHOTO_LIMITS.minSide) return `The photo is only ${width} × ${height} px; at least ${PHOTO_LIMITS.minSide} px on each side is needed.`;
  if (width * height > PHOTO_LIMITS.maxPixels) return `The photo has ${((width * height) / 1e6).toFixed(0)} megapixels; the limit is 50.`;
  return { file, url: URL.createObjectURL(file), widthPx: width, heightPx: height, sha256: await sha256Hex(buffer), mediaType, pixels };
}

export const WHOLE: ImageBox = { left: 0, top: 0, right: 1, bottom: 1 };

/** A copy for the vision model: the chosen part of the photo (all of it by default), at most
 * 1600 px, re-encoded as JPEG, so no metadata goes with it. Never enlarged. */
export async function analysisCopy(file: Blob, crop: ImageBox = WHOLE): Promise<{ data: string; width: number; height: number }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const sx = Math.round(crop.left * bitmap.width);
  const sy = Math.round(crop.top * bitmap.height);
  const sw = Math.max(1, Math.round(crop.right * bitmap.width) - sx);
  const sh = Math.max(1, Math.round(crop.bottom * bitmap.height) - sy);
  const scale = Math.min(1, PHOTO_LIMITS.analysisSide / Math.max(sw, sh));
  const width = Math.max(1, Math.round(sw * scale));
  const height = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, sx, sy, sw, sh, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", 0.85));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { data: btoa(binary), width, height };
}

