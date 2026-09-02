import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'dist-electron/main',
    lib: {
      entry: resolve(__dirname, 'electron/main.ts'),
      fileName: () => 'main.cjs',
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
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
});
