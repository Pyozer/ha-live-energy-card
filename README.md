# Live Energy Card

A Home Assistant Lovelace card that shows your home's energy flows **live**: solar, grid, battery,
home and individual devices. The design follows iOS app conventions: neutral surfaces, with system
colors reserved for icons and flows. Each flow's animation follows its power.

```
            Solar
   Grid              Home ──┬── Devices
           Battery          └── …
```

## Features

- **Animated flows** whose speed, thickness, particle density and glow depend on the power. Each
  of these four effects can be toggled separately (globally or per node).
- **Several entities per node**: inverters, grid phases or batteries added up.
- **Device groups** that expand with a tap.
- **Every source is optional**: without solar, battery or grid, the layout rearranges itself with
  no gaps.
- **Hide when zero**, configurable globally or per node, with a fade.
- **Devices in a column or a grid**: with many devices, the card switches to a grid fed by a bus.
  Each bus segment carries the sum of the devices downstream. On narrow screens, devices move
  below the diagram.
- **Line styles**: rounded corners, square corners, curves or direct lines, applied to every line
  of the card.
- **Live cost, solar savings and grid CO₂**.
- **Home ring**: share of solar, battery and grid in the consumption.
- **Battery ring**: state of charge.
- Automatic unit conversion (W, kW, MW), animated counters, tabular figures.
- `unavailable` / `unknown` entities are reported cleanly: never `NaN`.
- `tap_action`, `hold_action`, `double_tap_action` on every node (more-info by default).
- Automatic light and dark themes, `prefers-reduced-motion` support, animation paused off-screen,
  **eco mode** for low-power devices.
- **Import from the Energy dashboard**: solar, grid, battery and devices in one click.
- Full visual editor whose entity pickers only offer matching entities (power sensors for flows,
  percentages for the charge level) and that flags entities to check: not found (renamed or removed)
  or not matching their field (an energy counter in a power field…). English and French translations
  (following the Home Assistant user's language, or set per card).

## Installation

### Manual

1. Copy `dist/live-energy-card.js` to `/config/www/live-energy-card.js` (via the Samba add-on,
   File editor or SSH).
2. **Settings → Dashboards → ⋮ → Resources → Add resource**:
   - URL: `/local/live-energy-card.js?v=0.1.0`
   - Type: *JavaScript module*
3. Reload the page without cache (Ctrl/Cmd + Shift + R).
4. Add the card: **Edit dashboard → Add card → Live Energy Card**.

For each new version, copy the file again and increment `?v=` to bypass the browser and mobile app
caches.

### HACS (custom repository)

**HACS → ⋮ → Custom repositories**: add `https://github.com/Pyozer/ha-live-energy-card` with the
*Dashboard* type, then install **Live Energy Card**. HACS downloads `live-energy-card.js` from the
latest GitHub release and keeps it up to date.

## Configuration

### Import from the Energy dashboard

If the Home Assistant **Energy dashboard** is set up with power sensors (the "power" fields of
solar, grid, battery and individual devices), the card configures itself:

- when the card is added (**Add card → Live Energy Card**), the suggested configuration is
  imported from the Energy dashboard;
- in the visual editor, **Import from the Energy dashboard** adds the missing sources and devices
  to an existing card. Imported sources replace the configured entities but keep their name, icon
  and color; devices already in the card are kept, and get their energy counter if they lacked it.

The dashboard's energy counters are imported too (`energy_entity`), so solar, grid import and each
device show **today's energy** under their power.

Sources and devices without a power sensor are skipped (the dashboard's energy statistics in kWh
cannot show live flows). A device "included in" another listed device becomes a member of
that device's group. Without an Energy dashboard, the card guesses power sensors from
their names.

### Full example

```yaml
type: custom:live-energy-card
max_power: 4000
solar:
  entity: sensor.shelly_solaire_puissance
  secondary_entity: sensor.panneaux_solaires_energie_du_jour
grid:
  entity: sensor.shelly_pro_3em_energy_meter_1_puissance # positive = import
battery:
  entity: sensor.batterie_puissance # positive = discharge
  soc_entity: sensor.batterie_niveau
devices:
  - entity: sensor.shelly_pro_3em_energy_meter_3_puissance
    name: Water heater
    icon: mdi:water-boiler
  - entity: sensor.prise_frigo_power
    name: Fridge
    icon: mdi:fridge-outline
  - entity: sensor.prise_lave_linge_power
    name: Washing machine
    icon: mdi:washing-machine
```

### Without a battery

```yaml
type: custom:live-energy-card
solar:
  entity: sensor.shelly_solaire_puissance
grid:
  entity: sensor.shelly_pro_3em_energy_meter_1_puissance
devices:
  - entity: sensor.prise_frigo_power
```

### Without solar, with separate grid entities

```yaml
type: custom:live-energy-card
grid:
  import_entity: sensor.linky_import_power
  export_entity: sensor.linky_export_power
home:
  entity: sensor.home_consumption_power
```

### Device groups

A group is shown as a single device with the total power of its members. Tap it to expand it: the
group stays as a header and its members appear after it, each with its own flow. Tap again to
collapse it.

In the visual editor, **drag a device by its handle** (mouse, touch or pen) to reorder the list,
move it into a group (drop it on the group's header), take it out of a group or move it to another
one. A group can be reordered among the top-level devices, but not placed inside another group. With
the keyboard, focus the handle and use the up and down arrows.

```yaml
type: custom:live-energy-card
grid:
  entity: sensor.grid_power
devices:
  - entity: sensor.fridge_power
  - name: Kitchen
    icon: mdi:stove
    # Optional: a meter for the whole circuit. Without it, the members are added up.
    entity: sensor.kitchen_circuit_power
    expanded: false
    devices:
      - entity: sensor.oven_power
      - entity: sensor.hob_power
```

### Several inverters, three-phase grid, two batteries

A node is unavailable as soon as one of its entities is, so a partial total is never shown.

```yaml
type: custom:live-energy-card
solar:
  entity:
    - sensor.inverter_roof_power
    - sensor.inverter_garage_power
grid:
  entity:
    - sensor.grid_l1_power
    - sensor.grid_l2_power
    - sensor.grid_l3_power
battery:
  entity: [sensor.battery_1_power, sensor.battery_2_power]
  soc_entity: [sensor.battery_1_level, sensor.battery_2_level]
```

### Six devices in a grid, dimmed idle flows

```yaml
type: custom:live-energy-card
inactive_flows: dim
devices_layout: grid
devices_columns: 2
sort_devices: true
show_untracked: true
grid:
  entity: sensor.shelly_pro_3em_energy_meter_1_puissance
devices:
  - entity: sensor.prise_chaudiere_power
    name: Boiler
  - entity: sensor.prise_frigo_power
    name: Fridge
  - entity: sensor.prise_salon_power
    name: Living room TV
  - entity: sensor.prise_bureau_power
    name: Office
  - entity: sensor.vmc_power
    name: Ventilation
  - entity: sensor.box_internet_puissance
    name: Internet box
```

### General options

| Option | Default | Description |
| --- | --- | --- |
| `title` | — | Title shown at the top of the card. |
| `language` | `auto` | Language of the default labels: `auto` (language of the logged-in Home Assistant user), `en` or `fr`. |
| `min_power` / `max_power` | `0` / `5000` | Range (W) used to compute flow intensity. |
| `power_curve` | `sqrt` | `linear`, `sqrt` or `log`. `sqrt` and `log` make low power easier to read. |
| `threshold_w` | `5` | Below this threshold, a value is treated as zero. |
| `hide_when_zero` | `true` | Hides nodes at zero (solar, battery, devices). Grid and home stay visible unless set explicitly. |
| `line_style` | `rounded` | Shape of every flow line: `rounded` (right angles with rounded corners), `square` (sharp right angles), `curved` (soft curves) or `straight` (direct lines). |
| `inactive_flows` | `hide` | `hide`: zero flows are invisible. `dim`: dimmed grey path. |
| `animation` | see below | Intensity effects: `speed`, `thickness`, `density` (on), `glow` (off: soft light around particles, stronger as power increases). |
| `transparent` | `false` | Removes the card background, border and shadow, so the diagram sits directly on the dashboard (or inside a stack / grid card). Nodes keep their own fill and stay readable. |
| `eco_mode` | `false` | Lighter animation for wall tablets and low-power devices: 30 frames per second instead of the display rate, and no glow (its blur is the most expensive effect). Roughly halves the rendering work. |
| `devices_layout` | `auto` | `auto`, `column` or `grid`. |
| `devices_columns` | auto | Number of columns in grid mode. |
| `sort_devices` | `false` | Sorts devices by power (with hysteresis so the list does not keep moving). |
| `show_untracked` | `false` | Adds an "Other" node: home consumption not covered by the devices. |
| `show_ratios` | `false` | Shows self-consumption (share of solar used on site) and self-sufficiency (share of consumption covered without the grid). |
| `cost` | — | Prices for the live cost and solar savings (see [Cost and carbon](#cost-and-carbon)). |
| `carbon` | — | `intensity_entity`: grid carbon intensity for the live CO₂ (see [Cost and carbon](#cost-and-carbon)). |
| `kilo_threshold` | `1000` | Switch from W to kW. |
| `decimals` / `kilo_decimals` | `0` / `1` | Decimals in W and in kW. |

### Node options

Available for `solar`, `grid`, `battery`, `home` and each item of `devices`:

| Option | Description |
| --- | --- |
| `entity` | Power entity (W, kW…), or a list of entities whose values are added up (several inverters, grid phases, batteries, or a device made of several plugs). For `grid`: positive = import. For `battery`: positive = discharge. |
| `name`, `icon` | Label and icon. |
| `color` | HA color name (`amber`, `blue`…) or CSS color. |
| `invert` | Inverts the entity's sign. |
| `hide_when_zero` | Overrides the global option. |
| `energy_entity` | **Energy of the day.** Cumulative energy counter(s) in kWh, as used by the Energy dashboard (a list is added up). The card shows the change since midnight, read from the Home Assistant statistics (refreshed every 5 minutes), always in kWh. The counter does not need to reset daily. Shows `—` when a counter has no statistics. |
| `secondary_entity` | **Custom line.** Any entity (a daily `utility_meter`, a cost, a temperature…), shown as is with its own unit, live. It *replaces* the energy of the day: when both are set, `energy_entity` is ignored (the editor warns about it). |
| `animation` | Overrides the intensity effects for this node's flows. |
| `tap_action`, `hold_action`, `double_tap_action` | Standard Home Assistant actions. |

Specific options:

- `grid`: `import_entity` / `export_entity` (alternative to a signed entity; both report positive
  values), `export_energy_entity` (energy counter(s) in kWh of the energy sent to the grid, for the
  daily cost), `export_color`,
  `max_import` (import limit in W, e.g. the subscribed power: above it, the grid node turns red and
  shows *Over limit*). The grid node shows a signed value: positive when importing, **negative when
  exporting** (a signed entity keeps its sign, an export entity is shown as negative).
- `battery`: `charge_entity` / `discharge_entity`, `soc_entity` (charge level in %; a list is averaged), `charge_color`,
  `capacity` (usable capacity in kWh) and `min_soc` (reserve in %, default 0): with a charge level,
  the caption shows the time to full or down to the reserve at the current power (*Full in 2 h 05*),
  up to 48 h.
- `home`: `entity` is optional. Without it, consumption is computed from the sources.
- `devices` groups: `devices` (members, same options as a device), `expanded` (initially
  expanded), `entity` optional. A group's default tap action expands or collapses it.
- `devices`: `exclude_from_untracked: true` for a device that is not part of the home consumption
  (separate circuit, or a sub-meter of another device already listed). Its power is not
  subtracted when computing "Other".

### Cost and carbon

Live indicators shown under the diagram. `cost.period` picks how cost and savings are expressed:

- `hour` (default): a **rate per hour** (€/h) from the current flows.
  - **Cost**: grid import × import price − grid export × export price. When the export earns more
    than the import costs, it is shown as **Export earnings**.
  - **Solar savings**: solar consumed on site (home and battery charge) × import price.
- `day`: a **total for the day** (€), from today's energy counters (kWh), like the Energy dashboard.
  - **Cost today** = grid import × import price − grid export × export price.
  - **Solar savings today** = (solar production − energy sent to the grid) × import price.
  - Needs `energy_entity` on `solar` and on `grid` (the import), plus `grid.export_energy_entity`
    (the energy sent to the grid). The editor only shows the export field in this mode; the Energy
    dashboard import fills the three in. While a counter is missing, the indicator is hidden
    rather than wrong.
  - Today's energy is priced at the **current** price: with a tariff that changes during the day
    (peak / off-peak, dynamic prices), the total is an approximation. A *cost entity* (below) gives
    an exact total.
- **Grid CO₂**: grid import × carbon intensity of the grid (for example from the
  [Electricity Maps](https://www.home-assistant.io/integrations/co2signal/) integration), per hour.

```yaml
cost:
  period: day # hour (default): €/h from the current power; day: total of the day
  price_entity: sensor.electricity_price # or a fixed value: price: 0.2516
  export_price: 0.13 # or export_price_entity
  currency: EUR # optional: price entity unit (EUR/kWh), then the Home Assistant currency
carbon:
  intensity_entity: sensor.electricity_maps_co2_intensity # gCO2eq/kWh
```

Each price (import, export) comes from **one** source:

| Source | Import | Export | Value |
| --- | --- | --- | --- |
| Fixed value | `price` | `export_price` | A price per kWh. |
| Price entity | `price_entity` | `export_price_entity` | A price per kWh, read live (dynamic tariff). |
| Cost entity | `cost_entity` | `earnings_entity` | An amount **already computed**, shown as is. |

A *cost entity* is for people who already have the cost computed (dynamic tariffs, tariff
calculators…). Its unit is a currency: `€/h` with `period: hour`; a cost in `€` with `period: day`,
either cumulative (like the Energy dashboard's cost sensors: today's change is taken from the
statistics) or reset every day (without statistics, the state is used as is). No price is involved,
so **Solar savings** are not shown with a cost entity for the import (they need a price); a cost
entity can be mixed with a price on the other side.

If several sources are set in YAML, the strongest wins and the others are ignored (the editor flags
it): cost entity, then price entity, then fixed value. In the visual editor, pick the source
(*None*, *Fixed value*, *Price entity* or *Cost entity*) and only the matching field is shown;
switching source drops the other fields.

Prices are per kWh; price entities in €/MWh or €/Wh are converted. Without an export price (*None*), the
exported energy is not counted. The Energy dashboard import fills in the prices when the grid has
a single tariff.

### Language

Default labels (Solar, Grid, Battery, Home, states, ratios) follow the language of the logged-in
Home Assistant user. Set `language: en` or `language: fr` to force a language for a card. A node's
`name` option always takes precedence over the translated label. Numbers keep the Home Assistant
number format.

### Colors

Default colors are the iOS system colors, with their dark variants. Themes can override them with
the `--lec-solar`, `--lec-grid`, `--lec-export`, `--lec-battery`, `--lec-home`, `--lec-device` and `--lec-alert`
variables.

## Flow computation

Signed powers are first split into positive components (import / export, charge / discharge). If
both directions are measured at the same time, only the net value is kept. Home consumption is
either measured (`home.entity`) or computed:

```
home = solar + import + discharge − export − charge
```

Allocation then follows fixed priorities:

1. **Solar** → home, then battery (if charging), then grid (surplus).
2. **Battery** (if discharging) → home, then grid.
3. **Grid** → remaining home demand, then battery charge.

In grid mode, each bus segment carries the sum of the devices downstream.
"Other" equals `home − Σ devices` (devices with `exclude_from_untracked` left out), never negative.

## Development

```bash
npm install
npm run dev        # demo page at http://localhost:5173/demo/
npm test           # unit tests (Vitest)
npm run coverage   # tests with coverage thresholds
npm run lint
npm run build      # produces dist/live-energy-card.js
npm run check      # lint, formatting, tests with coverage and build (before every commit)
```

Contribution and commit rules are in [CONTRIBUTING.md](CONTRIBUTING.md). The project's technical
context (architecture, conventions, testing) is in [AGENTS.md](AGENTS.md).

The demo page works **without Home Assistant**. It simulates `hass` and provides:

- scenarios (night, surplus, solar water heater, peak, off-peak battery charge, battery → grid);
- a slider per source and per device, the grid being computed automatically from the balance;
- cost and CO₂ indicators;
- unavailable entity simulation and a random "live" simulation;
- light/dark modes, FR/EN and card width;
- a YAML configuration editor and a simulated Energy dashboard import.

Code changes are hot-reloaded.

The visual editor (`ha-form`) only works inside Home Assistant.
