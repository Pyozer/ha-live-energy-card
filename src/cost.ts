import type { FlowResult } from './compute';
import { COST_STATISTIC, EARNINGS_STATISTIC, EXPORT_STATISTIC } from './energy-today';
import type { CostConfig, HassEntity, HomeAssistant } from './types';
import { numberFormat } from './units';

/**
 * Live cost and carbon indicators, derived from the current flows:
 *  - cost: grid import × import price − grid export × export price (per hour);
 *  - savings: solar consumed on site (home and battery) × import price (per hour);
 *  - carbon: grid import × carbon intensity of the grid (g CO2eq per hour).
 *
 * With `period: day`, cost and savings are totals of the day from today's energy counters instead:
 * import × import price − export × export price, and (solar − export) × import price. Today's
 * energy is priced at the current price, so a tariff that changes during the day is approximate.
 *
 * `cost_entity` and `earnings_entity` give ready-made amounts instead (€/h, or € for the day), for
 * tariffs already computed elsewhere.
 */

export interface Price {
  /** Price per kWh. */
  value: number;
  /** Currency: ISO code (EUR) or symbol (€), `undefined` when unknown. */
  currency?: string;
}

export interface Stats {
  /** `hour`: rate per hour. `day`: total of the day. */
  period: 'hour' | 'day';
  cost: number | null;
  savings: number | null;
  carbon: number | null;
  currency?: string;
}

/** Energy unit in the denominator of a price → factor to a price per kWh. */
const PER_ENERGY: Record<string, number> = { Wh: 1000, kWh: 1, MWh: 0.001 };

/** Reads a price entity (`EUR/kWh`, `€/MWh`…). The currency comes from its unit. */
export function readPrice(entity: HassEntity | undefined): Price | null {
  if (!entity) return null;
  const value = Number(entity.state);
  if (!Number.isFinite(value)) return null;
  const unit = String(entity.attributes.unit_of_measurement ?? '').trim();
  const [currency, energy] = unit.split('/').map((p) => p.trim());
  const factor = energy && energy in PER_ENERGY ? PER_ENERGY[energy] : 1;
  return { value: value * factor, currency: currency || undefined };
}

function priceOf(hass: HomeAssistant, fixed: number | undefined, entityId: string | undefined): Price | null {
  if (entityId) return readPrice(hass.states[entityId]);
  return typeof fixed === 'number' && Number.isFinite(fixed) ? { value: fixed } : null;
}

/** Amounts of an indicator: `null` when a needed reading is unavailable. */
interface Amounts {
  /** Cost of the grid import. */
  importCost: number | null;
  /** Earnings of the grid export: `0` when no export price is set (the export is not counted). */
  earnings: number | null;
  savings: number | null;
}

const known = (v: number | null | undefined): v is number => typeof v === 'number';

/** Rate per hour from the current flows. */
function hourlyAmounts(result: FlowResult, importPrice: Price | null, exportPrice: Price | null): Amounts {
  const kw = (w: number) => w / 1000;
  const f = result.flows;
  return {
    importCost: importPrice ? kw(result.gridImport) * importPrice.value : null,
    earnings: exportPrice ? kw(result.gridExport) * exportPrice.value : 0,
    savings: importPrice ? kw(f.solarToHome + f.solarToBattery) * importPrice.value : null,
  };
}

/** Totals of the day from today's energy (kWh), priced at the current price. */
export function dailyAmounts(
  today: ReadonlyMap<string, number | null>,
  importPrice: Price | null,
  exportPrice: Price | null,
): Amounts {
  const imported = today.get('grid');
  const exported = today.get(EXPORT_STATISTIC);
  const solar = today.get('solar');
  return {
    importCost: importPrice && known(imported) ? imported * importPrice.value : null,
    // An export price needs the exported energy: a partial cost would be misleading.
    earnings: exportPrice ? (known(exported) ? exported * exportPrice.value : null) : 0,
    // Solar that did not go to the grid was used on site (home or battery).
    savings:
      importPrice && known(solar) && known(exported)
        ? Math.max(0, solar - exported) * importPrice.value
        : null,
  };
}

/** Reads a monetary entity (`EUR`, `€/h`…). The currency is the part of the unit before `/`. */
export function readMoney(entity: HassEntity | undefined): { value: number; currency?: string } | null {
  if (!entity) return null;
  const value = Number(entity.state);
  if (!Number.isFinite(value)) return null;
  const currency = String(entity.attributes.unit_of_measurement ?? '')
    .split('/')[0]
    .trim();
  return { value, currency: currency || undefined };
}

/**
 * A ready-made amount (a cost entity already computed, with dynamic tariffs for example). Hourly:
 * its state, a rate. Daily: today's change from the statistics (a cumulative cost counter, as in the
 * Energy dashboard); an entity without statistics is taken as is, as a total of the day. Still
 * loading (`undefined`): nothing yet, so a cumulative counter is never shown as a daily total.
 */
function entityAmount(
  hass: HomeAssistant,
  id: string,
  period: 'hour' | 'day',
  statistic: number | null | undefined,
): { value: number | null; currency?: string } {
  const reading = readMoney(hass.states[id]);
  if (period === 'hour' || statistic === null)
    return { value: reading?.value ?? null, currency: reading?.currency };
  return { value: statistic ?? null, currency: reading?.currency };
}

export function computeStats(
  result: FlowResult,
  hass: HomeAssistant,
  cost: CostConfig | undefined,
  carbonEntity: string | undefined,
  today: ReadonlyMap<string, number | null> = new Map(),
): Stats | null {
  if (!cost && !carbonEntity) return null;
  const importPrice = cost ? priceOf(hass, cost.price, cost.price_entity) : null;
  const exportPrice = cost ? priceOf(hass, cost.export_price, cost.export_price_entity) : null;

  const period = cost?.period === 'day' ? 'day' : 'hour';
  const amounts =
    period === 'day'
      ? dailyAmounts(today, importPrice, exportPrice)
      : hourlyAmounts(result, importPrice, exportPrice);
  // Cost and earnings entities replace the amounts computed from the prices.
  let currency: string | undefined;
  if (cost?.cost_entity) {
    const e = entityAmount(hass, cost.cost_entity, period, today.get(COST_STATISTIC));
    amounts.importCost = e.value;
    currency = e.currency;
  }
  if (cost?.earnings_entity) {
    const e = entityAmount(hass, cost.earnings_entity, period, today.get(EARNINGS_STATISTIC));
    amounts.earnings = e.value;
    currency ??= e.currency;
  }
  const costTotal =
    amounts.importCost === null || amounts.earnings === null ? null : amounts.importCost - amounts.earnings;

  const kw = (w: number) => w / 1000;
  let carbon: number | null = null;
  if (carbonEntity) {
    const intensity = Number(hass.states[carbonEntity]?.state);
    if (Number.isFinite(intensity)) carbon = kw(result.gridImport) * Math.max(0, intensity);
  }

  return {
    period,
    cost: costTotal,
    savings: amounts.savings,
    carbon,
    currency: cost?.currency ?? currency ?? importPrice?.currency ?? hass.config?.currency,
  };
}

/** `0.42 €/h`, with the currency formatted by `Intl` when it is an ISO code. */
export function formatMoneyRate(value: number, currency: string | undefined, locale?: string): string {
  return formatMoney(value, currency, locale, '/h');
}

/** `1.84 €` (with a suffix such as `/h` for a rate). */
export function formatMoney(
  value: number,
  currency: string | undefined,
  locale?: string,
  suffix = '',
): string {
  const decimals = Math.abs(value) >= 10 ? 1 : 2;
  if (currency && /^[A-Z]{3}$/.test(currency)) {
    try {
      const text = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(value);
      return `${text}${suffix}`;
    } catch {
      // Unknown currency code: plain number below.
    }
  }
  const num = numberFormat(locale, decimals).format(value);
  return currency ? `${num} ${currency}${suffix}` : `${num}${suffix}`;
}

/** `120 g/h`, `1.2 kg/h`. */
export function formatCarbonRate(grams: number, locale?: string): string {
  if (grams >= 1000) return `${numberFormat(locale, 1).format(grams / 1000)} kg/h`;
  return `${numberFormat(locale, 0).format(grams)} g/h`;
}
