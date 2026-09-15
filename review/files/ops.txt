/**
 * Brick 34. The ops tower.
 *
 * This is the screen the director sweep asks for, and every question on it is one nobody at Sprint
 * can answer today:
 *
 *   Where is every order right now and who has it.
 *   Which orders are stuck, worst first, so somebody rings before the customer does.
 *   Output and failures PER RIDER, by name, so it is visible who is struggling rather than who
 *   complains loudest.
 *   Margin PER MERCHANT, so a shop quietly costing money through stock it does not have shows up.
 *   What is leaking, which is the failures nobody is carrying.
 *
 * It computes, it does not decide. Every number here falls out of the state machine, the fault on
 * each order and the settlement rules. Nothing is estimated and nothing is rounded into a headline.
 *
 * The one design rule: **the board leads with what needs a person, not with a total.** A dashboard
 * that opens with revenue teaches people to scroll past the order that has been sitting for an hour.
 */

import { OrderState, STATES, isStuck } from './state_machine';
import { Fault } from './state_machine';
import { SettleableOrder, settleOne } from './settlement';

export interface LiveOrder {
  order_id: string;
  state: OrderState;
  /** When it entered its current state. The clock that decides whether it is stuck. */
  since: string;
  courier_id: string | null;
  courier_name: string | null;
  merchant_id: string;
  merchant_name: string;
  place: string;
}

export interface Exception {
  order: LiveOrder;
  minutes: number;
  over_by: number;
  says: string;
}

/** Orders past the dwell limit for the state they are in, worst first. */
export function exceptionQueue(orders: LiveOrder[], nowISO?: string): Exception[] {
  const now = nowISO ? Date.parse(nowISO) : Date.now();
  return orders
    .filter((o) => isStuck(o.state, o.since, nowISO))
    .map((o) => {
      const minutes = Math.floor((now - Date.parse(o.since)) / 60000);
      const limit = STATES[o.state].stuckAfterMinutes as number;
      return {
        order: o,
        minutes,
        over_by: minutes - limit,
        says: `${o.order_id} has been ${o.state.replace(/_/g, ' ')} for ${minutes} minutes, ${minutes - limit} over` +
          (o.courier_name ? `, with ${o.courier_name}` : ', with nobody'),
      };
    })
    .sort((a, b) => b.over_by - a.over_by);
}

/** Everything live, grouped by where it is, so the board shows the shape of the day at a glance. */
export function byState(orders: LiveOrder[]): Array<{ state: OrderState; count: number; waiting: boolean }> {
  const m = new Map<OrderState, number>();
  for (const o of orders) m.set(o.state, (m.get(o.state) ?? 0) + 1);
  return [...m.entries()]
    .map(([state, count]) => ({ state, count, waiting: STATES[state].customerWaiting }))
    .sort((a, b) => b.count - a.count);
}

export interface RiderLine {
  courier_id: string;
  courier_name: string;
  live: number;
  delivered: number;
  failed_own_fault: number;
  failed_other: number;
  says: string;
}

/**
 * Output per rider, by name. Failures are split by whose fault, because a rider who takes the hard
 * addresses will have more failures that are not theirs, and punishing that is how you lose them.
 */
export function perRider(live: LiveOrder[], done: SettleableOrder[], riderOf: Map<string, { id: string; name: string }>): RiderLine[] {
  const m = new Map<string, RiderLine>();
  const touch = (id: string, name: string) =>
    m.get(id) ?? m.set(id, { courier_id: id, courier_name: name, live: 0, delivered: 0, failed_own_fault: 0, failed_other: 0, says: '' }).get(id)!;

  for (const o of live) {
    if (!o.courier_id) continue;
    touch(o.courier_id, o.courier_name ?? o.courier_id).live += 1;
  }
  for (const d of done) {
    const r = riderOf.get(d.order_id);
    if (!r) continue;
    const line = touch(r.id, r.name);
    if (d.delivered) line.delivered += 1;
    else if (d.fault === 'rider') line.failed_own_fault += 1;
    else line.failed_other += 1;
  }

  return [...m.values()].map((l) => {
    const finished = l.delivered + l.failed_own_fault + l.failed_other;
    l.says = finished === 0
      ? `${l.courier_name}: ${l.live} live, nothing finished yet`
      : `${l.courier_name}: ${l.delivered} delivered of ${finished}` +
        (l.failed_own_fault ? `, ${l.failed_own_fault} their own` : '') +
        (l.failed_other ? `, ${l.failed_other} not their fault` : '');
    return l;
  }).sort((a, b) => b.delivered - a.delivered || b.live - a.live);
}

export interface MerchantLine {
  merchant_id: string;
  merchant_name: string;
  orders: number;
  goods: number;
  /** What Sprint earned in delivery fees on this merchant's orders. */
  fees: number;
  /** What Sprint carried because of this merchant's failures. */
  cost_of_their_failures: number;
  failures: number;
  says: string;
}

/**
 * Margin per merchant. A shop that keeps running out of stock costs Sprint rider time and goodwill,
 * and until now there was no way to see which one.
 */
export function perMerchant(done: SettleableOrder[]): MerchantLine[] {
  const m = new Map<string, MerchantLine>();
  for (const o of done) {
    const l = m.get(o.merchant_id) ?? {
      merchant_id: o.merchant_id, merchant_name: o.merchant_name,
      orders: 0, goods: 0, fees: 0, cost_of_their_failures: 0, failures: 0, says: '',
    };
    const s = settleOne(o);
    l.orders += 1;
    l.goods += s.merchant;
    l.fees += s.sprint_fee;
    if (!o.delivered) {
      l.failures += 1;
      if (o.fault === 'merchant') l.cost_of_their_failures += o.delivery_fee;
    }
    m.set(o.merchant_id, l);
  }
  return [...m.values()].map((l) => {
    const rate = l.orders ? Math.round((l.failures / l.orders) * 100) : 0;
    l.says = `${l.merchant_name}: ${l.orders} orders, ${rate} percent failed` +
      (l.cost_of_their_failures ? `, costing Sprint ${(l.cost_of_their_failures / 100).toFixed(2)} pula in wasted trips` : '');
    return l;
  }).sort((a, b) => b.cost_of_their_failures - a.cost_of_their_failures || b.orders - a.orders);
}

/** Failures by whose fault, which is the leak nobody has ever measured. */
export function failuresByFault(done: SettleableOrder[]): Array<{ fault: Fault; count: number; cost: number }> {
  const m = new Map<Fault, { fault: Fault; count: number; cost: number }>();
  for (const o of done.filter((d) => !d.delivered)) {
    const e = m.get(o.fault) ?? { fault: o.fault, count: 0, cost: 0 };
    e.count += 1;
    e.cost += settleOne(o).sprint_absorbs;
    m.set(o.fault, e);
  }
  return [...m.values()].sort((a, b) => b.cost - a.cost || b.count - a.count);
}

/**
 * The single thing to do right now. A board that shows twenty numbers and no instruction gets
 * scrolled past, so this names one order and one action.
 */
export function theOneThing(orders: LiveOrder[], nowISO?: string): string {
  const q = exceptionQueue(orders, nowISO);
  if (!q.length) {
    const waiting = orders.filter((o) => STATES[o.state].customerWaiting).length;
    return waiting
      ? `Nothing is stuck. ${waiting} customer${waiting === 1 ? ' is' : 's are'} waiting and all of them are inside their time.`
      : 'Nothing is stuck and nobody is waiting.';
  }
  const worst = q[0];
  const who = worst.order.courier_name ?? 'nobody';
  return `Ring ${who} about ${worst.order.order_id}. It has been ${worst.order.state.replace(/_/g, ' ')} for ${worst.minutes} minutes, which is ${worst.over_by} over, going to ${worst.order.place}.`;
}
