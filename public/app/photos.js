// Shrinks a photo in the browser before it's uploaded, used by the dashboard (app.js) and the
// sign-up page (signup.js). JPEGs are always redrawn, which drops their EXIF data, including GPS
// location. PNG and WebP are only redrawn when they're too big, to keep transparency.
// Returns { blob, name, width?, height? }.
export async function shrink(file, maxSide) {
  const type = file.type.toLowerCase();
  const heic = /heic|heif/.test(type) || /\.(heic|heif)$/i.test(file.name);
  if (!/^image\/(jpeg|png|webp)$/.test(type) && !heic) return { blob: file, name: file.name };
  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    if (heic) throw new Error("This browser can't open HEIC photos. Export it as a JPEG first (or upload from your phone).");
    return { blob: file, name: file.name };
  }
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  if (scale === 1 && !heic && type !== "image/jpeg") return { blob: file, name: file.name, width: bmp.width, height: bmp.height };
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(bmp, 0, 0, w, h);
  const outType = type === "image/png" ? "image/png" : type === "image/webp" ? "image/webp" : "image/jpeg";
  const blob = await new Promise(r => canvas.toBlob(r, outType, 0.85));
  if (!blob || blob.type !== outType) return { blob: file, name: file.name, width: bmp.width, height: bmp.height };
  const ext = { "image/png": "png", "image/webp": "webp", "image/jpeg": "jpg" }[outType];
  return { blob, name: file.name.replace(/\.[^.]+$/, "") + "." + ext, width: w, height: h };
}
