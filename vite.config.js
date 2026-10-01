import { defineConfig } from 'vite';

export default defineConfig({
  // Relative paths so the same build works on GitHub Pages subpaths and inside the Capacitor WebView.
  base: './',
});
