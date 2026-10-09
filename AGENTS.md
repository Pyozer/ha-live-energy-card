# AGENTS.md

Context and guidelines for AI agents (and humans) working on this repository.
User documentation lives in [README.md](README.md), commit rules in [CONTRIBUTING.md](CONTRIBUTING.md).

## Project

**Live Energy Card** is a Lovelace custom card for Home Assistant. It shows live energy flows between
solar, grid, battery, home and individual devices, with animated flows whose intensity follows the
power.

- Strict TypeScript + [Lit 3](https://lit.dev), bundled by Vite into **a single ES module**:
  `dist/live-energy-card.js`. This is the file Home Assistant loads.
- Element `custom:live-energy-card` and visual editor `live-energy-card-editor` (built on `ha-form`).
- Runtime dependencies are limited to `lit` and `@mdi/js`. Do not add more without a real need:
  everything ends up in the bundle loaded by every HA client. `npm run size` enforces a gzip budget
  on it.
- **Everything is written in English**: documentation, code comments, test names and commits.
  Only the UI is translated (English and French, see `src/localize/`).

## Commands

```bash
npm install
npm run dev           # demo outside Home Assistant: http://localhost:5173/demo/
npm test              # unit tests (Vitest)
npm run coverage      # tests + coverage thresholds (report in coverage/index.html)
npm run lint          # ESLint
npm run format        # Prettier (src, demo, test)
npm run build         # type check + dist/live-energy-card.js
npm run size          # bundle size against its budget (scripts/check-size.mjs)
npm run check         # lint + format:check + coverage + build + size: run before every commit
```

## Architecture

Rendering is a chain of pure functions followed by an imperative animation engine:

```
hass + config ─► model/   ─► layout.ts ─► tree.ts ─► live-energy-card.ts ─► animator.ts
                 (compute)    (positions)  (bus)      (Lit render)         (rAF, direct DOM)
```

| File | Role |
| --- | --- |
| `src/types.ts` | Configuration types (`LiveEnergyCardConfig`, nodes, animation) and minimal HA types. |
| `src/config.ts` | `validateConfig` (coercion, readable errors) and watched entities. |
| `src/energy.ts` | Import from the Energy dashboard (`energy/get_prefs` → config), merge into an existing config, name-based fallback for the stub config. |
| `src/entities.ts` | Entity kinds (power, %, energy, price, CO2) used to filter the editor's entity pickers. |
| `src/units.ts` | Entity reading (W, kW, mW, MW…), unavailable states, localized formatting. |
| `src/compute.ts` | Energy balance and flow allocation (solar → home → battery → grid…), ratios. |
| `src/model/index.ts` | `buildModel`: readings → energy balance → nodes → flows. Re-exports the model API. |
| `src/model/context.ts` | Defaults (`DEFAULTS`), per-update context, flow intensity scale. |
| `src/model/sources.ts` | Source readings (signed entity or positive pair) and the solar, grid, battery and home nodes. |
| `src/model/devices.ts` | Device nodes, groups, the "untracked" node and device sorting (hysteresis). |
| `src/model/flows.ts` | Source and device flows, effects (`flowToggles`), distribution bus (`applyDeviceTree`). |
| `src/model/format.ts` | Node helpers: entity name cleanup, secondary value, default actions, battery icon. |
| `src/layout.ts` | Node positions for a given width and source flow paths (right angles with rounded corners, like the bus). Device modes: `column`, `grid`, `stack` (narrow screens). |
| `src/tree.ts` | Paths of the distribution bus feeding devices in grid / stack modes (and column mode with the `rounded` / `square` line styles). |
| `src/battery.ts` | Battery time estimate (to full or to the reserve) and duration formatting. |
| `src/cost.ts` | Live cost, solar savings and grid CO₂ from the flows, price reading and formatting. |
| `src/intensity.ts` | Power → visual parameters (speed, thickness, density, glow). |
| `src/animator.ts` | `requestAnimationFrame` loop: SVG particles, transitions, animated counters. |
| `src/live-energy-card.ts` | Lit element: Lovelace lifecycle, rendering, width measurement, registration. |
| `src/styles.ts` | Styles and palette (`--lec-*` variables, light / dark). |
| `src/actions.ts` | `tap_action`, `hold_action`, `double_tap_action` (`hass-action` event). |
| `src/editor/editor.ts` | Visual editor element: renders the forms and the device list, emits `config-changed`. |
| `src/editor/schema.ts` | `ha-form` schemas (card, nodes, devices) and field labels. |
| `src/editor/form.ts` | Config ↔ form data. Only writes values that differ from the defaults. |
| `src/editor/validation.ts` | Entity checks shown by the editor: missing entities and entities of the wrong kind. |
| `src/editor/styles.ts` | Editor styles. |
| `src/editor/device-list.ts` | Immutable operations on the two-level device list (devices and group members). |
| `src/localize/` | `en.ts` is the reference; `fr.ts` is typed against it (a missing key fails to compile). `resolveLanguage` picks the card `language` option, then the HA user language. |
| `demo/` | Demo page: simulated `hass`, scenarios, sliders, YAML editor. Stubs for `ha-card` and `ha-icon`. |
| `test/` | Vitest tests, running in Node (no DOM). |

Design rules:

- **Logic lives in pure modules.** Computation, layout and geometry never touch the DOM, which is
  what makes them testable. Keep `live-energy-card.ts` and `animator.ts` thin.
- **Animation bypasses Lit.** `animator.ts` writes SVG attributes and counters directly every frame.
  Lit only re-renders when the model changes (`shouldUpdate` reacts to watched entities only).
- **Cheap frames.** Most frames only move particles: the animator then writes just
  `stroke-dashoffset`. The other attributes are written when the flow's look changes. The glow
  path is `display="none"` unless visible, so its blur filter costs nothing when off.
- **Lit without decorators**: `static properties` + `declare` fields, with
  `useDefineForClassFields: false`. Do not initialize these fields at declaration.
- **A hidden node has no layout position.** Any element attached to a node (caption, ring, badge)
  must disappear with the `.is-hidden` class, otherwise it is drawn at (0, 0).
- **Clean, iOS-like design**: neutral surfaces, system colors reserved for icons and flows, no neon
  effects. Colors go through the `--lec-*` CSS variables so themes can override them.
- **Backward-compatible configuration**: a renamed or removed option must still be accepted, or
  produce an explicit error in `validateConfig`.

## Testing

Every change or new feature must be **testable and tested**:

- Add or extend tests in `test/` (`*.test.ts`), one file per area: `compute`, `units-intensity`,
  `layout-model`, `model`, `config`, `battery`, `colors-format`, `actions`, `localize`, `entities`, `energy`,
  `device-list`, `editor`, `cost`. Create a new file when a new module appears.
- Design for testing: extract logic into an exported pure function instead of leaving it in the
  component or the animator.
- A bug fix starts with a test that reproduces the bug.
- Coverage has floors (`vite.config.ts`): a global one, and a higher one for the pure modules. Raise
  them when coverage improves; never lower them to make a change pass. The DOM code
  (`live-energy-card.ts`, `animator.ts`, `editor.ts`) is not unit tested, which is one more reason to
  keep it thin.
- Key invariants have tests: energy conservation, no `NaN`, no overlapping nodes across several
  widths and device counts.
- For visual changes, check the demo (`npm run dev`). If a case cannot be reproduced there, add a
  scenario or an option to `demo/main.ts`.
- The editor's logic (schemas, config ↔ form conversion) is tested in `editor.test.ts`; every
  field must have a label in each language. Its rendering can only be checked inside Home
  Assistant: say so when you change it.

## Documentation

Every code change comes with the matching documentation update, in the same commit or series:

- `README.md`: options (tables), YAML examples, user-visible behavior.
- `AGENTS.md`: architecture, commands, conventions, known pitfalls.
- `src/localize/en.ts` and `fr.ts`: every new label, in both languages. To add a language, create
  `src/localize/xx.ts` typed against `en`, register it in `LANGUAGES` and `LANGUAGE_NAMES`
  (`localize.ts`), and list it in the README.
- `demo/main.ts`: a way to try the change outside Home Assistant.

## Versioning and release

- The version comes from `package.json` (injected through `__VERSION__` and logged in the console
  as `LIVE-ENERGY-CARD x.y.z`). Bump it on every delivery (SemVer).
- Manual install: copy `dist/live-energy-card.js` to `/config/www/` and change the `?v=` parameter of
  the Lovelace resource to bust the cache.
- `dist/` is not versioned.
- Release: bump `package.json`, commit `chore: release x.y.z`, then push a `vx.y.z` tag. The
  `Release` workflow checks that the tag matches `package.json`, runs `npm run check` and publishes
  a GitHub release with `live-energy-card.js` attached (what HACS installs).

## Continuous integration

- `.github/workflows/ci.yml` runs `npm run check` on every push to `main` and every pull request,
  and keeps the coverage report and the bundle as artifacts.
- `.github/workflows/release.yml`: see above.
- Dependabot opens monthly update PRs for npm (dev dependencies grouped) and the GitHub actions.
- The Node version is pinned in `.nvmrc`, shared by CI and local development.

## Commits

Conventional Commits, in English, concise, no `Co-authored-by`. Details in
[CONTRIBUTING.md](CONTRIBUTING.md). Run `npm run check` before committing.

## Known pitfalls

- `MW` (megawatt) and `mW` (milliwatt) only differ by case: never lowercase units before lookup.
- SVG filters: use `filterUnits="userSpaceOnUse"`, otherwise a perfectly horizontal path (zero-height
  bounding box) disappears.
- Available width: measure `.stage` (no padding), not `.content`.
- Device groups: an expanded group's flow carries 0 W (its members carry the power), so the bus
  sums flows, not node values.
- Editor: an option whose default is `false` (e.g. `animation.glow`) must be written when it is
  `true`. Compare with the default value, not with `false`.
