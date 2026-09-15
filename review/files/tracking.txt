/**
 * Brick 20. Tracking the Gaborone way.
 *
 * Both council seats reached the same ruling independently: put the ARRIVAL WINDOW and a
 * LANDMARK CONFIRMATION first, and make the map the secondary thing. A moving dot on a map is
 * what a customer watches when they do not trust the estimate. It is entertainment, not
 * information, and in a city without a street grid the dot is often wrong anyway.
 *
 * So this file answers two questions and refuses to answer a third.
 *
 *   1. When will it arrive? As a window, never as a countdown. "Between 14:20 and 14:40" can be
 *      right. "Arriving in 3 minutes" is a promise that is usually broken, and a customer who
 *      has been told three minutes for ten minutes stops believing anything the app says.
 *   2. Is the address still right? Asked ONCE, before the rider gets close, while there is still
 *      time to fix it. Not after they are lost outside the wrong gate.
 *   3. Exactly where is my rider right now? Available, second, and never the headline.
 *
 * The window WIDENS as an order runs late rather than quietly sliding. A window that keeps
 * moving by five minutes every five minutes is a lie told in instalments.
 */

import { OrderState, STATES } from './state_machine';
import { AddressPassport } from './address_passport';

export interface ArrivalWindow {
  /** ISO timestamps. Always a range, never a point. */
  from: string;
  to: string;
  /** How much to trust it. Drives the words shown, not just the numbers. */
  confidence: 'firm' | 'rough' | 'unknown';
  says: string;
}

export type PanelKind = 'arrival' | 'confirm_address' | 'map' | 'problem';

export interface Panel {
  kind: PanelKind;
  /** 1 is the top of the screen. The council's ruling lives in these numbers. */
  rank: number;
  says: string;
}

/** Minutes of work still ahead, by state. Rough on purpose; a false precision is worse. */
const MINUTES_REMAINING: Partial<Record<OrderState, [number, number]>> = {
  placed: [35, 60],
  paid: [30, 55],
  dispatch_offered: [30, 55],
  dispatch_accepted: [22, 40],
  at_merchant: [18, 32],
  picked_up: [8, 20],
  at_door: [0, 5],
  stock_problem: [25, 60],
  address_problem: [10, 30],
  customer_absent: [0, 10],
  rider_failed: [30, 70],
};

/** States where an arrival time is a fiction and should not be shown at all. */
const NO_ESTIMATE: OrderState[] = [
  'payment_failed', 'returning', 'returned', 'refund_due', 'cancelled', 'closed', 'delivered',
];

export function arrivalWindow(state: OrderState, sinceISO: string, nowISO?: string): ArrivalWindow | null {
  if (NO_ESTIMATE.includes(state)) return null;
  const range = MINUTES_REMAINING[state];
  if (!range) return null;

  const now = nowISO ? Date.parse(nowISO) : Date.now();
  const since = Date.parse(sinceISO);
  let [lo, hi] = range;

  // Running late in this state widens the window instead of sliding it. The customer sees the
  // uncertainty grow, which is the truth, rather than a promise quietly renewed.
  const limit = STATES[state].stuckAfterMinutes;
  const satFor = Number.isNaN(since) ? 0 : (now - since) / 60000;
  let confidence: ArrivalWindow['confidence'] = 'firm';
  if (limit !== null && satFor > limit) {
    const overBy = satFor - limit;
    lo = lo + Math.floor(overBy * 0.5);
    hi = hi + Math.ceil(overBy * 1.5);
    confidence = 'rough';
  }
  if (hi - lo > 45) confidence = 'unknown';

  const from = new Date(now + lo * 60000);
  const to = new Date(now + hi * 60000);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    confidence,
    says:
      confidence === 'unknown'
        ? 'We cannot give you a good time yet, someone is looking at this one'
        : confidence === 'rough'
          ? `Running a bit behind, expect it between ${hhmm(from)} and ${hhmm(to)}`
          : `Arriving between ${hhmm(from)} and ${hhmm(to)}`,
  };
}

function hhmm(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/**
 * Ask the customer to check the address ONCE, and only while there is still time to act on the
 * answer. Never for an address a rider has already confirmed, because asking a person to check
 * something the company already knows is how an app teaches people to ignore it.
 */
export function shouldConfirmAddress(
  state: OrderState,
  passport: AddressPassport | null,
  alreadyAsked: boolean,
): boolean {
  if (alreadyAsked || !passport) return false;
  if (passport.confidence === 'rider_confirmed') return false;
  return ['paid', 'dispatch_offered', 'dispatch_accepted', 'at_merchant'].includes(state);
}

/**
 * What the tracking screen shows, in order. This IS the council ruling, written as data so it
 * cannot drift back into a map at the top the next time somebody redesigns a screen.
 */
export function panels(
  state: OrderState,
  passport: AddressPassport | null,
  alreadyAsked: boolean,
  window: ArrivalWindow | null,
): Panel[] {
  const out: Panel[] = [];

  const problems: Partial<Record<OrderState, string>> = {
    stock_problem: 'The shop is short of something, tap to choose what to do',
    address_problem: 'Your rider cannot find the place, tap to help them',
    customer_absent: 'Your rider is outside and cannot reach you',
    payment_failed: 'The payment did not go through',
    rider_failed: 'We are finding you another rider',
  };
  if (problems[state]) {
    out.push({ kind: 'problem', rank: 1, says: problems[state] as string });
  }

  if (window) {
    out.push({ kind: 'arrival', rank: out.length + 1, says: window.says });
  }

  if (shouldConfirmAddress(state, passport, alreadyAsked)) {
    out.push({
      kind: 'confirm_address',
      rank: out.length + 1,
      says: `Still ${passport!.landmark || passport!.plot}? Tap to change it while there is time`,
    });
  }

  // The map is always last and always optional. That is the ruling.
  if (['dispatch_accepted', 'at_merchant', 'picked_up', 'at_door'].includes(state)) {
    out.push({ kind: 'map', rank: out.length + 1, says: 'See where your rider is' });
  }

  return out;
}

/**
 * The one line sent to WhatsApp. Kept short because it is read on a lock screen, and kept free
 * of anything clinical because WhatsApp leaves the country. See section 6 of the DPIA.
 */
export function whatsappLine(state: OrderState, window: ArrivalWindow | null): string | null {
  const worth: Partial<Record<OrderState, string>> = {
    dispatch_accepted: 'A rider has your order and is on the way to the shop.',
    picked_up: 'Your order is on the road.',
    at_door: 'Your rider is at your gate.',
    delivered: 'Delivered. Thank you for using Sprint.',
    stock_problem: 'The shop is short of something. Please open the app to choose what to do.',
    address_problem: 'Your rider cannot find the address. Please open the app to help.',
    customer_absent: 'Your rider is outside and cannot reach you.',
  };
  const base = worth[state];
  if (!base) return null;
  const line = window && ['dispatch_accepted', 'picked_up'].includes(state)
    ? `${base} ${window.says}.`
    : base;
  return line.replace(/\s+/g, ' ').trim();
}

/** Nothing about medicine, ever, on a channel that leaves the country. */
export function isSafeForWhatsapp(text: string): boolean {
  return !/(prescription|medicine|medication|tablet|pharmac|mg\b|dose)/i.test(text);
}
