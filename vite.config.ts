import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  css: {
    postcss: {},
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/cdn-entry.ts'),
      name: 'MoneyPulseCDN',
      formats: ['iife'],
      fileName: () => 'checkout.iife.js',
    },
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      output: {
        extend: true,
      },
    },
  },
});
