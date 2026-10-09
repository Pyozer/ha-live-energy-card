import './stubs';
import type { EnergyPrefs } from '../src/energy';
import { DEFAULT_TOGGLES } from '../src/intensity';
import { LiveEnergyCard } from '../src/live-energy-card';
import { parse, stringify } from 'yaml';
import type { HassEntity, HomeAssistant, LiveEnergyCardConfig } from '../src/types';

interface CardElement extends HTMLElement {
  hass?: HomeAssistant;
  setConfig(config: LiveEnergyCardConfig): void;
}

const ENT = {
  solar: 'sensor.shelly_solaire_puissance',
  solarDay: 'sensor.panneaux_solaires_energie_du_jour',
  grid: 'sensor.shelly_pro_3em_energy_meter_1_puissance',
  battery: 'sensor.batterie_puissance',
  soc: 'sensor.batterie_niveau',
  price: 'sensor.electricity_price',
  co2: 'sensor.co2_intensity',
};

// Devices from the "Foyer" dashboard, with typical consumption when running.
const DEVICES = [
  { entity: 'sensor.prise_chaudiere_power', name: 'Boiler', icon: 'mdi:radiator', typical: 90 },
  {
    entity: 'sensor.shelly_pro_3em_energy_meter_3_puissance',
    name: 'Water heater',
    icon: 'mdi:water-boiler',
    typical: 2000,
  },
  { entity: 'sensor.prise_frigo_power', name: 'Fridge', icon: 'mdi:fridge-outline', typical: 85 },
  { entity: 'sensor.prise_salon_power', name: 'Living room TV', icon: 'mdi:television', typical: 140 },
  { entity: 'sensor.prise_bureau_power', name: 'Office', icon: 'mdi:desk', typical: 120 },
  {
    entity: 'sensor.prise_mini_pc_consommation_actuelle',
    name: 'Mini PC',
    icon: 'mdi:desktop-tower',
    typical: 18,
  },
  {
    entity: 'sensor.prise_lave_linge_power',
    name: 'Washing machine',
    icon: 'mdi:washing-machine',
    typical: 1800,
  },
  { entity: 'sensor.prise_chambre_rue_power', name: 'Bedroom', icon: 'mdi:bed-outline', typical: 40 },
  { entity: 'sensor.prise_autre_power', name: 'Floor lamp', icon: 'mdi:floor-lamp-outline', typical: 12 },
  { entity: 'sensor.0xa4c1380132bd1522_power', name: 'Nomad', icon: 'mdi:power-socket-eu', typical: 22 },
  { entity: 'sensor.vmc_power', name: 'Ventilation', icon: 'mdi:fan', typical: 45 },
  { entity: 'sensor.mini_pc_media_power', name: 'Media server', icon: 'mdi:server', typical: 7 },
  { entity: 'sensor.box_internet_puissance', name: 'Internet box', icon: 'mdi:router-wireless', typical: 16 },
];

// Simulated Energy dashboard (`energy/get_prefs`): power sensors for solar, grid and some devices.
const ENERGY_PREFS: EnergyPrefs = {
  energy_sources: [
    { type: 'solar', stat_energy_from: ENT.solarDay, stat_rate: ENT.solar },
    { type: 'grid', stat_energy_from: 'sensor.grid_energy', power_config: { stat_rate: ENT.grid } },
    { type: 'battery', stat_energy_from: 'sensor.battery_out', stat_rate: ENT.battery, stat_soc: ENT.soc },
  ],
  device_consumption: DEVICES.slice(0, 8).map((d) => ({
    stat_consumption: `${d.entity}_energy`,
    stat_rate: d.entity,
    name: d.name,
  })),
};

/** Simulated statistics (`recorder/statistic_during_period`): today's energy in kWh. */
const TODAY_KWH: Record<string, number> = {
  'sensor.grid_energy': 6.42,
  ...Object.fromEntries(DEVICES.map((d) => [`${d.entity}_energy`, (d.typical * 9) / 1000])),
};

/** Mini PC, media server and internet box, shown as a group. */
const IT_GROUP = [5, 11, 12];

const DEFAULT_CONFIG: LiveEnergyCardConfig = {
  type: 'custom:live-energy-card',
  max_power: 4000,
  solar: { entity: ENT.solar, secondary_entity: ENT.solarDay },
  grid: { entity: ENT.grid, energy_entity: 'sensor.grid_energy' },
  battery: { entity: ENT.battery, soc_entity: ENT.soc, capacity: 10, min_soc: 10 },
  devices: [
    ...DEVICES.filter((_, i) => !IT_GROUP.includes(i)).map(({ entity, name, icon }) => ({
      entity,
      name,
      icon,
      energy_entity: `${entity}_energy`,
    })),
    // Device group: tap it to show its members.
    {
      name: 'Network & IT',
      icon: 'mdi:lan',
      devices: IT_GROUP.map((i) => DEVICES[i]).map(({ entity, name, icon }) => ({ entity, name, icon })),
    },
  ],
};

const state = {
  solar: 2400,
  battery: -600,
  soc: 64,
  baseLoad: 140,
  devices: Object.fromEntries(DEVICES.map((d) => [d.entity, 0])) as Record<string, number>,
  autoGrid: true,
  grid: 0,
  unavailable: new Set<string>(),
  dark: matchMedia('(prefers-color-scheme: dark)').matches,
  lang: 'en',
  width: 860,
  live: false,
};

let config: LiveEnergyCardConfig = structuredClone(DEFAULT_CONFIG);
const card = document.createElement('live-energy-card') as CardElement;
const frame = document.getElementById('frame')!;
frame.appendChild(card);

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// --- Simulation ---------------------------------------------------------------------------------

function homeLoad(): number {
  return state.baseLoad + Object.values(state.devices).reduce((a, b) => a + b, 0);
}

function computedGrid(): number {
  // Balance: home = solar + grid + battery (positive = discharge).
  return Math.round(homeLoad() - state.solar - state.battery);
}

function entity(id: string, value: number | string, unit = 'W', name?: string): HassEntity {
  return {
    entity_id: id,
    state: state.unavailable.has(id) ? 'unavailable' : String(value),
    attributes: { unit_of_measurement: unit, friendly_name: name ?? id },
  };
}

let previous: Record<string, HassEntity> = {};

function buildHass(): HomeAssistant {
  const grid = state.autoGrid ? computedGrid() : state.grid;
  const fresh: Record<string, HassEntity> = {
    [ENT.solar]: entity(ENT.solar, state.solar, 'W', 'Solar power'),
    [ENT.solarDay]: entity(ENT.solarDay, (8.4).toFixed(2), 'kWh', 'Solar energy today'),
    [ENT.grid]: entity(ENT.grid, grid, 'W', 'Grid power'),
    [ENT.battery]: entity(ENT.battery, state.battery, 'W', 'Battery power'),
    [ENT.soc]: entity(ENT.soc, state.soc, '%', 'Battery level'),
    [ENT.price]: entity(ENT.price, 0.2516, 'EUR/kWh', 'Electricity price'),
    [ENT.co2]: entity(ENT.co2, 56, 'gCO2eq/kWh', 'Grid CO2 intensity'),
  };
  for (const d of DEVICES)
    fresh[d.entity] = entity(d.entity, state.devices[d.entity], 'W', `${d.name} Power`);

  // Like Home Assistant: a new object only for entities that changed.
  const states: Record<string, HassEntity> = {};
  for (const [id, st] of Object.entries(fresh)) {
    const old = previous[id];
    states[id] = old && old.state === st.state ? old : st;
  }
  previous = states;
  return {
    states,
    language: state.lang,
    locale: { language: state.lang, number_format: 'language' },
    themes: { darkMode: state.dark },
    config: { currency: 'EUR' },
    callWS: <T>(msg: Record<string, unknown>) => {
      if (msg.type === 'energy/get_prefs') return Promise.resolve(ENERGY_PREFS as T);
      if (msg.type === 'recorder/statistic_during_period') {
        const change = TODAY_KWH[String(msg.statistic_id)];
        return change === undefined
          ? Promise.reject(new Error('No statistics'))
          : Promise.resolve({ change } as T);
      }
      return Promise.reject(new Error(`Unknown command ${String(msg.type)}`));
    },
  };
}

function push(): void {
  card.hass = buildHass();
  const grid = state.autoGrid ? computedGrid() : state.grid;
  const gridOut = document.getElementById('out-grid');
  if (gridOut) gridOut.textContent = `${grid} W`;
  const gridInput = document.getElementById('in-grid') as HTMLInputElement | null;
  if (gridInput && state.autoGrid) gridInput.value = String(grid);
}

function applyConfig(next: LiveEnergyCardConfig): void {
  try {
    card.setConfig(next);
    config = next;
    $('error').textContent = '';
    $<HTMLTextAreaElement>('yaml').value = stringify(config);
    push();
  } catch (err) {
    $('error').textContent = (err as Error).message;
  }
}

// --- Controls ------------------------------------------------------------------------------------

function slider(
  parent: HTMLElement,
  id: string,
  label: string,
  min: number,
  max: number,
  step: number,
  get: () => number,
  set: (v: number) => void,
  unit = 'W',
): void {
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = `<label for="in-${id}" title="${label}">${label}</label>
    <input id="in-${id}" type="range" min="${min}" max="${max}" step="${step}" value="${get()}">
    <output id="out-${id}">${get()} ${unit}</output>`;
  const input = row.querySelector('input')!;
  const out = row.querySelector('output')!;
  input.addEventListener('input', () => {
    set(Number(input.value));
    out.textContent = `${input.value} ${unit}`;
    push();
  });
  parent.appendChild(row);
}

function refreshSliders(): void {
  const set = (id: string, v: number, unit = 'W') => {
    const input = document.getElementById(`in-${id}`) as HTMLInputElement | null;
    const out = document.getElementById(`out-${id}`);
    if (input) input.value = String(v);
    if (out) out.textContent = `${Math.round(v)} ${unit}`;
  };
  set('solar', state.solar);
  set('battery', state.battery);
  set('soc', state.soc, '%');
  set('base', state.baseLoad);
  DEVICES.forEach((d, i) => set(`dev${i}`, state.devices[d.entity]));
}

const sources = $('sources');
slider(
  sources,
  'solar',
  'Solar',
  0,
  6000,
  10,
  () => state.solar,
  (v) => (state.solar = v),
);
slider(
  sources,
  'battery',
  'Battery (+ discharge)',
  -4000,
  4000,
  10,
  () => state.battery,
  (v) => (state.battery = v),
);
slider(
  sources,
  'soc',
  'Battery level',
  0,
  100,
  1,
  () => state.soc,
  (v) => (state.soc = v),
  '%',
);
slider(
  sources,
  'base',
  'Untracked base load',
  0,
  1500,
  10,
  () => state.baseLoad,
  (v) => (state.baseLoad = v),
);
slider(
  sources,
  'grid',
  'Grid (+ import)',
  -6000,
  6000,
  10,
  () => computedGrid(),
  (v) => {
    state.autoGrid = false;
    state.grid = v;
    (document.getElementById('auto-grid') as HTMLInputElement).checked = false;
  },
);

const devices = $('devices');
DEVICES.forEach((d, i) =>
  slider(
    devices,
    `dev${i}`,
    d.name,
    0,
    Math.max(500, d.typical * 1.6),
    1,
    () => state.devices[d.entity],
    (v) => {
      state.devices[d.entity] = v;
    },
  ),
);

const unavailable = $('unavailable');
for (const [label, id] of [
  ['Solar', ENT.solar],
  ['Grid', ENT.grid],
  ['Battery', ENT.battery],
  ['Fridge', DEVICES[2].entity],
]) {
  const chip = document.createElement('label');
  chip.className = 'chip';
  chip.innerHTML = `<input type="checkbox"> ${label}`;
  chip.querySelector('input')!.addEventListener('change', (e) => {
    if ((e.target as HTMLInputElement).checked) state.unavailable.add(id);
    else state.unavailable.delete(id);
    push();
  });
  unavailable.appendChild(chip);
}

// Quick display options (they edit the YAML config).
const display = $('display');
function toggle(label: string, checked: () => boolean, onChange: (v: boolean) => void, id?: string): void {
  const chip = document.createElement('label');
  chip.className = 'chip';
  chip.innerHTML = `<input type="checkbox" ${id ? `id="${id}"` : ''}> ${label}`;
  const input = chip.querySelector('input')!;
  input.checked = checked();
  input.addEventListener('change', () => onChange(input.checked));
  display.appendChild(chip);
}
const withConfig = (mutate: (c: LiveEnergyCardConfig) => void) => {
  const next = structuredClone(config);
  mutate(next);
  applyConfig(next);
};
toggle(
  'Dark mode',
  () => state.dark,
  (v) => {
    state.dark = v;
    document.documentElement.dataset.theme = v ? 'dark' : 'light';
    push();
  },
);
toggle(
  'HA in French',
  () => state.lang === 'fr',
  (v) => {
    state.lang = v ? 'fr' : 'en';
    push();
  },
);
toggle(
  'Computed grid',
  () => state.autoGrid,
  (v) => {
    state.autoGrid = v;
    push();
  },
  'auto-grid',
);
toggle(
  'Live simulation',
  () => state.live,
  (v) => (state.live = v),
);
for (const [key, label] of [
  ['speed', 'Speed'],
  ['thickness', 'Thickness'],
  ['density', 'Density'],
  ['glow', 'Glow'],
] as const) {
  toggle(
    label,
    () => config.animation?.[key] ?? DEFAULT_TOGGLES[key],
    (v) =>
      withConfig((c) => {
        c.animation = { ...(c.animation ?? {}), [key]: v };
      }),
  );
}
toggle(
  'Hide when zero',
  () => config.hide_when_zero !== false,
  (v) => withConfig((c) => (c.hide_when_zero = v)),
);
toggle(
  'Dim idle flows',
  () => config.inactive_flows === 'dim',
  (v) => withConfig((c) => (c.inactive_flows = v ? 'dim' : 'hide')),
);
toggle(
  'Sort by power',
  () => !!config.sort_devices,
  (v) => withConfig((c) => (c.sort_devices = v)),
);
toggle(
  'Untracked',
  () => !!config.show_untracked,
  (v) => withConfig((c) => (c.show_untracked = v)),
);
toggle(
  'Ratios',
  () => !!config.show_ratios,
  (v) => withConfig((c) => (c.show_ratios = v)),
);
toggle(
  'Import alert (3 kW)',
  () => !!config.grid?.max_import,
  (v) =>
    withConfig((c) => {
      c.grid = { ...c.grid };
      if (v) c.grid.max_import = 3000;
      else delete c.grid.max_import;
    }),
);
toggle(
  'Transparent',
  () => !!config.transparent,
  (v) => withConfig((c) => (v ? (c.transparent = true) : delete c.transparent)),
);
toggle(
  'Eco mode',
  () => !!config.eco_mode,
  (v) => withConfig((c) => (v ? (c.eco_mode = true) : delete c.eco_mode)),
);
toggle(
  'Cost & CO₂',
  () => !!config.cost,
  (v) =>
    withConfig((c) => {
      if (v) {
        c.cost = { price_entity: ENT.price, export_price: 0.13 };
        c.carbon = { intensity_entity: ENT.co2 };
      } else {
        delete c.cost;
        delete c.carbon;
      }
    }),
);
toggle(
  'Title',
  () => !!config.title,
  (v) => withConfig((c) => (v ? (c.title = 'Live energy') : delete c.title)),
);

const layoutSelect = document.createElement('label');
layoutSelect.className = 'chip';
layoutSelect.innerHTML = `Devices <select>
  <option value="auto">auto</option><option value="column">column</option><option value="grid">grid</option>
</select>`;
const select = layoutSelect.querySelector('select')!;
select.value = config.devices_layout ?? 'auto';
select.addEventListener('change', () =>
  withConfig((c) => {
    if (select.value === 'auto') delete c.devices_layout;
    else c.devices_layout = select.value as 'column' | 'grid';
  }),
);
display.appendChild(layoutSelect);

const languageSelect = document.createElement('label');
languageSelect.className = 'chip';
languageSelect.innerHTML = `Card language <select>
  <option value="auto">auto (HA)</option><option value="en">English</option><option value="fr">Français</option>
</select>`;
const langInput = languageSelect.querySelector('select')!;
langInput.value = config.language ?? 'auto';
langInput.addEventListener('change', () =>
  withConfig((c) => {
    if (langInput.value === 'auto') delete c.language;
    else c.language = langInput.value;
  }),
);
display.appendChild(languageSelect);

const lineSelect = document.createElement('label');
lineSelect.className = 'chip';
lineSelect.innerHTML = `Lines <select>
  <option value="rounded">rounded</option><option value="square">square</option>
  <option value="curved">curved</option><option value="straight">straight</option>
</select>`;
const lineInput = lineSelect.querySelector('select')!;
lineInput.value = config.line_style ?? 'rounded';
lineInput.addEventListener('change', () =>
  withConfig((c) => {
    if (lineInput.value === 'rounded') delete c.line_style;
    else c.line_style = lineInput.value as LiveEnergyCardConfig['line_style'];
  }),
);
display.appendChild(lineSelect);

const widthInput = $<HTMLInputElement>('width');
widthInput.value = String(state.width);
const setWidth = () => {
  state.width = Number(widthInput.value);
  frame.style.maxWidth = `${state.width}px`;
  $('width-out').textContent = `${state.width}px`;
};
widthInput.addEventListener('input', setWidth);

// --- Scenarios ----------------------------------------------------------------------------------

const devicesOff = () => Object.fromEntries(DEVICES.map((d) => [d.entity, 0]));
const standby = () => ({
  ...devicesOff(),
  [DEVICES[2].entity]: 82,
  [DEVICES[5].entity]: 18,
  [DEVICES[10].entity]: 45,
  [DEVICES[11].entity]: 7,
  [DEVICES[12].entity]: 16,
  [DEVICES[9].entity]: 22,
});

const PRESETS: Record<string, () => void> = {
  Night: () => Object.assign(state, { solar: 0, battery: 220, soc: 38, baseLoad: 90, devices: standby() }),
  'Full sun, surplus': () =>
    Object.assign(state, {
      solar: 4300,
      battery: -900,
      soc: 72,
      baseLoad: 120,
      devices: { ...standby(), [DEVICES[4].entity]: 130 },
    }),
  'Solar water heater': () =>
    Object.assign(state, {
      solar: 3100,
      battery: 0,
      soc: 100,
      baseLoad: 110,
      devices: { ...standby(), [DEVICES[1].entity]: 2050 },
    }),
  'Consumption peak': () =>
    Object.assign(state, {
      solar: 650,
      battery: 1500,
      soc: 55,
      baseLoad: 300,
      devices: {
        ...standby(),
        [DEVICES[1].entity]: 2100,
        [DEVICES[6].entity]: 1900,
        [DEVICES[3].entity]: 145,
        [DEVICES[4].entity]: 160,
      },
    }),
  'Off-peak battery charge': () =>
    Object.assign(state, { solar: 0, battery: -2500, soc: 20, baseLoad: 100, devices: standby() }),
  'Battery → grid': () =>
    Object.assign(state, { solar: 0, battery: 2800, soc: 90, baseLoad: 80, devices: standby() }),
  'All zero': () =>
    Object.assign(state, { solar: 0, battery: 0, soc: 50, baseLoad: 0, devices: devicesOff() }),
};

const presets = $('presets');
for (const [name, apply] of Object.entries(PRESETS)) {
  const btn = document.createElement('button');
  btn.textContent = name;
  btn.addEventListener('click', () => {
    apply();
    state.autoGrid = true;
    (document.getElementById('auto-grid') as HTMLInputElement).checked = true;
    refreshSliders();
    push();
  });
  presets.appendChild(btn);
}

// Simulation: realistic random variations.
setInterval(() => {
  if (!state.live) return;
  const jitter = (v: number, amp: number, min = 0, max = Infinity) =>
    Math.round(Math.min(max, Math.max(min, v + (Math.random() - 0.5) * amp)));
  state.solar = jitter(state.solar, 500, 0, 6000);
  state.battery = jitter(state.battery, 300, -3000, 3000);
  for (const d of DEVICES) {
    const cur = state.devices[d.entity];
    if (d.typical >= 1000) {
      if (Math.random() < 0.08) state.devices[d.entity] = cur > 0 ? 0 : d.typical;
    } else if (cur > 0 || Math.random() < 0.05) {
      state.devices[d.entity] = Math.random() < 0.05 ? 0 : jitter(cur || d.typical, d.typical * 0.3, 0);
    }
  }
  refreshSliders();
  push();
}, 1600);

// --- YAML ---------------------------------------------------------------------------------------

$('apply').addEventListener('click', () => {
  try {
    applyConfig(parse($<HTMLTextAreaElement>('yaml').value) as LiveEnergyCardConfig);
  } catch (err) {
    $('error').textContent = (err as Error).message;
  }
});
$('reset').addEventListener('click', () => applyConfig(structuredClone(DEFAULT_CONFIG)));
// Same path as "Add card" in Home Assistant: the stub config is imported from the Energy dashboard.
$('import').addEventListener('click', async () => {
  const stub = await LiveEnergyCard.getStubConfig(buildHass());
  applyConfig({ type: 'custom:live-energy-card', ...stub } as LiveEnergyCardConfig);
});

card.addEventListener('hass-action', (ev) => {
  const { config: c, action } = (ev as CustomEvent).detail;
  const line = `${new Date().toLocaleTimeString()} · ${action} → ${c.entity ?? '(no entity)'} (${
    c[`${action}_action`]?.action ?? 'none'
  })`;
  const log = $('log');
  log.textContent = log.textContent === '—' ? line : `${line}\n${log.textContent}`;
});

new ResizeObserver(() => {
  $('size').textContent = `${Math.round(frame.clientWidth)} px`;
}).observe(frame);

document.documentElement.dataset.theme = state.dark ? 'dark' : 'light';
PRESETS['Full sun, surplus']();
refreshSliders();
setWidth();
applyConfig(config);
