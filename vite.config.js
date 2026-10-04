import { defineConfig } from 'vite';
import { localParserPlugin } from './dev_scripts/local_parser_assets.mjs';

export default defineConfig({
  base: './',
  plugins: [
    localParserPlugin(),
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
