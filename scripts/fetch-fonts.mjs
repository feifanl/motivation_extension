// One-off: download the `latin` woff2 subset per weight from Google Fonts.
// Not part of the build. Run: node scripts/fetch-fonts.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../public/fonts');
mkdirSync(OUT, { recursive: true });

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const JOBS = [
  {
    css: 'https://fonts.googleapis.com/css2?family=Fraunces:wght@400;600&display=swap',
    map: { 400: 'fraunces-400.woff2', 600: 'fraunces-600.woff2' },
  },
  {
    css: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&display=swap',
    map: { 400: 'plex-sans-400.woff2', 500: 'plex-sans-500.woff2', 600: 'plex-sans-600.woff2' },
  },
];

// Parse the CSS: for each @font-face immediately preceded by `/* latin */`,
// capture its font-weight and woff2 URL.
function parseLatin(css) {
  const out = {};
  const blocks = css.split('@font-face');
  for (let i = 1; i < blocks.length; i++) {
    const preComment = blocks[i - 1].trim();
    const isLatin = /\/\*\s*latin\s*\*\/\s*$/.test(preComment);
    if (!isLatin) continue;
    const body = blocks[i];
    const w = body.match(/font-weight:\s*(\d+)/);
    const u = body.match(/url\((https:\/\/[^)]+\.woff2)\)/);
    if (w && u) out[w[1]] = u[1];
  }
  return out;
}

for (const job of JOBS) {
  const cssRes = await fetch(job.css, { headers: { 'User-Agent': UA } });
  const css = await cssRes.text();
  const latin = parseLatin(css);
  for (const [weight, filename] of Object.entries(job.map)) {
    const url = latin[weight];
    if (!url) throw new Error(`no latin url for weight ${weight} in ${job.css}`);
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(resolve(OUT, filename), buf);
    console.log(`wrote ${filename} (${buf.length} bytes)`);
  }
}
