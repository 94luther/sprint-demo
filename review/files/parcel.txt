/**
 * Brick 27. Parcels and documents inside the same app.
 *
 * This is the thing neither Wanzy nor Zebras can answer. A customer who is already using the app
 * for groceries can send a parcel to Francistown from the same account, at the same rates Sprint
 * already contracts on, carried by the same riders and branches.
 *
 * THE PRICES COME FROM THE SIGNED CONTRACT, NOT FROM A COPY OF IT. `tariff-domestic.json` beside
 * this file was written straight out of UPDATED SLA_2026.pdf, page 10, read by word position,
 * because a layout dump shifts rows on that document and produces wrong prices. Its own header
 * records the document, the page, the method and the day it was read. On 13 September 2026 all
 * 160 prices were checked against the live quote engine and every one matched.
 *
 * The rule that governs everything here: **a price that cannot be looked up is refused, never
 * estimated.** A wrong price reaches a customer, and then it reaches an argument.
 */

import tariff from './tariff-domestic.json';

export type Zone = '1' | '2' | '3' | '4';

export interface ParcelQuote {
  weight_kg: number;
  /** The weight actually charged. Sprint charges the next half kilo up, like everyone does. */
  charged_kg: number;
  zone: Zone;
  price: number;
  /** True when the weight is past the table and the per kilo rate was used. */
  beyond_table: boolean;
  includes_vat: boolean;
  says: string;
  source: string;
}

export class ParcelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParcelError';
  }
}

export const MAX_TABLE_KG: number = tariff.max_table_kg;
export const STEP_KG = 0.5;

/** Sprint's table moves in half kilos, so anything between steps is charged at the next one up. */
export function chargedWeight(kg: number): number {
  if (!Number.isFinite(kg) || kg <= 0) {
    throw new ParcelError('A parcel needs a weight before it can be priced.');
  }
  return Math.ceil(kg / STEP_KG) * STEP_KG;
}

function keyFor(kg: number): string {
  const asInt = String(Number.isInteger(kg) ? kg : kg);
  const steps = tariff.steps as Record<string, Record<string, number>>;
  for (const cand of [asInt, kg.toFixed(1), String(kg)]) {
    if (cand in steps) return cand;
  }
  return '';
}

/**
 * Price a parcel. Refuses rather than guessing, because the only thing worse than no quote is a
 * confident wrong one.
 */
export function quote(kg: number, zone: Zone): ParcelQuote {
  if (!(['1', '2', '3', '4'] as string[]).includes(zone)) {
    throw new ParcelError(`Zone ${zone} is not in the contract. Sprint prices zones 1 to 4 only.`);
  }
  const charged = chargedWeight(kg);

  if (charged <= MAX_TABLE_KG) {
    const key = keyFor(charged);
    const row = (tariff.steps as Record<string, Record<string, number>>)[key];
    if (!row || typeof row[zone] !== 'number') {
      throw new ParcelError(
        `No price in the contract for ${charged}kg in zone ${zone}. This must be asked, not estimated.`,
      );
    }
    return {
      weight_kg: kg,
      charged_kg: charged,
      zone,
      price: row[zone],
      beyond_table: false,
      includes_vat: true,
      says: `P${row[zone].toFixed(2)} to send ${charged}kg, everything included`,
      source: `${tariff._source.document} page ${tariff._source.page}`,
    };
  }

  // Past the table, the contract gives a rate per kilo on top of the last row.
  const base = (tariff.steps as Record<string, Record<string, number>>)[keyFor(MAX_TABLE_KG)];
  const perKg = (tariff.per_kg_after_max as Record<string, number>)[zone];
  if (!base || typeof base[zone] !== 'number' || typeof perKg !== 'number') {
    throw new ParcelError(`The contract has no rate beyond ${MAX_TABLE_KG}kg for zone ${zone}.`);
  }
  const extra = charged - MAX_TABLE_KG;
  const price = Math.round((base[zone] + extra * perKg) * 100) / 100;
  return {
    weight_kg: kg,
    charged_kg: charged,
    zone,
    price,
    beyond_table: true,
    includes_vat: true,
    says: `P${price.toFixed(2)} to send ${charged}kg, everything included`,
    source: `${tariff._source.document} page ${tariff._source.page}`,
  };
}

/** What the app shows beside the price. Never itemise VAT or fuel: they are already inside. */
export function priceNote(): string {
  return `Includes VAT at ${tariff.vat_pct} percent and the fuel surcharge at ${tariff.fuel_pct} percent. Nothing is added at the end.`;
}

/** So a screen can show a customer what it will cost before they weigh anything precisely. */
export function ladder(zone: Zone, upToKg = 5): Array<{ kg: number; price: number }> {
  const out: Array<{ kg: number; price: number }> = [];
  for (let kg = STEP_KG; kg <= upToKg + 1e-9; kg += STEP_KG) {
    const k = Math.round(kg * 10) / 10;
    try {
      out.push({ kg: k, price: quote(k, zone).price });
    } catch {
      // A missing step is left out rather than filled in with a guess.
    }
  }
  return out;
}

/** Where the prices came from, for anyone who asks, including an auditor. */
export function provenance(): typeof tariff._source {
  return tariff._source;
}
