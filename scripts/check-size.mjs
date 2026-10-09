// Fails when the bundle loaded by every Home Assistant client grows beyond its budget.
// Raise the budget only for a deliberate addition, in the same commit.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const BUDGETS = [{ file: 'dist/live-energy-card.js', maxGzipKb: 48 }];

let failed = false;
for (const { file, maxGzipKb } of BUDGETS) {
  const raw = readFileSync(file);
  const gzipKb = gzipSync(raw, { level: 9 }).length / 1024;
  const ok = gzipKb <= maxGzipKb;
  failed ||= !ok;
  console.log(
    `${ok ? '✓' : '✗'} ${file}: ${(raw.length / 1024).toFixed(1)} KiB, ` +
      `${gzipKb.toFixed(1)} KiB gzip (budget ${maxGzipKb} KiB)`,
  );
}
if (failed) {
  console.error('Bundle over budget: trim it, or raise the budget in scripts/check-size.mjs on purpose.');
  process.exit(1);
}
