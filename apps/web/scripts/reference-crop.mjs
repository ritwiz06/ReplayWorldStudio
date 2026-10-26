// The crop a reference photo sends to the vision model (ENR-01), made the way the app makes it:
// in Chromium, the file decoded with its EXIF orientation, the chosen part drawn on a canvas at
// most 1600 px, and re-encoded as JPEG (quality 0.85), so no metadata goes with it. Used by
// scripts/record_appearance.py; the app's own code is src/photo/image.ts (analysisCopy).
//
//   node scripts/reference-crop.mjs PHOTO LEFT TOP RIGHT BOTTOM OUT.jpg
/* global process, console, Buffer, fetch, createImageBitmap, document, btoa -- Node, and Chromium in page.evaluate */
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const [photo, left, top, right, bottom, out] = process.argv.slice(2);
if (!out) {
  console.error("usage: node scripts/reference-crop.mjs PHOTO LEFT TOP RIGHT BOTTOM OUT.jpg");
  process.exit(2);
}
const mime = photo.endsWith(".png") ? "image/png" : photo.endsWith(".webp") ? "image/webp" : "image/jpeg";
const crop = { left: Number(left), top: Number(top), right: Number(right), bottom: Number(bottom) };
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const result = await page.evaluate(
    async ({ data, mime, crop }) => {
      const blob = await (await fetch(`data:${mime};base64,${data}`)).blob();
      const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
      const sx = Math.round(crop.left * bitmap.width);
      const sy = Math.round(crop.top * bitmap.height);
      const sw = Math.max(1, Math.round(crop.right * bitmap.width) - sx);
      const sh = Math.max(1, Math.round(crop.bottom * bitmap.height) - sy);
      const scale = Math.min(1, 1600 / Math.max(sw, sh));
      const width = Math.max(1, Math.round(sw * scale));
      const height = Math.max(1, Math.round(sh * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(bitmap, sx, sy, sw, sh, 0, 0, width, height);
      const jpeg = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
      const bytes = new Uint8Array(await jpeg.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { data: btoa(binary), width, height };
    },
    { data: readFileSync(photo).toString("base64"), mime, crop },
  );
  writeFileSync(out, Buffer.from(result.data, "base64"));
  console.log(JSON.stringify({ width: result.width, height: result.height }));
} finally {
  await browser.close();
}
