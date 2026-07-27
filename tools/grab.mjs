import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Screenshot a page via raw CDP instead of page.screenshot().
 *
 * Playwright's screenshot stabilises the page first, and part of that is
 * awaiting `document.fonts.ready`. In a headless container with no system
 * fonts installed that promise can stay pending forever, so every capture died
 * at the last step with "waiting for fonts to load" — after the game had
 * booted, applied the shot and pumped its settle frames perfectly well.
 *
 * `Page.captureScreenshot` does none of that waiting. We only ever want the
 * WebGL canvas plus the DOM HUD composited as-is, which is exactly what it
 * returns.
 */
export async function grab(page, outPath, { format = 'png', quality } = {}) {
  const client = await page.context().newCDPSession(page);
  try {
    const params = { format, captureBeyondViewport: false, fromSurface: true };
    if (format === 'jpeg' && quality != null) params.quality = quality;
    const { data } = await client.send('Page.captureScreenshot', params);
    if (outPath) {
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, Buffer.from(data, 'base64'));
    }
    return Buffer.from(data, 'base64');
  } finally {
    await client.detach().catch(() => {});
  }
}
