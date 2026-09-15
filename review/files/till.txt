/**
 * Brick 32. The merchant till.
 *
 * Both competitors lose orders in the same place, and it is not the app. It is the shop counter. An
 * order arrives on a phone nobody is holding, the assistant is serving a queue, and twenty minutes
 * later a rider is standing at a till where nothing has been picked. The customer blames the courier.
 *
 * So the promise on the wall is two minutes to accept, and this file is what makes two minutes mean
 * something. It does four things nothing in this market does:
 *
 *   1. It separates "the shop has not accepted yet" from "the shop never got it". Those look
 *      identical on a dashboard and they are two different phone calls to two different people. A
 *      till that has stopped reporting in is a DEAD DEVICE, and chasing the shopkeeper about it
 *      wastes everyone's morning.
 *   2. It will not send a rider to a counter that has not accepted, unless that shop has EARNED it
 *      by being fast, measured over real orders rather than decided in a meeting.
 *   3. It escalates on a ladder with a named person at every rung, and the last rung is telling the
 *      customer the truth before their expectation breaks, not after.
 *   4. It never quietly cancels. Somebody is always named as holding it.
 *
 * The acceptance clock also feeds brick 34, so the shop that is quietly slow shows up by name
 * instead of by complaint.
 */

import { Fault } from './state_machine';

/** Two minutes. This is the number on the wall and in the pack, so it lives here once. */
export const ACCEPT_WITHIN_SECONDS = 120;

/** A till that has not reported in for this long is treated as dead, not as a slow shopkeeper. */
export const TILL_SILENT_AFTER_MINUTES = 10;

/** After this, the order stops waiting and a person tells the customer. Nothing cancels itself. */
export const GIVE_UP_AFTER_SECONDS = 600;

/** What a shop must show before a rider is sent before acceptance. Earned, never granted. */
export const TRUSTED_AFTER_ORDERS = 20;
export const TRUSTED_MEDIAN_SECONDS = 45;

export type TillChannel = 'printer' | 'tablet' | 'whatsapp' | 'phone_call';

export interface Till {
  merchant_id: string;
  merchant_name: string;
  channel: TillChannel;
  /** Last time the device said it was alive. Null means it has never checked in. */
  last_seen: string | null;
  /** Who at the shop is called when the till does not answer. A device needs a person behind it. */
  person: string | null;
  phone: string | null;
}

export interface Offer {
  order_id: string;
  merchant_id: string;
  /** When the order was put in front of the shop. */
  sent_at: string;
  /** When somebody at the shop pressed accept. Null while it is still waiting. */
  accepted_at: string | null;
  /** Set when the shop says no, with the reason in their own words. */
  refused_at: string | null;
  refusal: string | null;
}

export type TillState =
  | 'accepted'
  | 'refused'
  | 'waiting'        // inside the two minutes, nothing is wrong
  | 'late'           // past two minutes, the shop has it and has not pressed accept
  | 'device_silent'  // the till has not checked in, so the shop probably never saw it
  | 'given_up';      // past the limit, a person owns telling the customer

export class TillError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TillError';
  }
}

function secondsBetween(fromISO: string, toISO?: string): number {
  const to = toISO ? Date.parse(toISO) : Date.now();
  return Math.floor((to - Date.parse(fromISO)) / 1000);
}

function tillIsSilent(till: Till, nowISO?: string): boolean {
  if (!till.last_seen) return true;
  return secondsBetween(till.last_seen, nowISO) > TILL_SILENT_AFTER_MINUTES * 60;
}

/**
 * Where this order stands at the counter.
 *
 * The order of these questions is the whole point. A dead till is checked BEFORE lateness, because
 * an order sitting on a printer with no paper is not a slow shop, and ringing the shopkeeper about
 * it teaches them the app is nonsense.
 */
export function tillState(offer: Offer, till: Till, nowISO?: string): TillState {
  if (offer.accepted_at) return 'accepted';
  if (offer.refused_at) return 'refused';

  const waited = secondsBetween(offer.sent_at, nowISO);
  if (waited < 0) throw new TillError('An order cannot have been offered in the future.');

  if (tillIsSilent(till, nowISO)) return 'device_silent';
  if (waited >= GIVE_UP_AFTER_SECONDS) return 'given_up';
  if (waited >= ACCEPT_WITHIN_SECONDS) return 'late';
  return 'waiting';
}

export interface Rung {
  at_seconds: number;
  who: string;
  what: string;
}

/**
 * The escalation ladder. Every rung names a person, because "the system escalates" is how an order
 * ends up owned by nobody.
 */
export function ladder(till: Till): Rung[] {
  const person = till.person ?? 'whoever is on the counter';
  const rings = till.phone ? `ring ${person} on ${till.phone}` : `ring the shop and ask for ${person}`;
  const device = till.channel === 'printer' ? 'printer' : 'device';
  return [
    { at_seconds: 0, who: 'the till', what: `The order prints and the ${device} sounds until somebody touches it.` },
    { at_seconds: ACCEPT_WITHIN_SECONDS, who: 'the till', what: 'It sounds again, louder, and the order goes to the top of the screen.' },
    { at_seconds: 240, who: 'the office', what: `Somebody in the office will ${rings}.` },
    { at_seconds: 420, who: 'the office', what: 'The office offers the order to another shop that has the same goods, and tells the customer it is being moved.' },
    { at_seconds: GIVE_UP_AFTER_SECONDS, who: 'the office', what: 'The office tells the customer plainly that the shop cannot supply it, refunds, and the order is recorded against the shop.' },
  ];
}

/** The one line the office reads. It says what is wrong and who to ring, not a status code. */
export function says(offer: Offer, till: Till, nowISO?: string): string {
  const state = tillState(offer, till, nowISO);
  const waited = secondsBetween(offer.sent_at, nowISO);
  const mins = Math.floor(waited / 60);
  const who = till.person ?? 'the counter';

  switch (state) {
    case 'accepted':
      return `${till.merchant_name} accepted ${offer.order_id} in ${secondsBetween(offer.sent_at, offer.accepted_at as string)} seconds.`;
    case 'refused':
      return `${till.merchant_name} cannot supply ${offer.order_id}. They said: ${offer.refusal ?? 'no reason given'}.`;
    case 'device_silent':
      return `The till at ${till.merchant_name} has not checked in, so they probably never saw ${offer.order_id}. This is the device, not the shop. ` +
        (till.phone
          ? `Ring ${who} on ${till.phone} and read the order out.`
          : 'Nobody has given a phone number for this shop, so there is no way to reach them. That needs fixing before they take another order.');
    case 'late':
      return `${till.merchant_name} has had ${offer.order_id} for ${mins} minute${mins === 1 ? '' : 's'} and has not accepted it. Ring ${who}.`;
    case 'given_up':
      return `${offer.order_id} sat at ${till.merchant_name} for ${mins} minutes. The customer needs telling now, by a person.`;
    default: {
      const left = ACCEPT_WITHIN_SECONDS - waited;
      return `${till.merchant_name} has ${left} second${left === 1 ? '' : 's'} left to accept ${offer.order_id}.`;
    }
  }
}

export interface Speed {
  merchant_id: string;
  merchant_name: string;
  orders: number;
  median_seconds: number | null;
  inside_two_minutes: number;
  missed: number;
  trusted: boolean;
  says: string;
}

/**
 * How fast a shop actually is. This is the number that decides whether a rider may be sent early,
 * and it is measured rather than agreed. A shop can lose the privilege the same way it earned it.
 */
export function speedOf(merchant_id: string, merchant_name: string, offers: Offer[]): Speed {
  const all = offers.filter((o) => o.merchant_id === merchant_id);
  const times = all
    .filter((o) => o.accepted_at)
    .map((o) => secondsBetween(o.sent_at, o.accepted_at as string))
    .sort((a, b) => a - b);

  const median = times.length
    ? times.length % 2
      ? times[(times.length - 1) / 2]
      : Math.round((times[times.length / 2 - 1] + times[times.length / 2]) / 2)
    : null;

  const inside = times.filter((t) => t <= ACCEPT_WITHIN_SECONDS).length;
  const trusted = all.length >= TRUSTED_AFTER_ORDERS && median !== null && median <= TRUSTED_MEDIAN_SECONDS;

  return {
    merchant_id,
    merchant_name,
    orders: all.length,
    median_seconds: median,
    inside_two_minutes: inside,
    missed: all.length - inside,
    trusted,
    says: median === null
      ? `${merchant_name} has not accepted an order yet, so there is nothing to judge them on.`
      : `${merchant_name} usually accepts in ${median} seconds, ${inside} of ${all.length} inside two minutes.`,
  };
}

/**
 * May a rider be sent before the shop has accepted.
 *
 * Sending early wins minutes and costs a rider standing at a counter. So it is allowed only where
 * the shop has proved it is fast, and never while the till is dead, because a rider would be sent
 * to collect an order the shop has not even seen.
 */
export function mayDispatch(offer: Offer, till: Till, speed: Speed, nowISO?: string): { may: boolean; says: string } {
  const state = tillState(offer, till, nowISO);

  if (state === 'accepted') return { may: true, says: `${till.merchant_name} has accepted it, so a rider can go.` };
  if (state === 'refused') return { may: false, says: `${till.merchant_name} cannot supply it, so there is nothing to collect.` };
  if (state === 'device_silent') {
    return { may: false, says: `The till at ${till.merchant_name} is not answering, so a rider would arrive at a shop that never saw the order. Somebody rings first.` };
  }
  if (speed.trusted) {
    return { may: true, says: `${till.merchant_name} accepts in about ${speed.median_seconds} seconds on ${speed.orders} orders, so a rider can start now.` };
  }
  return {
    may: false,
    says: `${till.merchant_name} has not accepted yet and has not earned an early rider, so nobody is sent to wait at the counter.`,
  };
}

/**
 * Whose fault an unaccepted order is, in the words brick 15 and brick 19 already use, so a lost
 * order settles the same way as every other lost order rather than becoming a special case.
 */
export function faultFor(offer: Offer, till: Till, nowISO?: string): { fault: Fault; says: string } {
  const state = tillState(offer, till, nowISO);

  if (state === 'refused' || state === 'given_up') {
    return { fault: 'merchant', says: `${till.merchant_name} could not supply it.` };
  }
  if (state === 'device_silent') {
    // A device Sprint put in the shop and did not keep working is Sprint's problem, not the shop's.
    return { fault: 'sprint', says: `The till Sprint installed at ${till.merchant_name} was not working, so this one is ours.` };
  }
  return { fault: 'none', says: 'Nothing has gone wrong yet.' };
}

/**
 * Every till and whether it is alive. This is the asset question the director sweep asks: where is
 * each device, who has it, and is it working right now. Dead ones sort to the top.
 */
export function deviceWall(tills: Till[], nowISO?: string): Array<{ till: Till; alive: boolean; says: string }> {
  return tills
    .map((till) => {
      const alive = !tillIsSilent(till, nowISO);
      const mins = till.last_seen ? Math.floor(secondsBetween(till.last_seen, nowISO) / 60) : null;
      return {
        till,
        alive,
        says: alive
          ? `${till.merchant_name}: the ${till.channel} is on, last heard from ${mins} minute${mins === 1 ? '' : 's'} ago.`
          : till.last_seen
            ? `${till.merchant_name}: the ${till.channel} has been quiet for ${mins} minutes. Nobody there can receive an order.`
            : `${till.merchant_name}: this ${till.channel} has never checked in. It may still be in a box.`,
      };
    })
    .sort((a, b) => Number(a.alive) - Number(b.alive));
}
