import os from 'node:os';

/**
 * Chromium GPU flags for the headless harness.
 *
 * macOS gets the Metal ANGLE backend, which is what the perf numbers in the
 * README were measured on. Anywhere else — Linux CI, containers, any box
 * without a usable GPU — falls back to SwiftShader so WebGL2 still
 * initialises instead of the page hanging forever on `window.__READY__`.
 * Root-owned containers also need the sandbox off and /dev/shm bypassed.
 */
export const GPU_ARGS =
  os.platform() === 'darwin'
    ? ['--use-angle=metal']
    : [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-setuid-sandbox',
      ];
