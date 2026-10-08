# AGENTS.md

Context and guidelines for AI agents (and humans) working on this repository.
User documentation lives in [README.md](README.md), commit rules in [CONTRIBUTING.md](CONTRIBUTING.md).

## Project

**PowerFlow Card** is a Lovelace custom card for Home Assistant. It shows live energy flows between
solar, grid, battery, home and individual devices, with animated flows whose intensity follows the
power.

- Strict TypeScript + [Lit 3](https://lit.dev), bundled by Vite into **a single ES module**:
  `dist/powerflow-card.js`. This is the file Home Assistant loads.
- Element `custom:powerflow-card` and visual editor `powerflow-card-editor` (built on `ha-form`).
- Runtime dependencies are limited to `lit` and `@mdi/js`. Do not add more without a real need:
  everything ends up in the bundle loaded by every HA client.
- **Everything is written in English**: documentation, code comments, test names and commits.
  Only the UI is translated (English and French, see `src/localize/`).

## Commands

```bash
npm install
npm run dev           # demo outside Home Assistant: http://localhost:5173/demo/
npm test              # unit tests (Vitest)
npm run lint          # ESLint
npm run format        # Prettier (src, demo, test)
npm run build         # type check + dist/powerflow-card.js
npm run check         # lint + format:check + tests + build: run before every commit
```

## Architecture

Rendering is a chain of pure functions followed by an imperative animation engine:

```
hass + config ─► model.ts ─► layout.ts ─► tree.ts ─► powerflow-card.ts ─► animator.ts
                 (compute)    (positions)  (bus)      (Lit render)         (rAF, direct DOM)
```

| File | Role |
| --- | --- |
| `src/types.ts` | Configuration types (`PowerFlowCardConfig`, nodes, animation) and minimal HA types. |
| `src/config.ts` | `validateConfig` (coercion, readable errors) and watched entities. |
| `src/units.ts` | Entity reading (W, kW, mW, MW…), unavailable states, localized formatting. |
| `src/compute.ts` | Energy balance and flow allocation (solar → home → battery → grid…), ratios. |
| `src/model.ts` | Builds displayable nodes and flows (`buildModel`), defaults (`DEFAULTS`), device sorting, "untracked" node. |
| `src/layout.ts` | Node positions for a given width. Device modes: `column`, `grid`, `stack` (narrow screens). |
| `src/tree.ts` | Paths of the distribution bus feeding devices in grid / stack modes. |
| `src/intensity.ts` | Power → visual parameters (speed, thickness, density, glow). |
| `src/animator.ts` | `requestAnimationFrame` loop: SVG particles, transitions, animated counters. |
| `src/powerflow-card.ts` | Lit element: Lovelace lifecycle, rendering, width measurement, registration. |
| `src/styles.ts` | Styles and palette (`--pf-*` variables, light / dark). |
| `src/actions.ts` | `tap_action`, `hold_action`, `double_tap_action` (`hass-action` event). |
| `src/editor/editor.ts` | Visual editor. Only writes values that differ from the defaults. |
| `src/localize/` | `en.ts` is the reference; `fr.ts` is typed against it (a missing key fails to compile). |
| `demo/` | Demo page: simulated `hass`, scenarios, sliders, YAML editor. Stubs for `ha-card` and `ha-icon`. |
| `test/` | Vitest tests, running in Node (no DOM). |

Design rules:

- **Logic lives in pure modules.** Computation, layout and geometry never touch the DOM, which is
  what makes them testable. Keep `powerflow-card.ts` and `animator.ts` thin.
- **Animation bypasses Lit.** `animator.ts` writes SVG attributes and counters directly every frame.
  Lit only re-renders when the model changes (`shouldUpdate` reacts to watched entities only).
- **Lit without decorators**: `static properties` + `declare` fields, with
  `useDefineForClassFields: false`. Do not initialize these fields at declaration.
- **A hidden node has no layout position.** Any element attached to a node (caption, ring, badge)
  must disappear with the `.is-hidden` class, otherwise it is drawn at (0, 0).
- **Clean, iOS-like design**: neutral surfaces, system colors reserved for icons and flows, no neon
  effects. Colors go through the `--pf-*` CSS variables so themes can override them.
- **Backward-compatible configuration**: a renamed or removed option must still be accepted, or
  produce an explicit error in `validateConfig`.

## Testing

Every change or new feature must be **testable and tested**:

- Add or extend tests in `test/` (`*.test.ts`), one file per area: `compute`, `units-intensity`,
  `layout-model`. Create a new file when a new module appears.
- Design for testing: extract logic into an exported pure function instead of leaving it in the
  component or the animator.
- A bug fix starts with a test that reproduces the bug.
- Key invariants have tests: energy conservation, no `NaN`, no overlapping nodes across several
  widths and device counts.
- For visual changes, check the demo (`npm run dev`). If a case cannot be reproduced there, add a
  scenario or an option to `demo/main.ts`.
- The visual editor can only be tested inside Home Assistant: say so when you change it.

## Documentation

Every code change comes with the matching documentation update, in the same commit or series:

- `README.md`: options (tables), YAML examples, user-visible behavior.
- `AGENTS.md`: architecture, commands, conventions, known pitfalls.
- `src/localize/en.ts` and `fr.ts`: every new label, in both languages.
- `demo/main.ts`: a way to try the change outside Home Assistant.

## Versioning and release

- The version comes from `package.json` (injected through `__VERSION__` and logged in the console
  as `POWERFLOW-CARD x.y.z`). Bump it on every delivery (SemVer).
- Manual install: copy `dist/powerflow-card.js` to `/config/www/` and change the `?v=` parameter of
  the Lovelace resource to bust the cache.
- `dist/` is not versioned.

## Commits

Conventional Commits, in English, concise, no `Co-authored-by`. Details in
[CONTRIBUTING.md](CONTRIBUTING.md). Run `npm run check` before committing.

## Known pitfalls

- `MW` (megawatt) and `mW` (milliwatt) only differ by case: never lowercase units before lookup.
- SVG filters: use `filterUnits="userSpaceOnUse"`, otherwise a perfectly horizontal path (zero-height
  bounding box) disappears.
- Available width: measure `.stage` (no padding), not `.content`.
- Editor: an option whose default is `false` (e.g. `animation.glow`) must be written when it is
  `true`. Compare with the default value, not with `false`.
