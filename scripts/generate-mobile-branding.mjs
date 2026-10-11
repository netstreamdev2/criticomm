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
const h = paths.find((value) => value.includes('M 614.225 0'));
if (!h) throw new Error('The HIKTECH H letterform was not found in the source logo.');
const output = path.join(root, 'apps/mobile/assets/branding');
await fs.mkdir(output, { recursive: true });
const svg = (body, size = 1024) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">${body}</svg>`;
const mark = (width, x, y, white = false) => `<svg x="${x}" y="${y}" width="${width}" height="${width * 490.52 / 700}" viewBox="-1 -1.52 700 490.52">${white ? h.replace(/fill="[^"]+"/, 'fill="#ffffff"') : h}</svg>`;
// Silver TECH lettering is the dark-background variant; all paths stay intact.
const wordmark = `<svg x="222" y="600" width="580" height="78" viewBox="-1.39 -1.52 3647.84 490.52">${paths.join('').replace(/rgba\((?:97, 97, 101|87, 87, 90), 1\)/g, '#D5D9DE')}</svg>`;
const assets = {
  'icon.png': svg(`<rect width="1024" height="1024" fill="#050510"/>${mark(660, 182, 281)}`),
  // Keep the foreground inside Android's central safe area for circular masks.
  'adaptive-icon.png': svg(mark(550, 237, 319)),
  'monochrome-icon.png': svg(mark(550, 237, 319, true)),
  'splash.png': svg(`${mark(390, 317, 275)}${wordmark}`),
  'notification-icon.png': svg(mark(840, 92, 218, true), 96),
};
for (const [name, source] of Object.entries(assets)) {
  const image = sharp(Buffer.from(source));
  if (name === 'icon.png') image.removeAlpha();
  await image.png().toFile(path.join(output, name));
  const meta = await sharp(path.join(output, name)).metadata();
  console.log(`${name}: ${meta.width} x ${meta.height}, alpha=${meta.hasAlpha}`);
}
