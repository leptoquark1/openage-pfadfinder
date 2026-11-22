import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const librarySource = (file: string) =>
  fileURLToPath(new URL(`../../packages/pfadfinder/src/${file}`, import.meta.url));

// The demo is deployed to GitHub Pages under /openage-pfadfinder/,
// so the base must include the repository sub-path.
export default defineConfig(({ command }) => ({
  base: '/openage-pfadfinder/',
  plugins: [react(), tailwindcss()],
  publicDir: 'public',
  // The dev server uses the library's sources, so edits there hot-reload without a rebuild.
  // Production builds keep using the published entry point in dist/.
  resolve: {
    alias:
      command === 'serve'
        ? [{ find: /^@leptoquark1\/openage-pfadfinder$/, replacement: librarySource('index.ts') }]
        : [],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: ['index.html', 'guide.html'],
    },
  },
  server: {
    open: true,
  },
}));
