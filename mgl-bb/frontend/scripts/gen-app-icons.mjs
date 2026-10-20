/**
 * gen-app-icons.mjs — rasterize the PWA / home-screen icon set from the
 * existing brand mark in `public/favicon.svg`.
 *
 *   npm run icons
 *
 * Design notes (read before changing a ratio):
 *
 *  • Composition happens entirely in SVG: a solid `<rect>` plate plus the
 *    favicon nested as an inner `<svg>` with explicit x/y/width/height.
 *    sharp only rasterizes the result — no image compositing, no resize
 *    chain, so the glyph stays crisp at every size and there is exactly one
 *    source of truth for the artwork (public/favicon.svg).
 *
 *  • favicon.svg is `viewBox="670 250 580 580"` — already square — and its
 *    paths are pure `fill="#ffffff"`. So it needs no recolouring, only a
 *    dark plate behind it. (If the favicon ever gains non-white fills or a
 *    non-square viewBox, this script must be revisited.)
 *
 *  • NO rounded corners (`rx`). iOS applies its own squircle mask to the
 *    apple-touch-icon and Android applies an adaptive mask to the maskable
 *    icon; pre-rounding here double-rounds and leaves ugly dark slivers in
 *    the corners.
 *
 *  • The maskable ratio is 0.5625, not the usual 0.72. Android's TIGHTEST
 *    adaptive-icon mask is a circle of diameter 0.8 × size. The largest
 *    square that fits inside that circle has a side of 0.8 × 512 / √2 ≈
 *    289.6 px. At 0.5625 the glyph box is 288 px — just inside that, so no
 *    mask on any launcher can ever clip it.
 *
 *  • apple-touch-icon is fully opaque on purpose: iOS composites any
 *    transparency onto BLACK, and a white glyph on transparent would still
 *    look fine — but a *partially* transparent plate produces banding, and
 *    Safari's "Add to Home Screen" preview is unforgiving. Keep it solid.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FAVICON = path.join(ROOT, 'public', 'favicon.svg');
const OUT_DIR = path.join(ROOT, 'public', 'icons');

const BG = '#0d0d11'; // must match manifest background_color / theme_color

/**
 * [filename, pixel size, glyph ratio, options]
 *
 *   plate   — draw the dark background rect (default true)
 *   flatten — drop the alpha channel entirely (default false)
 */
const TARGETS = [
  ['icon-192.png', 192, 0.72, {}],
  ['icon-512.png', 512, 0.72, {}],
  // See the header note: 0.8-diameter circle → inscribed square ≈ 0.5657.
  ['maskable-512.png', 512, 0.5625, {}],
  // `flatten` is not cosmetic: iOS composites any alpha onto BLACK and the
  // Add-to-Home-Screen preview is unforgiving about semi-transparent edges.
  // Shipping a 3-channel PNG removes the question entirely.
  ['apple-touch-icon.png', 180, 0.72, { flatten: true }],
  /*
   * Notification badge — NO PLATE, transparent background, on purpose.
   *
   * Android (and Chrome desktop) treat `badge` as a MONOCHROME MASK: they
   * throw away the RGB channels and keep only alpha, then tint the result.
   * With the dark plate every pixel is alpha=255, so the badge renders as a
   * solid filled circle instead of the MGL mark. The glyph must therefore be
   * the only opaque thing in the image. Slightly tighter ratio because it is
   * displayed at ~24 dp and masked to a circle.
   */
  ['badge-72.png', 72, 0.62, { plate: false }],
];

/**
 * Strip the XML prolog from the source SVG — an `<?xml …?>` declaration is
 * only legal at the very start of a document, and we are nesting this SVG
 * inside another one.
 */
function inlineSvgBody(raw) {
  return raw.replace(/<\?xml[\s\S]*?\?>\s*/i, '').trim();
}

/**
 * Build the composed SVG: dark plate + centred brand mark.
 * The inner <svg> keeps its own viewBox, so x/y/width/height alone scale and
 * position it — no path maths required.
 */
function composeSvg(inner, size, ratio, plate = true) {
  const glyph = Math.round(size * ratio);
  const offset = Math.round((size - glyph) / 2);
  const positioned = inner.replace(
    /<svg\b([^>]*)>/i,
    (_m, attrs) =>
      `<svg${attrs} x="${offset}" y="${offset}" width="${glyph}" height="${glyph}">`,
  );
  const rect = plate
    ? `<rect x="0" y="0" width="${size}" height="${size}" fill="${BG}"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${rect}
  ${positioned}
</svg>`;
}

async function main() {
  const raw = await readFile(FAVICON, 'utf8');
  const inner = inlineSvgBody(raw);
  if (!/^<svg\b/i.test(inner)) {
    throw new Error(`Unexpected favicon.svg shape — expected a root <svg> element: ${FAVICON}`);
  }

  await mkdir(OUT_DIR, { recursive: true });

  for (const [name, size, ratio, opts = {}] of TARGETS) {
    const plate = opts.plate !== false;
    const svg = composeSvg(inner, size, ratio, plate);
    let pipeline = sharp(Buffer.from(svg), { density: 384 }).resize(size, size, {
      fit: 'fill',
    });
    if (opts.flatten) pipeline = pipeline.flatten({ background: BG });
    const png = await pipeline.png({ compressionLevel: 9 }).toBuffer();
    await writeFile(path.join(OUT_DIR, name), png);
    const meta = await sharp(png).metadata();
    console.log(
      `  ✓ icons/${name.padEnd(22)} ${meta.width}×${meta.height}  ` +
        `${meta.hasAlpha ? 'RGBA' : 'RGB '}  ${png.length} B`,
    );
  }

  console.log(`\nWrote ${TARGETS.length} icons to ${path.relative(ROOT, OUT_DIR)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
