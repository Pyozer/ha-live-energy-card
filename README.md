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
- **Every source is optional**: without solar, battery or grid, the layout rearranges itself with
  no gaps.
- **Hide when zero**, configurable globally or per node, with a fade.
- **Devices in a column or a grid**: with many devices, the card switches to a grid fed by a bus.
  Each bus segment carries the sum of the devices downstream. On narrow screens, devices move
  below the diagram.
- **Line styles**: rounded corners, square corners, curves or direct lines, applied to every line
  of the card.
- **Home ring**: share of solar, battery and grid in the consumption.
- **Battery ring**: state of charge.
- Automatic unit conversion (W, kW, MW), animated counters, tabular figures.
- `unavailable` / `unknown` entities are reported cleanly: never `NaN`.
- `tap_action`, `hold_action`, `double_tap_action` on every node (more-info by default).
- Automatic light and dark themes, `prefers-reduced-motion` support, animation paused off-screen.
- **Import from the Energy dashboard**: solar, grid, battery and devices in one click.
- Full visual editor whose entity pickers only offer matching entities (power sensors for flows,
  percentages for the charge level), English and French translations (following the Home Assistant user's
  language, or set per card).

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

Once the project is on GitHub: **HACS → ⋮ → Custom repositories**, type *Dashboard*.
The `hacs.json` file is provided.

## Configuration

### Import from the Energy dashboard

If the Home Assistant **Energy dashboard** is set up with power sensors (the "power" fields of
solar, grid, battery and individual devices), the card configures itself:

- when the card is added (**Add card → Live Energy Card**), the suggested configuration is
  imported from the Energy dashboard;
- in the visual editor, **Import from the Energy dashboard** adds the missing sources and devices
  to an existing card. Imported sources replace the configured entities but keep their name, icon
  and color; devices already in the card are kept.

Sources and devices without a power sensor are skipped (the dashboard's energy statistics in kWh
cannot show live flows). A device "included in" another listed device is imported with
`exclude_from_untracked: true`. Without an Energy dashboard, the card guesses power sensors from
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
| `devices_layout` | `auto` | `auto`, `column` or `grid`. |
| `devices_columns` | auto | Number of columns in grid mode. |
| `sort_devices` | `false` | Sorts devices by power (with hysteresis so the list does not keep moving). |
| `show_untracked` | `false` | Adds an "Other" node: home consumption not covered by the devices. |
| `show_ratios` | `false` | Shows self-consumption (share of solar used on site) and self-sufficiency (share of consumption covered without the grid). |
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
| `secondary_entity` | Secondary value shown in the node (e.g. today's energy). |
| `animation` | Overrides the intensity effects for this node's flows. |
| `tap_action`, `hold_action`, `double_tap_action` | Standard Home Assistant actions. |

Specific options:

- `grid`: `import_entity` / `export_entity` (alternative to a signed entity), `export_color`.
- `battery`: `charge_entity` / `discharge_entity`, `soc_entity` (charge level in %; a list is averaged), `charge_color`.
- `home`: `entity` is optional. Without it, consumption is computed from the sources.
- `devices`: `exclude_from_untracked: true` for a device that is not part of the home consumption
  (separate circuit, or a sub-meter of another device already listed). Its power is not
  subtracted when computing "Other".

### Language

Default labels (Solar, Grid, Battery, Home, states, ratios) follow the language of the logged-in
Home Assistant user. Set `language: en` or `language: fr` to force a language for a card. A node's
`name` option always takes precedence over the translated label. Numbers keep the Home Assistant
number format.

### Colors

Default colors are the iOS system colors, with their dark variants. Themes can override them with
the `--lec-solar`, `--lec-grid`, `--lec-export`, `--lec-battery`, `--lec-home` and `--lec-device`
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
npm run lint
npm run build      # produces dist/live-energy-card.js
npm run check      # lint, formatting, tests and build (before every commit)
```

Contribution and commit rules are in [CONTRIBUTING.md](CONTRIBUTING.md). The project's technical
context (architecture, conventions, testing) is in [AGENTS.md](AGENTS.md).

The demo page works **without Home Assistant**. It simulates `hass` and provides:

- scenarios (night, surplus, solar water heater, peak, off-peak battery charge, battery → grid);
- a slider per source and per device, the grid being computed automatically from the balance;
- unavailable entity simulation and a random "live" simulation;
- light/dark modes, FR/EN and card width;
- a YAML configuration editor and a simulated Energy dashboard import.

Code changes are hot-reloaded.

The visual editor (`ha-form`) only works inside Home Assistant.
