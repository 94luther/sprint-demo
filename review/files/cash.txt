/**
 * Brick 18, the cash half. CashSure.
 *
 * Cash is most of this market and it is where the money leaks. The industry figure for cash
 * reconciliation loss is one and a half to three percent of revenue, and Sprint has never measured
 * its own. The director question "what is leaking unbilled" has no answer today, and it cannot have
 * one until every cash order is counted against what the rider actually carried.
 *
 * Four things make that possible, and none of them needs a payment provider to answer first:
 *
 *   1. A CAP. Above a certain order value, cash is simply not offered. A rider carrying eight
 *      hundred pula of other people's change is a target, and a loss nobody can prove.
 *   2. THE NOTE THE CUSTOMER WILL PAY WITH, asked at checkout, so the rider leaves with the right
 *      change instead of standing at a gate unable to complete the sale.
 *   3. A FLOAT worked out from the orders actually assigned, not a habit.
 *   4. A COUNT at the end of the shift, against what the orders say should be there, with the
 *      difference named rather than absorbed.
 *
 * Every amount here is in thebe, the smallest unit, because money held in a decimal is money that
 * quietly disappears in rounding. One pula is 100 thebe.
 */

/**
 * Botswana notes in circulation, in thebe, biggest first. P200, P100, P50, P20, P10.
 * There is no P500 note, which is worth knowing before somebody builds a screen offering one.
 * Coins are ignored: nobody pays a courier in coins.
 */
export const NOTES = [20000, 10000, 5000, 2000, 1000] as const;
export const THEBE = 100;

/** Above this, cash is not offered. A rider should never carry more change than this implies. */
export const CASH_CAP_THEBE = 100000; // P1000

/** A shift float above this needs a supervisor to hand it out and sign for it. */
export const FLOAT_SIGNOFF_THEBE = 50000; // P500

/** Under this, a shortfall at count up is written off rather than argued. Finance may change it. */
export const WRITE_OFF_THEBE = 500; // P5

export class CashError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CashError';
  }
}

export function pula(thebe: number): string {
  return `P${(thebe / THEBE).toFixed(2)}`;
}

/** May this order be paid in cash at all. */
export function cashAllowed(totalThebe: number): { allowed: boolean; says: string } {
  if (!Number.isInteger(totalThebe) || totalThebe <= 0) {
    throw new CashError('An order total must be a whole number of thebe before cash can be offered.');
  }
  if (totalThebe > CASH_CAP_THEBE) {
    return {
      allowed: false,
      says: `Orders over ${pula(CASH_CAP_THEBE)} cannot be paid in cash. Please choose another way to pay.`,
    };
  }
  return { allowed: true, says: 'You can pay the rider in cash' };
}

/** The notes a customer could sensibly hand over for this total, biggest first. */
export function payableWith(totalThebe: number): number[] {
  return NOTES.filter((n) => n >= totalThebe || n >= smallestCovering(totalThebe));
}

function smallestCovering(totalThebe: number): number {
  const fits = NOTES.filter((n) => n >= totalThebe);
  return fits.length ? Math.min(...fits) : Math.max(...NOTES);
}

/**
 * What the rider must carry for this order. Asked at checkout, because a rider who arrives without
 * change either loses the sale or rounds it in somebody's favour, and both are a leak.
 */
/**
 * The notes a customer would actually hand over to make exactly this amount,
 * biggest first. Null when no combination of Botswana notes makes it.
 *
 * Every note is a multiple of P10 and P10 itself is a note, so an amount is
 * payable exactly when it is a whole number of P10 and at least P10. Greedy is
 * correct here: 200, 100, 50, 20, 10 is a canonical set, so taking the biggest
 * note that fits never paints you into a corner.
 */
export function notesFor(amountThebe: number): number[] | null {
  if (!Number.isInteger(amountThebe) || amountThebe < 0) return null;
  if (amountThebe === 0) return [];
  const smallest = Math.min(...NOTES);
  if (amountThebe % smallest !== 0) return null;
  const out: number[] = [];
  let left = amountThebe;
  for (const n of [...NOTES].sort((a, b) => b - a)) {
    while (left >= n) {
      out.push(n);
      left -= n;
    }
  }
  return left === 0 ? out : null;
}

/** Can a person physically hand this over? */
export function canBeHandedOver(amountThebe: number): boolean {
  return notesFor(amountThebe) !== null;
}

/** 'two P200s and a P100', for a screen or a rider to read. */
export function saysNotes(amountThebe: number): string {
  const ns = notesFor(amountThebe);
  if (!ns || ns.length === 0) return 'nothing';
  const counted = new Map<number, number>();
  for (const n of ns) counted.set(n, (counted.get(n) ?? 0) + 1);
  const parts = [...counted.entries()].map(([note, times]) =>
    times === 1 ? 'a ' + pula(note) : times + ' x ' + pula(note),
  );
  if (parts.length === 1) return parts[0];
  return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
}

/**
 * Three amounts a customer might realistically hand over for this total: the
 * least they can assemble that covers it, and two rounder amounts above it.
 * This replaces the old single note list, which could not cover anything over
 * P200 and so made cash unusable for a normal hardware or grocery basket.
 */
export function tendersFor(totalThebe: number): number[] {
  const check = cashAllowed(totalThebe);
  if (!check.allowed) return [];
  const smallest = Math.min(...NOTES);
  const least = Math.ceil(totalThebe / smallest) * smallest;
  const out = new Set<number>();
  if (canBeHandedOver(least)) out.add(least);
  for (const step of [5000, 10000, 20000]) {
    const rounded = Math.ceil(totalThebe / step) * step;
    if (rounded !== least && canBeHandedOver(rounded) && rounded <= CASH_CAP_THEBE) {
      out.add(rounded);
    }
  }
  return [...out].sort((a, b) => a - b).slice(0, 3);
}

export function changeFor(totalThebe: number, payingWithThebe: number): {
  change: number;
  says: string;
  riderNeeds: number;
  /** what the customer physically hands the rider, for the screen and the run sheet */
  handingOver: string;
} {
  const check = cashAllowed(totalThebe);
  if (!check.allowed) throw new CashError(check.says);
  /* Anything a customer can actually assemble from notes. It used to be a single
     note, which capped every cash order at P200 and made cash useless for a normal
     basket. P500 is fine, handed over as two P200s and a P100. P75 is not, because
     no combination of Botswana notes makes it. */
  if (!canBeHandedOver(payingWithThebe)) {
    throw new CashError(
      `${pula(payingWithThebe)} is not an amount anyone can hand over. The smallest note is ${pula(Math.min(...NOTES))}.`,
    );
  }
  if (payingWithThebe < totalThebe) {
    throw new CashError(
      `${pula(payingWithThebe)} does not cover ${pula(totalThebe)}. Hand over more.`,
    );
  }
  const change = payingWithThebe - totalThebe;
  return {
    change,
    riderNeeds: change,
    says: change === 0
      ? 'No change needed, the customer has it exactly'
      : `Your rider will bring ${pula(change)} change`,
    handingOver: saysNotes(payingWithThebe),
  };
}

export interface CashOrder {
  order_id: string;
  total: number;
  paying_with: number;
}

/** What a rider must leave the branch with, given the cash orders actually on their run. */
export function floatFor(orders: CashOrder[]): {
  float: number;
  needs_signoff: boolean;
  says: string;
  per_order: Array<{ order_id: string; change: number }>;
} {
  const per_order = orders.map((o) => ({
    order_id: o.order_id,
    change: changeFor(o.total, o.paying_with).change,
  }));
  const float = per_order.reduce((a, b) => a + b.change, 0);
  const needs_signoff = float > FLOAT_SIGNOFF_THEBE;
  return {
    float,
    needs_signoff,
    per_order,
    says: needs_signoff
      ? `${pula(float)} float, which needs a supervisor to hand it over and sign`
      : `${pula(float)} float for ${orders.length} cash order${orders.length === 1 ? '' : 's'}`,
  };
}

export interface Reconciliation {
  expected: number;
  counted: number;
  difference: number;
  /** Positive means the rider has more than they should, negative means short. */
  short: boolean;
  within_write_off: boolean;
  says: string;
}

/**
 * End of shift. What the orders say should be in the bag, against what is actually in it.
 * This is the number that has never been measured, and the only way the leak becomes visible.
 */
export function reconcile(
  floatOut: number,
  orders: CashOrder[],
  countedIn: number,
): Reconciliation {
  if (!Number.isInteger(countedIn) || countedIn < 0) {
    throw new CashError('The counted amount must be a whole number of thebe. Count it again.');
  }
  const collected = orders.reduce((a, o) => a + o.paying_with, 0);
  const givenOut = orders.reduce((a, o) => a + changeFor(o.total, o.paying_with).change, 0);
  const expected = floatOut + collected - givenOut;
  const difference = countedIn - expected;
  const within = Math.abs(difference) <= WRITE_OFF_THEBE;
  return {
    expected,
    counted: countedIn,
    difference,
    short: difference < 0,
    within_write_off: within,
    says:
      difference === 0
        ? 'Balanced exactly'
        : within
          ? `${pula(Math.abs(difference))} ${difference < 0 ? 'short' : 'over'}, inside the write off, closed`
          : `${pula(Math.abs(difference))} ${difference < 0 ? 'SHORT' : 'OVER'}, this one needs a person to look at it`,
  };
}

/** The photograph rule, so a disputed cash handover has something behind it. */
export function needsCashPhoto(totalThebe: number): boolean {
  return totalThebe >= 20000; // P200 and up
}
