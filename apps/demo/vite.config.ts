import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The demo is deployed to GitHub Pages under /openage-pfadfinder/,
// so the base must include the repository sub-path.
export default defineConfig({
  base: '/openage-pfadfinder/',
  plugins: [react(), tailwindcss()],
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    open: true,
  },
});
