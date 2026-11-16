// Open the built site (dist/, served on http://localhost:4173 by `python3 -m http.server 4173 -d dist`)
// in a new tab of the managed browser at 390 px and 1280 px wide, before entering VR.
// Reports console errors/warnings and page errors, and saves a screenshot per width
// to .stills-tmp/. The tab is closed afterwards; the app tab is not touched.
import fs from 'node:fs';
import path from 'node:path';

export default async function ({ context, workspaceRoot }) {
  const dir = path.join(workspaceRoot, '.stills-tmp');
  fs.mkdirSync(dir, { recursive: true });
  const results = [];
  for (const [w, h] of [[390, 844], [1280, 800]]) {
    const page = await context.newPage();
    const msgs = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') msgs.push(`${m.type()}: ${m.text().slice(0, 200)}`); });
    page.on('pageerror', (e) => msgs.push(`pageerror: ${String(e).slice(0, 200)}`));
    page.on('requestfailed', (r) => msgs.push(`requestfailed: ${r.url().slice(0, 120)}`));
    await page.setViewportSize({ width: w, height: h });
    await page.goto('http://localhost:4173/', { waitUntil: 'load' });
    await page.waitForTimeout(8000);
    const info = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth, innerW: innerWidth,
      buttons: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).filter(Boolean).slice(0, 5),
      xr: 'xr' in navigator,
    }));
    const shot = path.join(dir, `dist-${w}.png`);
    await page.screenshot({ path: shot });
    results.push({ width: w, ...info, messages: msgs, shot });
    await page.close();
  }
  return results;
}
