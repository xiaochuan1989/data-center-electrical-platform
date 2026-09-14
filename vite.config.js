import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [
    {
      name: 'strip-embedded-catalog-prices',
      transformIndexHtml(html) {
        return html.replace(/priceEnc:\s*"[^"]*"/g, 'priceEnc: ""');
      }
    }
  ],
  build: {
    target: 'es2018',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false
  }
});
