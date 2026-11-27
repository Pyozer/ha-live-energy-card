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
    // Vite keeps the whitespace of an ES library (for the bundler of whoever imports it). This file
    // is what the browser loads, so it is minified in full.
    rolldownOptions: { output: { minify: mode !== 'development' } },
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
        statements: 82,
        branches: 74,
        functions: 76,
        lines: 82,
        'src/{actions,compute,config,cost,energy,entities,intensity,layout,source-units,tree,unit-layout,units}.ts':
          {
            lines: 98,
            functions: 95,
          },
        'src/model/**': { lines: 98, functions: 98 },
        'src/editor/{device-list,form,schema,summary,unit-list,validation}.ts': { lines: 99, functions: 95 },
      },
    },
  },
}));
