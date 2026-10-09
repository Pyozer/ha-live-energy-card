/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

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
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text-summary', 'html'],
      // Floors just under the current values, so coverage cannot silently drop. The pure modules
      // (computation, layout, model, editor logic) are held to a higher bar than the DOM code.
      thresholds: {
        statements: 65,
        branches: 58,
        functions: 65,
        lines: 66,
        'src/{compute,config,cost,energy,entities,intensity,layout,units}.ts': { lines: 85, functions: 95 },
        'src/model/**': { lines: 90, functions: 90 },
        'src/editor/{device-list,form,schema,validation}.ts': { lines: 90, functions: 95 },
      },
    },
  },
}));
