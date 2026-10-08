import type { FlowResult } from './compute';
import type { CostConfig, HassEntity, HomeAssistant } from './types';
import { numberFormat } from './units';

/**
 * Live cost and carbon indicators, derived from the current flows:
 *  - cost: grid import × import price − grid export × export price (per hour);
 *  - savings: solar consumed on site (home and battery) × import price (per hour);
 *  - carbon: grid import × carbon intensity of the grid (g CO2eq per hour).
 */

export interface Price {
  /** Price per kWh. */
  value: number;
  /** Currency: ISO code (EUR) or symbol (€), `undefined` when unknown. */
  currency?: string;
}

export interface Stats {
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

export function computeStats(
  result: FlowResult,
  hass: HomeAssistant,
  cost: CostConfig | undefined,
  carbonEntity: string | undefined,
): Stats | null {
  if (!cost && !carbonEntity) return null;
  const kw = (w: number) => w / 1000;
  const importPrice = cost ? priceOf(hass, cost.price, cost.price_entity) : null;
  const exportPrice = cost ? priceOf(hass, cost.export_price, cost.export_price_entity) : null;
  const f = result.flows;

  let costRate: number | null = null;
  let savings: number | null = null;
  if (importPrice) {
    costRate = kw(result.gridImport) * importPrice.value;
    // Without an export price, exported energy is not counted.
    if (exportPrice) costRate -= kw(result.gridExport) * exportPrice.value;
    savings = kw(f.solarToHome + f.solarToBattery) * importPrice.value;
  }

  let carbon: number | null = null;
  if (carbonEntity) {
    const intensity = Number(hass.states[carbonEntity]?.state);
    if (Number.isFinite(intensity)) carbon = kw(result.gridImport) * Math.max(0, intensity);
  }

  return {
    cost: costRate,
    savings,
    carbon,
    currency: cost?.currency ?? importPrice?.currency ?? hass.config?.currency,
  };
}

/** `0.42 €/h`, with the currency formatted by `Intl` when it is an ISO code. */
export function formatMoneyRate(value: number, currency: string | undefined, locale?: string): string {
  const decimals = Math.abs(value) >= 10 ? 1 : 2;
  if (currency && /^[A-Z]{3}$/.test(currency)) {
    try {
      const text = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(value);
      return `${text}/h`;
    } catch {
      // Unknown currency code: plain number below.
    }
  }
  const num = numberFormat(locale, decimals).format(value);
  return currency ? `${num} ${currency}/h` : `${num}/h`;
}

/** `120 g/h`, `1.2 kg/h`. */
export function formatCarbonRate(grams: number, locale?: string): string {
  if (grams >= 1000) return `${numberFormat(locale, 1).format(grams / 1000)} kg/h`;
  return `${numberFormat(locale, 0).format(grams)} g/h`;
}
