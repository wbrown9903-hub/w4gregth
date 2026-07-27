/**
 * Strike Legion — desktop shell.
 *
 * This is Electron, which means it is Chromium: it does NOT make the renderer
 * faster than the same machine's browser. What it does buy you is control that
 * a stock browser will not give up:
 *
 *   - GPU blocklist override. Chrome ships a blocklist of drivers it refuses to
 *     use hardware acceleration on. If your GPU is on it, the browser silently
 *     falls back to software rasterisation and a frame takes seconds. That is
 *     the single most common cause of "it never loads" on hardware that is
 *     otherwise perfectly capable, and the flags below turn it off.
 *   - No extensions, no tab throttling, no background-tab timer clamping.
 *   - A fixed quality preset, so it does not boot at `ultra` on a laptop.
 *
 * The built game is served over loopback HTTP rather than loaded from file://,
 * because ES modules are blocked by CORS under file:// and the game is entirely
 * ES modules.
 */
const { app, BrowserWindow, shell } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

// In development the build sits next to this folder. Once packaged, __dirname
// is inside app.asar, so '..' would point at the asar's parent rather than the
// bundled copy — packaged builds read it out of resources/ instead.
const DIST = app.isPackaged
  ? path.join(process.resourcesPath, 'dist')
  : path.join(__dirname, '..', 'dist');

// Quality preset for the desktop build. `ultra` is a benchmark setting, not a
// sensible default on unknown hardware; `medium` is the one that actually runs.
const QUALITY = process.env.SL_QUALITY || 'medium';
const PREWARM = process.env.SL_PREWARM === '1' ? '1' : '0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.map': 'application/json; charset=utf-8',
};

function serveDist() {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(path.join(DIST, 'index.html'))) {
      reject(new Error(`No build found at ${DIST}\n\nRun "npm run build" in the project root first.`));
      return;
    }
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent((req.url || '/').split('?')[0]);
      let file = path.join(DIST, url === '/' ? 'index.html' : url);
      // Never let a crafted path escape the build directory.
      if (!file.startsWith(DIST)) {
        res.writeHead(403).end('forbidden');
        return;
      }
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// Must be set before the app is ready — Chromium reads these at GPU init.
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('disable-frame-rate-limit');
app.commandLine.appendSwitch('force_high_performance_gpu');

app.whenReady().then(async () => {
  let server;
  try {
    server = await serveDist();
  } catch (err) {
    const { dialog } = require('electron');
    dialog.showErrorBox('Strike Legion', err.message);
    app.quit();
    return;
  }

  const { port } = server.address();

  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    backgroundColor: '#05070a',
    title: 'Strike Legion',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // The game owns the pointer; without this the OS cursor fights it.
      backgroundThrottling: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  // External links open in the real browser, not inside the game window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.loadURL(`http://127.0.0.1:${port}/?q=${QUALITY}&prewarm=${PREWARM}`);

  app.on('before-quit', () => server.close());
});

app.on('window-all-closed', () => app.quit());
