/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig(({ mode }) => ({
  define: {
    __VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    host: true,
    cors: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: mode === 'development',
    minify: mode !== 'development',
    lib: {
      entry: 'src/live-energy-card.ts',
      formats: ['es'],
      fileName: () => 'live-energy-card.js',
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
}));
