import { defineConfig } from 'vite';

export default defineConfig({
  // Bind IPv4 explicitly: the default `localhost` binds ::1 only on macOS,
  // which the capture harness (127.0.0.1) cannot reach.
  // `hmr: false` when the capture harness owns the server (OW_NO_HMR=1): a file
  // saved by a concurrently-working agent otherwise reloads the page mid-capture
  // and playwright fails with "Execution context was destroyed".
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    hmr: process.env.OW_NO_HMR ? false : undefined,
  },
  preview: { host: '127.0.0.1' },
  // Relative base so the same build works served from a domain root, from a
  // GitHub Pages project subpath (/<repo>/), and from the desktop shell's
  // loopback server — without rebuilding for each.
  base: './',
  build: {
    target: 'es2022',
    // The sourcemap is ~6.6 MB against a ~500 kB gzipped bundle. Useful
    // locally, dead weight for anyone loading this over the public internet.
    sourcemap: process.env.SL_SOURCEMAP === '1',
    chunkSizeWarningLimit: 4096,
  },
  // Large binary game assets served verbatim.
  assetsInclude: ['**/*.ktx2', '**/*.hdr', '**/*.exr', '**/*.bin', '**/*.glb'],
});
