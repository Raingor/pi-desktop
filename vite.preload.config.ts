import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'dist-electron/preload',
    lib: {
      entry: resolve(__dirname, 'electron/preload.ts'),
      fileName: () => 'preload.cjs',
      formats: ['cjs'],
    },
    rollupOptions: {
      output: {
        format: 'cjs',
        exports: 'auto',
      },
    },
    target: 'node18',
    minify: false,
    ssr: true,
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
});
