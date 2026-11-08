import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

// The demo page as a static site (published on GitHub Pages): `npm run build:demo`.
// Relative paths, so it works under any sub-path (https://<user>.github.io/<repo>/).
export default defineConfig({
  root: 'demo',
  base: './',
  define: {
    __VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: '../dist-demo',
    emptyOutDir: true,
  },
});
