#!/usr/bin/env node
/**
 * End-to-end check of the pre-boot launcher.
 *
 * The capture tools all pass ?capture=1, which skips the launcher by design —
 * so none of them exercise this path. This drives it the way a player does:
 * load cold, wait for the launcher, pick a tier, press Play, and confirm the
 * engine reaches __READY__ with the preset that was chosen.
 *
 *   node tools/launchertest.mjs --tier=Minimum
 */
import { chromium } from 'playwright';
import { GPU_ARGS } from './gpuargs.mjs';
import { grab } from './grab.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);
const PORT = Number(args.port ?? 5173);
const TIER = args.tier ?? 'Minimum';
const OUT = args.out ?? 'shots/launcher.png';
const BOOT_TIMEOUT = Number(args.timeout ?? 600000);

const browser = await chromium.launch({ headless: true, args: GPU_ARGS });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

let failed = null;
try {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: BOOT_TIMEOUT });

  await page.waitForSelector('.sl-launcher', { timeout: 60000 });
  const before = await page.evaluate(() => window.__READY__ === true);
  if (before) throw new Error('engine booted before the launcher was answered');

  await grab(page, 'shots/launcher-screen.png');

  await page.click(`.sl-lch-tiers button:text-is("${TIER}")`);
  const picked = await page.evaluate(
    () => document.querySelector('.sl-lch-tiers button.on')?.textContent
  );
  await page.click('#sl-lch-go');

  await page.waitForFunction('window.__READY__ === true', null, { timeout: BOOT_TIMEOUT });
  const quality = await page.evaluate(() => window.__ENGINE__?.ctx?.config?.quality ?? null);
  const scale = await page.evaluate(() => window.__ENGINE__?.ctx?.config?.q?.renderScale ?? null);

  await grab(page, OUT);
  console.log(JSON.stringify({ ok: true, picked, quality, renderScale: scale, out: OUT }, null, 2));
} catch (e) {
  failed = e;
} finally {
  if (failed) {
    console.error(JSON.stringify({ ok: false, error: failed.message }, null, 2));
    console.error(logs.slice(-25).join('\n'));
  }
  await browser.close();
  process.exit(failed ? 1 : 0);
}
