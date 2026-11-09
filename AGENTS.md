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
npm run build:demo    # the demo page as a static site in dist-demo/ (vite.demo.config.ts)
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
| `src/compute.ts` | Energy balance and flow allocation (solar → home → battery → grid…), ratios. `batterySolar`: the part of the battery charge known to come from solar (what a battery unit's `grid_charge_entity` does not account for), taken from the solar before the home. |
| `src/model/index.ts` | `buildModel`: readings → energy balance → nodes → flows. Re-exports the model API. |
| `src/model/context.ts` | Defaults (`DEFAULTS`), per-update context, flow intensity scale. Gauges: `readMaxPower` (a bubble's `max_power` / `max_power_entity`), `powerShare` (share of it reached, `undefined` without a maximum so no gauge, `null` when unavailable) and `shareStatus`, shared by the solar units, the grid (`max_import`) and the devices. |
| `src/model/sources.ts` | Source readings (signed entity or positive pair) and the solar, grid, battery and home nodes. A solar unit's maximum power (`max_power` in W, or `max_power_entity`, which wins while readable; the former `peak_power*` names are renamed in `validateConfig`) is what its ring fills up to: it gives the solar bubble a `powerRatio`; a single bubble needs the maximum of every unit (sum), a partial sum would mislead. |
| `src/source-units.ts` | The units of the solar and battery sources (`units`: an inverter, a battery pack…), those that read something, with their node id (`solar:0`, `battery:1`…: the position in the list). |
| `src/unit-layout.ts` | Pure geometry of the bubbles of a source shown one per unit: one row, or two staggered rows when they get too small (`planUnits`, `unitOffsets`). |
| `src/model/devices.ts` | Device nodes (with their `powerRatio`, drawn as a bar along the bottom of the pill), groups, the "untracked" node and device sorting (hysteresis). |
| `src/model/flows.ts` | Source and device flows, effects (`flowToggles`), distribution bus (`applyDeviceTree`). |
| `src/model/format.ts` | Node helpers: entity name cleanup, secondary value (`gridSecondary`: energy bought ↓ and sent back ↑ on the grid bubble), default actions, battery icon, `ringValue` (what fills the ring of a bubble: the charge of a battery, the share of its maximum power for solar, of its `max_import` for the grid). |
| `src/layout.ts` | Node positions for a given width and source flow paths (right angles with rounded corners, like the bus). Device modes: `column`, `grid`, `stack` (narrow screens, `Layout.narrow`). Two independent options: `compact` (`LayoutInput.compact`) tightens the spacing (row spacing, stack gaps; its paddings are in `styles.ts`, `ha-card.compact`), `small_bubbles` (`LayoutInput.smallBubbles`) caps the node size and shrinks the stacked pills. A source shown unit by unit gets a hub (a point) where its node would be, with its units in rows next to it, and `unitFlowPath` for the feeders. The feeders join the hub by a short vertical stub; the flows of the hub (`sourceFlowPath` given `layout.units`) start on, or end on, that stub through a curve (`hubJunction`), so no right angle is left at the hub. |
| `src/tree.ts` | Paths of the distribution bus feeding devices in grid / stack modes (and column mode with the `rounded` / `square` line styles). |
| `src/energy-today.ts` | Today's energy per node from the statistics (`recorder/statistic_during_period`), refreshed by the card every 5 minutes. |
| `src/battery.ts` | Battery time estimate (to full or to the reserve), the charge of several batteries seen as one (`combinePacks`) and duration formatting. `belowReserve`: a battery at or under its `min_soc` (`NodeModel.low`, its ring turns red). |
| `src/cost.ts` | Cost, solar savings and grid CO₂: live rate per hour from the flows, or total of the day (`cost.period: day`) from today's energy; price reading and formatting. Cost, earnings and savings can each be a ready-made entity (`cost_entity`, `earnings_entity`, `savings_entity`), independent of one another. `Stats.entities`: the entity behind each indicator (cost/earnings, savings, carbon), if any; `statActions` gives what a tap does: the `cost_actions` / `savings_actions` / `carbon.actions` of the config, else more-info of that entity, else nothing (the indicator is tappable only if it has an action). |
| `src/intensity.ts` | Power → visual parameters (speed, thickness, density, glow). |
| `src/animator.ts` | `requestAnimationFrame` loop: SVG particles, transitions, animated counters. |
| `src/live-energy-card.ts` | Lit element: Lovelace lifecycle, rendering, width measurement, registration. |
| `src/styles.ts` | Styles and palette (`--lec-*` variables, light / dark). |
| `src/actions.ts` | `tap_action`, `hold_action`, `double_tap_action` (`hass-action` event). |
| `src/editor/editor.ts` | Visual editor element: renders the forms and the device list (drag and drop on a handle, arrow keys as keyboard alternative), emits `config-changed`. |
| `src/editor/unit-editor.ts` | `live-energy-card-unit-editor`: the list of the units of the solar or battery source (cards opening on their own form, add, remove, reorder), fires `units-changed`. |
| `src/editor/drag-controller.ts` | `DragController`: the pointer-event drag and drop of a list (lifted block, gap, autoscroll), told what can land where by a `DragSpec`. Used by the device list and the unit lists. |
| `src/editor/schema.ts` | `ha-form` schemas (card, nodes, devices) and field labels. |
| `src/editor/form.ts` | Config ↔ form data. Only writes values that differ from the defaults. |
| `src/editor/validation.ts` | Entity checks shown by the editor: missing entities and entities of the wrong kind. |
| `src/editor/styles.ts` | Editor styles. |
| `src/editor/unit-list.ts` | Immutable operations on the units of a source (add, update, remove, reorder by keyboard or drop). |
| `src/editor/device-list.ts` | Immutable operations on the two-level device list (devices and group members), including `dropDevice` (drag and drop). |
| `src/editor/drag.ts` | Pure geometry of the device drag and drop: the drop target (before, after, into a group) for a pointer height. |
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
- **Solar and battery are lists of units; one format only.** What a unit *reads* (`entity`, `invert`,
  `energy_entity`, battery `soc_entity`…) is set on the unit. Its *bubble* (`name`, `icon`, `color`,
  `hide_when_zero`, `secondary_entity`, actions, `animation`) is set on the node for a single bubble
  that adds the units up, and on each unit when the node is `separate`: there is no inheritance
  between the two, and no `entity` on the node. The editor hides the fields that do not apply.
- **A source shown one bubble per unit is a hub plus units.** `computeFlows` always works on the
  totals, so the flows from the source to the home, grid and battery are the same in both displays:
  they start at the hub, which is a node (id `solar` / `battery`, `hub: true`) with a point-sized
  rect that is not drawn. Each unit has a feeder flow to the hub (`feeds`), excluded from the device
  bus. The total is the sum of the raw unit values (a threshold on each unit would lose
  micro-inverters), while a unit's own bubble and feeder show 0 below the threshold.
- **Unavailable units**: a single bubble is unavailable as soon as one unit is (a partial total
  would mislead); with a bubble per unit, the unavailable one counts as 0 and is flagged alone.
- **A hidden node has no layout position.** Any element attached to a node (caption, ring, badge)
  must disappear with the `.is-hidden` class, otherwise it is drawn at (0, 0).
- **Clean, iOS-like design**: neutral surfaces, system colors reserved for icons and flows, no neon
  effects. Colors go through the `--lec-*` CSS variables so themes can override them.
- **Backward-compatible configuration**: a renamed or removed option must still be accepted, or
  produce an explicit error in `validateConfig`.

## Testing

Every change or new feature must be **testable and tested**:

- Add or extend tests in `test/` (`*.test.ts`), one file per area: `compute`, `units-intensity`,
  `layout-model`, `model`, `config`, `battery`, `energy-today`, `colors-format`, `actions`, `localize`, `entities`, `energy`,
  `device-list`, `editor`, `cost`, `source-units`, `drag-controller`, `max-power`. Create a new file when a new module appears.
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
  a GitHub release with `live-energy-card.js` attached (what HACS installs). The release notes are
  built from the Conventional Commits since the previous tag (`scripts/release-notes.mjs`), so a
  commit pushed straight to `main` appears in them: write its type and summary for a user
  (`feat`, `fix`, `perf`, `refactor`, `docs`, `build`, `ci`; `chore`, `test` and `style` are left out).

## Continuous integration

- `.github/workflows/ci.yml` runs `npm run check` on every push to `main` and every pull request,
  and keeps the coverage report and the bundle as artifacts.
- `.github/workflows/release.yml`: see above.
- `.github/workflows/hacs.yml`: the HACS validation (`hacs/action`, category `plugin`) on every push,
  pull request and weekly. It needs a repository description, topics and a release.
- `.github/workflows/pages.yml`: builds the demo (`npm run build:demo`) and publishes it on GitHub
  Pages at every push to `main` (Settings → Pages → Source: GitHub Actions). The README links to it.
- `docs/` holds the README screenshots, taken from the demo page: refresh them when the look changes.
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
