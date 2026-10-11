// Export the existing vector brand without redrawing its letterforms.
// Run from the repository root: node scripts/generate-mobile-branding.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(path.join(root, 'apps/mobile/package.json'));
// Reuse the image renderer installed with Expo's image tooling.
const imageUtils = require.resolve('@expo/image-utils');
const sharp = require(require.resolve('sharp', { paths: [path.dirname(imageUtils)] }));
const brand = await fs.readFile(path.join(root, 'apps/web/public/hiktech-brand.svg'), 'utf8');
const paths = [...brand.matchAll(/<path\b[^>]*\/>/g)].map(([value]) => value);
if (paths.length !== 9) throw new Error('Unexpected HIKTECH vector source; check the wordmark before exporting.');
const output = path.join(root, 'apps/mobile/assets/branding');
await fs.mkdir(output, { recursive: true });
const svg = (body, size = 1024) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">${body}</svg>`;
const wordmark = (width, x, y, white = false) => `<svg x="${x}" y="${y}" width="${width}" height="${width * 490.52 / 3647.84}" viewBox="-1.39 -1.52 3647.84 490.52">${white ? paths.join('').replace(/fill="[^"]+"/g, 'fill="#ffffff"') : paths.join('')}</svg>`;
// Match the supplied logo: full red/grey wordmark on a 238:50 white badge.
// Preserve the original grey fills and letterforms; do not substitute a monogram.
const badge = (width) => {
  const height = width * 50 / 238;
  const inset = width * 10 / 238;
  const logoWidth = width - inset * 2;
  const logoHeight = logoWidth * 490.52 / 3647.84;
  const x = (1024 - width) / 2;
  const y = (1024 - height) / 2;
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${inset}" fill="#ffffff"/>${wordmark(logoWidth, x + inset, (1024 - logoHeight) / 2)}`;
};
const assets = {
  'icon.png': svg(`<rect width="1024" height="1024" fill="#050510"/>${badge(864)}`),
  // Keep the foreground inside Android's central safe area for circular masks.
  'adaptive-icon.png': svg(badge(640)),
  'monochrome-icon.png': svg(wordmark(600, 212, (1024 - 600 * 490.52 / 3647.84) / 2, true)),
  'splash.png': svg(badge(640)),
  'notification-icon.png': svg(wordmark(900, 62, (1024 - 900 * 490.52 / 3647.84) / 2, true), 96),
};
for (const [name, source] of Object.entries(assets)) {
  const image = sharp(Buffer.from(source));
  if (name === 'icon.png') image.removeAlpha();
  await image.png().toFile(path.join(output, name));
  const meta = await sharp(path.join(output, name)).metadata();
  console.log(`${name}: ${meta.width} x ${meta.height}, alpha=${meta.hasAlpha}`);
}
