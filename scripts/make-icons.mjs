// Icon generator: resize a source image into 16/48/128 px PNG icons.
// Source defaults to public/icons/butterfly.png. Square output, aspect preserved,
// letterboxed onto a transparent canvas (fit: contain).
import sharp from 'sharp';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../public/icons');
const SRC = resolve(OUT, process.env.ICON_SRC ?? 'butterfly.png');

if (!existsSync(SRC)) {
  console.error(`Source image not found: ${SRC}`);
  process.exit(1);
}

for (const size of [16, 48, 128]) {
  const out = resolve(OUT, `icon${size}.png`);
  await sharp(SRC)
    .resize(size, size, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 }, // transparent letterbox
    })
    .png()
    .toFile(out);
  console.log(`wrote icon${size}.png`);
}
