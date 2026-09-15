# Sprint delivery engine, part 6 of 6

A customer facing delivery platform for Gaborone, Botswana. One app, many kinds of
shop, the way Checkers Sixty60 works: a shop has a KIND and each kind carries its
own rules. A pharmacy needs a pharmacist, a bottle store needs a licence and
trading hours, a pet shop needs neither.

TypeScript on NestJS. 271 tests passing, tsc clean.
Public copy: https://github.com/94luther/sprint-alpha-review

**This is part 6 of 6.** The engine is split so that nothing gets silently
cut. Review only what is in THIS file. If something here clearly depends on code
you cannot see, say so rather than guessing at it.

## What I want from you

Attack it. I am not looking for encouragement, I am looking for what is wrong.
In the order of what would cost me most:

1. **Money.** Can any path take a payment twice, take the wrong amount, pay a
   merchant what they are not owed, or lose a thebe to rounding? Money is whole
   integers everywhere on purpose. Tell me where that breaks.
2. **The two money models.** settlement.ts pays a merchant one hundred percent of
   the goods and gives the platform only the delivery fee. A separate ledger
   splits the same order 75 / 18 / 7. They disagree by a quarter of every basket.
   Only the first pays anybody today. Which should win, and what breaks either way?
3. **The regulator gate.** Pharmacy is blocked in code until the medicines
   regulator answers in writing. Can that be got around by seed data, by a caller,
   or by a screen? One test says it cannot. Is the test wrong?
4. **Credit and limits.** corporate.ts lets a company order on account. Can an
   account be pushed past its limit by concurrent orders, by refunds, or by a race?
5. **Anything a passing test is defending that should not exist.** A single note
   cash rule capped every order at 200 pula for weeks while thirteen tests passed
   over it.

Do not tell me the code is clean. Tell me the failure, the input that causes it,
and what it costs.

## Context that is not in the code

- No merchant has signed anything. Every shop name and price is invented.
- No payment rail is switched on. Cash and on account are the only live ones, and
  every other rail refuses by name rather than pretending to work.
- This is one person's project. There is no team and no production deployment.
- Money is thebe as whole integers. One hundred thebe is one pula.

## The 9 files in THIS part

**When you answer, tell me how many of these you actually read.**

1. `api/src/orders/state_machine.ts`
2. `api/src/orders/till.test.ts`
3. `api/src/orders/till.ts`
4. `api/src/orders/tracking.test.ts`
5. `api/src/orders/tracking.ts`
6. `api/src/simulator/simulator.module.ts`
7. `api/src/simulator/simulator.service.ts`
8. `api/src/tracking/tracking.gateway.ts`
9. `api/src/tracking/tracking.module.ts`


---

## api/src/orders/state_machine.ts

```typescript
/**
 * Brick 14. The order state machine, with the exception states.
 *
 * The council's finding, agreed independently by two seats, was that the missing exception
 * workflow (wrong address, out of stock, rider breakdown, customer absent, refund) would
 * collapse operations. The old flow had six states and every one of them was the happy path:
 * an order that went wrong had nowhere to go and simply sat there.
 *
 * Three guarantees are made here, and each one is proved by a test rather than asserted:
 *
 *   1. NO DEAD ENDS. Every state that is not terminal has at least one way out. An order can
 *      always be moved forward or closed out by somebody.
 *   2. NO ORPHANS. Every state is reachable from 'placed'. No state exists that nothing can
 *      ever enter.
 *   3. NOTHING SITS SILENTLY. Every non-terminal state carries a dwell limit in minutes.
 *      Past that, the order belongs on the exception queue in the ops tower.
 *
 * It also carries the hook for brick 15, who pays when a delivery fails: any transition into
 * a failure path must name a fault, and apply() refuses the move without one. Money is never
 * split (brick 19) on an order whose fault was never decided.
 *
 * Deliberately free of NestJS imports so it can be tested on its own and reused by the rider
 * app, the ops tower and the ledger without dragging the framework along.
 */

export type OrderState =
  // the way it goes when nothing goes wrong
  | 'placed'
  | 'paid'
  | 'dispatch_offered'
  | 'dispatch_accepted'
  | 'at_merchant'
  | 'picked_up'
  | 'at_door'
  | 'delivered'
  // the way it actually goes often enough to matter
  | 'payment_failed'
  | 'stock_problem'
  | 'address_problem'
  | 'customer_absent'
  | 'rider_failed'
  | 'returning'
  | 'returned'
  | 'refund_due'
  // the end
  | 'cancelled'
  | 'closed';

/** Who is allowed to move an order. 'system' is the platform acting on its own. */
export type Actor = 'customer' | 'courier' | 'merchant' | 'ops' | 'system';

/** Brick 15. Who carries the cost when this order fails. 'none' means nobody is at fault. */
export type Fault = 'merchant' | 'customer' | 'sprint' | 'rider' | 'none';

export interface Transition {
  from: OrderState;
  event: string;
  to: OrderState;
  actors: Actor[];
  /** When true, apply() refuses the move unless a fault is named. */
  faultRequired?: boolean;
  /** Plain words, so an ops screen can say what happened without a translation table. */
  says: string;
}

export interface StateMeta {
  terminal: boolean;
  /** Minutes an order may sit here before the ops tower is told. null for terminal states. */
  stuckAfterMinutes: number | null;
  /** Is a customer still waiting on an answer while the order sits here. */
  customerWaiting: boolean;
  says: string;
}

export const STATES: Record<OrderState, StateMeta> = {
  placed:            { terminal: false, stuckAfterMinutes: 10,   customerWaiting: true,  says: 'Order placed, payment not settled yet' },
  payment_failed:    { terminal: false, stuckAfterMinutes: 60,   customerWaiting: true,  says: 'Payment did not go through' },
  paid:              { terminal: false, stuckAfterMinutes: 5,    customerWaiting: true,  says: 'Paid, waiting to go to a rider' },
  dispatch_offered:  { terminal: false, stuckAfterMinutes: 3,    customerWaiting: true,  says: 'Offered to riders, none has taken it yet' },
  dispatch_accepted: { terminal: false, stuckAfterMinutes: 20,   customerWaiting: true,  says: 'A rider is on the way to the shop' },
  at_merchant:       { terminal: false, stuckAfterMinutes: 15,   customerWaiting: true,  says: 'Rider is at the shop waiting for the order' },
  stock_problem:     { terminal: false, stuckAfterMinutes: 10,   customerWaiting: true,  says: 'The shop cannot supply something, the customer must choose' },
  picked_up:         { terminal: false, stuckAfterMinutes: 45,   customerWaiting: true,  says: 'Rider has the order and is on the road' },
  at_door:           { terminal: false, stuckAfterMinutes: 10,   customerWaiting: true,  says: 'Rider is at the address' },
  address_problem:   { terminal: false, stuckAfterMinutes: 15,   customerWaiting: true,  says: 'The rider cannot find the place' },
  customer_absent:   { terminal: false, stuckAfterMinutes: 10,   customerWaiting: true,  says: 'Nobody is answering at the address' },
  rider_failed:      { terminal: false, stuckAfterMinutes: 10,   customerWaiting: true,  says: 'The rider cannot finish this one' },
  returning:         { terminal: false, stuckAfterMinutes: 90,   customerWaiting: false, says: 'Goods are going back to the shop' },
  returned:          { terminal: false, stuckAfterMinutes: 1440, customerWaiting: false, says: 'Goods are back with the shop, money not settled' },
  delivered:         { terminal: false, stuckAfterMinutes: 1440, customerWaiting: false, says: 'Handed over, not closed off yet' },
  refund_due:        { terminal: false, stuckAfterMinutes: 2880, customerWaiting: true,  says: 'Money is owed back to somebody' },
  cancelled:         { terminal: true,  stuckAfterMinutes: null, customerWaiting: false, says: 'Cancelled before anyone was out of pocket' },
  closed:            { terminal: true,  stuckAfterMinutes: null, customerWaiting: false, says: 'Finished and settled' },
};

export const TRANSITIONS: Transition[] = [
  // placed
  { from: 'placed', event: 'pay_succeeded', to: 'paid', actors: ['system'], says: 'Payment cleared' },
  { from: 'placed', event: 'pay_failed', to: 'payment_failed', actors: ['system'], says: 'Payment was refused' },
  { from: 'placed', event: 'customer_cancelled', to: 'cancelled', actors: ['customer', 'ops'], says: 'Customer changed their mind before paying' },

  // payment_failed
  { from: 'payment_failed', event: 'retry_payment', to: 'placed', actors: ['customer', 'ops'], says: 'Trying the payment again' },
  { from: 'payment_failed', event: 'abandon', to: 'cancelled', actors: ['customer', 'ops', 'system'], says: 'Payment was never completed' },

  // paid
  { from: 'paid', event: 'offer_to_riders', to: 'dispatch_offered', actors: ['system', 'ops'], says: 'Sent to the riders nearby' },
  { from: 'paid', event: 'merchant_rejected', to: 'stock_problem', actors: ['merchant', 'ops'], faultRequired: true, says: 'The shop cannot take the order' },
  { from: 'paid', event: 'customer_cancelled', to: 'refund_due', actors: ['customer', 'ops'], faultRequired: true, says: 'Cancelled after paying' },

  // dispatch_offered
  { from: 'dispatch_offered', event: 'rider_accepted', to: 'dispatch_accepted', actors: ['courier'], says: 'A rider took it' },
  { from: 'dispatch_offered', event: 'offer_expired', to: 'dispatch_offered', actors: ['system'], says: 'Nobody took it, offering again' },
  { from: 'dispatch_offered', event: 'no_rider_available', to: 'rider_failed', actors: ['system', 'ops'], faultRequired: true, says: 'No rider can take this one' },
  { from: 'dispatch_offered', event: 'customer_cancelled', to: 'refund_due', actors: ['customer', 'ops'], faultRequired: true, says: 'Cancelled while waiting for a rider' },

  // dispatch_accepted
  { from: 'dispatch_accepted', event: 'rider_arrived_at_shop', to: 'at_merchant', actors: ['courier'], says: 'Rider reached the shop' },
  { from: 'dispatch_accepted', event: 'rider_dropped', to: 'dispatch_offered', actors: ['courier', 'ops'], faultRequired: true, says: 'Rider gave it up, offering again' },
  { from: 'dispatch_accepted', event: 'customer_cancelled', to: 'refund_due', actors: ['customer', 'ops'], faultRequired: true, says: 'Cancelled while the rider was on the way' },

  // at_merchant
  { from: 'at_merchant', event: 'collected', to: 'picked_up', actors: ['courier'], says: 'Rider has the goods' },
  { from: 'at_merchant', event: 'out_of_stock', to: 'stock_problem', actors: ['merchant', 'courier', 'ops'], faultRequired: true, says: 'Something is not available' },
  { from: 'at_merchant', event: 'rider_failed_at_shop', to: 'dispatch_offered', actors: ['courier', 'ops'], faultRequired: true, says: 'Rider cannot carry on, offering again' },

  // stock_problem
  { from: 'stock_problem', event: 'substitute_accepted', to: 'at_merchant', actors: ['customer'], says: 'Customer accepted a swap' },
  { from: 'stock_problem', event: 'line_dropped', to: 'at_merchant', actors: ['customer', 'ops', 'merchant'], says: 'Item taken off the order, the rest goes' },
  { from: 'stock_problem', event: 'cancel_order', to: 'refund_due', actors: ['customer', 'ops'], faultRequired: true, says: 'Order dropped over stock' },

  // picked_up
  { from: 'picked_up', event: 'arrived', to: 'at_door', actors: ['courier'], says: 'Rider is at the address' },
  { from: 'picked_up', event: 'address_unclear', to: 'address_problem', actors: ['courier'], says: 'Rider cannot work out where to go' },
  { from: 'picked_up', event: 'rider_failed_en_route', to: 'returning', actors: ['courier', 'ops'], faultRequired: true, says: 'Rider cannot finish, goods going back' },

  // at_door
  { from: 'at_door', event: 'handed_over', to: 'delivered', actors: ['courier'], says: 'Given to the customer' },
  { from: 'at_door', event: 'nobody_there', to: 'customer_absent', actors: ['courier'], says: 'No answer at the address' },
  { from: 'at_door', event: 'wrong_address', to: 'address_problem', actors: ['courier'], says: 'This is not the right place' },
  { from: 'at_door', event: 'id_check_failed', to: 'returning', actors: ['courier'], faultRequired: true, says: 'Identity check failed, liquor or medicine cannot be handed over' },

  // address_problem
  { from: 'address_problem', event: 'address_fixed', to: 'picked_up', actors: ['customer', 'courier', 'ops'], says: 'New directions given, rider going again' },
  { from: 'address_problem', event: 'give_up', to: 'returning', actors: ['courier', 'ops'], faultRequired: true, says: 'The address could not be found' },

  // customer_absent
  { from: 'customer_absent', event: 'customer_answered', to: 'at_door', actors: ['courier', 'customer'], says: 'Customer came to the door' },
  { from: 'customer_absent', event: 'wait_expired', to: 'returning', actors: ['courier', 'ops'], faultRequired: true, says: 'Waited long enough, going back' },

  // rider_failed
  { from: 'rider_failed', event: 'reassigned', to: 'dispatch_offered', actors: ['ops'], says: 'Given to the riders again' },
  { from: 'rider_failed', event: 'cannot_recover', to: 'refund_due', actors: ['ops'], faultRequired: true, says: 'Nobody can deliver this one today' },

  // returning and returned
  { from: 'returning', event: 'back_at_merchant', to: 'returned', actors: ['courier'], says: 'Goods are back with the shop' },
  { from: 'returned', event: 'settle', to: 'refund_due', actors: ['ops', 'system'], faultRequired: true, says: 'Working out who pays' },

  // delivered
  { from: 'delivered', event: 'close', to: 'closed', actors: ['system', 'ops'], says: 'Order finished' },
  { from: 'delivered', event: 'dispute_raised', to: 'refund_due', actors: ['customer', 'ops'], faultRequired: true, says: 'Customer says something was wrong' },

  // refund_due
  { from: 'refund_due', event: 'refunded', to: 'closed', actors: ['ops', 'system'], says: 'Money returned, order finished' },
  { from: 'refund_due', event: 'no_refund_owed', to: 'closed', actors: ['ops'], faultRequired: true, says: 'Decided that nothing is owed back' },
];

export interface OrderMove {
  state: OrderState;
  fault: Fault;
  event: string;
  actor: Actor;
  at: string;
  says: string;
}

export class TransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransitionError';
  }
}

export function isTerminal(state: OrderState): boolean {
  return STATES[state].terminal;
}

export function stuckAfter(state: OrderState): number | null {
  return STATES[state].stuckAfterMinutes;
}

/** Has this order been sitting in one state longer than that state allows. */
export function isStuck(state: OrderState, sinceISO: string, nowISO?: string): boolean {
  const limit = stuckAfter(state);
  if (limit === null) return false;
  const since = Date.parse(sinceISO);
  const now = nowISO ? Date.parse(nowISO) : Date.now();
  if (Number.isNaN(since) || Number.isNaN(now)) return false;
  return now - since > limit * 60_000;
}

export function transitionsFrom(state: OrderState): Transition[] {
  return TRANSITIONS.filter((t) => t.from === state);
}

/** What this actor is allowed to do right now. Drives the buttons an app shows. */
export function allowedEvents(state: OrderState, actor?: Actor): Transition[] {
  return transitionsFrom(state).filter((t) => !actor || t.actors.includes(actor));
}

export function can(state: OrderState, event: string, actor?: Actor): boolean {
  return allowedEvents(state, actor).some((t) => t.event === event);
}

/**
 * Move the order. Throws rather than returning a wrong state, because a silent no op here is
 * exactly how an order gets stuck, which is the thing this file exists to prevent.
 */
export function apply(
  state: OrderState,
  event: string,
  opts: { actor: Actor; fault?: Fault; at?: string },
): OrderMove {
  const { actor } = opts;
  if (isTerminal(state)) {
    throw new TransitionError(`Order is ${state} and finished, ${event} cannot be applied`);
  }
  const match = transitionsFrom(state).find((t) => t.event === event);
  if (!match) {
    const open = transitionsFrom(state).map((t) => t.event).join(', ');
    throw new TransitionError(`${event} is not possible from ${state}. Possible: ${open}`);
  }
  if (!match.actors.includes(actor)) {
    throw new TransitionError(`${actor} may not do ${event} from ${state}. Allowed: ${match.actors.join(', ')}`);
  }
  if (match.faultRequired && (opts.fault === undefined || opts.fault === null)) {
    throw new TransitionError(
      `${event} needs somebody to carry the cost. Pass a fault of merchant, customer, sprint, rider or none.`,
    );
  }
  return {
    state: match.to,
    fault: match.faultRequired ? (opts.fault as Fault) : 'none',
    event,
    actor,
    at: opts.at ?? new Date().toISOString(),
    says: match.says,
  };
}

/** Guarantee 1. Non terminal states with no way out. Must always be empty. */
export function deadEnds(): OrderState[] {
  return (Object.keys(STATES) as OrderState[]).filter(
    (s) => !STATES[s].terminal && transitionsFrom(s).length === 0,
  );
}

/** Guarantee 2. States nothing can ever reach from 'placed'. Must always be empty. */
export function unreachable(): OrderState[] {
  const seen = new Set<OrderState>(['placed']);
  const queue: OrderState[] = ['placed'];
  while (queue.length) {
    const s = queue.shift() as OrderState;
    for (const t of transitionsFrom(s)) {
      if (!seen.has(t.to)) {
        seen.add(t.to);
        queue.push(t.to);
      }
    }
  }
  return (Object.keys(STATES) as OrderState[]).filter((s) => !seen.has(s));
}

/** Guarantee 3. Non terminal states with no dwell limit. Must always be empty. */
export function untimed(): OrderState[] {
  return (Object.keys(STATES) as OrderState[]).filter(
    (s) => !STATES[s].terminal && STATES[s].stuckAfterMinutes === null,
  );
}

/** Can this order still reach a terminal state from here. Must be true everywhere. */
export function canReachEnd(from: OrderState): boolean {
  const seen = new Set<OrderState>([from]);
  const queue: OrderState[] = [from];
  while (queue.length) {
    const s = queue.shift() as OrderState;
    if (STATES[s].terminal) return true;
    for (const t of transitionsFrom(s)) {
      if (!seen.has(t.to)) {
        seen.add(t.to);
        queue.push(t.to);
      }
    }
  }
  return false;
}
```

---

## api/src/orders/till.test.ts

```typescript
/**
 * Brick 32's proof. Run with:
 *   npm --prefix api run test:orders
 *
 * The test that matters most is the third one. A dead till and a slow shopkeeper look identical on
 * every delivery dashboard in this market, and they need two different phone calls.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tillState, ladder, says, speedOf, mayDispatch, faultFor, deviceWall,
  ACCEPT_WITHIN_SECONDS, GIVE_UP_AFTER_SECONDS, TRUSTED_AFTER_ORDERS,
  Till, Offer, TillError,
} from './till';

const NOW = '2026-09-12T09:00:00.000Z';
const ago = (secs: number) => new Date(Date.parse(NOW) - secs * 1000).toISOString();

const alive: Till = {
  merchant_id: 'm1', merchant_name: 'A grocer', channel: 'printer',
  last_seen: ago(30), person: 'Neo', phone: '71 234 567',
};
const dead: Till = { ...alive, merchant_id: 'm2', merchant_name: 'A pharmacy', last_seen: ago(40 * 60) };
const unboxed: Till = { ...alive, merchant_id: 'm3', merchant_name: 'A bottle store', channel: 'tablet', last_seen: null };

const offer = (over: Partial<Offer> = {}): Offer => ({
  order_id: 'o1', merchant_id: 'm1', sent_at: ago(10),
  accepted_at: null, refused_at: null, refusal: null, ...over,
});

test('inside two minutes nothing is wrong and the shop is told how long is left', () => {
  const o = offer({ sent_at: ago(30) });
  assert.equal(tillState(o, alive, NOW), 'waiting');
  assert.match(says(o, alive, NOW), /90 seconds left/);
});

test('past two minutes the shop is late and the line names who to ring', () => {
  const o = offer({ sent_at: ago(ACCEPT_WITHIN_SECONDS + 60) });
  assert.equal(tillState(o, alive, NOW), 'late');
  assert.match(says(o, alive, NOW), /has not accepted it/);
  assert.match(says(o, alive, NOW), /Ring Neo/);
});

test('a dead till is a dead device, not a slow shopkeeper, and it is checked first', () => {
  const o = offer({ merchant_id: 'm2', sent_at: ago(30) });
  // Only 30 seconds gone, so lateness is not even in question yet. The device still wins.
  assert.equal(tillState(o, dead, NOW), 'device_silent');
  const line = says(o, dead, NOW);
  assert.match(line, /never saw/);
  assert.match(line, /This is the device, not the shop/);
  assert.match(line, /read the order out/);
});

test('a till with no phone number behind it says so, because there is then no way to reach anyone', () => {
  const orphan: Till = { ...dead, phone: null, person: null };
  const line = says(offer({ merchant_id: orphan.merchant_id }), orphan, NOW);
  assert.match(line, /no way to reach them/);
  assert.match(line, /before they take another order/);
});

test('past the limit it stops waiting and a person owns telling the customer', () => {
  const o = offer({ sent_at: ago(GIVE_UP_AFTER_SECONDS + 60) });
  assert.equal(tillState(o, alive, NOW), 'given_up');
  assert.match(says(o, alive, NOW), /needs telling now, by a person/);
});

test('accepting and refusing both end the clock, and a refusal carries the shop own words', () => {
  const yes = offer({ sent_at: ago(45), accepted_at: ago(20) });
  assert.equal(tillState(yes, alive, NOW), 'accepted');
  assert.match(says(yes, alive, NOW), /accepted o1 in 25 seconds/);

  const no = offer({ refused_at: ago(5), refusal: 'no stock of that size' });
  assert.equal(tillState(no, alive, NOW), 'refused');
  assert.match(says(no, alive, NOW), /no stock of that size/);
});

test('every rung of the ladder names somebody, and the last one is telling the customer', () => {
  const rungs = ladder(alive);
  assert.ok(rungs.length >= 4);
  for (const r of rungs) {
    assert.ok(r.who.length > 2, 'a rung with no owner is how an order ends up owned by nobody');
    assert.ok(r.what.length > 15);
  }
  assert.deepEqual(rungs.map((r) => r.at_seconds), [...rungs.map((r) => r.at_seconds)].sort((a, b) => a - b));
  assert.match(rungs[rungs.length - 1].what, /tells the customer/);
  assert.match(rungs[2].what, /71 234 567/, 'the office rung carries the actual number to ring');
});

test('a shop speed is measured, and trust is earned over real orders rather than agreed', () => {
  const fast: Offer[] = Array.from({ length: TRUSTED_AFTER_ORDERS }, (_, i) => ({
    order_id: `f${i}`, merchant_id: 'm1', sent_at: ago(600), accepted_at: ago(600 - 40),
    refused_at: null, refusal: null,
  }));
  const s = speedOf('m1', 'A grocer', fast);
  assert.equal(s.median_seconds, 40);
  assert.equal(s.orders, TRUSTED_AFTER_ORDERS);
  assert.equal(s.inside_two_minutes, TRUSTED_AFTER_ORDERS);
  assert.equal(s.trusted, true);
  assert.match(s.says, /usually accepts in 40 seconds/);
});

test('a fast shop with too few orders has not earned an early rider yet', () => {
  const few: Offer[] = Array.from({ length: 3 }, (_, i) => ({
    order_id: `f${i}`, merchant_id: 'm1', sent_at: ago(600), accepted_at: ago(600 - 20),
    refused_at: null, refusal: null,
  }));
  const s = speedOf('m1', 'A grocer', few);
  assert.equal(s.median_seconds, 20, 'quick, but on almost nothing');
  assert.equal(s.trusted, false);
});

test('a shop that has never accepted anything is not judged on a number it has not earned', () => {
  const s = speedOf('m9', 'A new shop', []);
  assert.equal(s.median_seconds, null, 'never a zero, because zero would read as instant');
  assert.equal(s.trusted, false);
  assert.match(s.says, /nothing to judge them on/);
});

test('no rider is sent to a counter that has not accepted, unless the shop earned it', () => {
  const slow = speedOf('m1', 'A grocer', []);
  const waiting = offer({ sent_at: ago(30) });
  assert.equal(mayDispatch(waiting, alive, slow, NOW).may, false);
  assert.match(mayDispatch(waiting, alive, slow, NOW).says, /nobody is sent to wait at the counter/);

  const fast = speedOf('m1', 'A grocer', Array.from({ length: TRUSTED_AFTER_ORDERS }, (_, i) => ({
    order_id: `f${i}`, merchant_id: 'm1', sent_at: ago(600), accepted_at: ago(600 - 30),
    refused_at: null, refusal: null,
  })));
  assert.equal(mayDispatch(waiting, alive, fast, NOW).may, true);
});

test('a trusted shop still gets no rider while its till is dead', () => {
  const fast = speedOf('m2', 'A pharmacy', Array.from({ length: TRUSTED_AFTER_ORDERS }, (_, i) => ({
    order_id: `f${i}`, merchant_id: 'm2', sent_at: ago(600), accepted_at: ago(600 - 30),
    refused_at: null, refusal: null,
  })));
  const d = mayDispatch(offer({ merchant_id: 'm2' }), dead, fast, NOW);
  assert.equal(d.may, false, 'the rider would arrive at a shop that never saw the order');
  assert.match(d.says, /Somebody rings first/);
});

test('a till Sprint installed and did not keep working is Sprint fault, not the shop', () => {
  assert.equal(faultFor(offer({ merchant_id: 'm2' }), dead, NOW).fault, 'sprint');
  assert.match(faultFor(offer({ merchant_id: 'm2' }), dead, NOW).says, /this one is ours/);

  const givenUp = offer({ sent_at: ago(GIVE_UP_AFTER_SECONDS + 1) });
  assert.equal(faultFor(givenUp, alive, NOW).fault, 'merchant');
  assert.equal(faultFor(offer({ sent_at: ago(10) }), alive, NOW).fault, 'none');
});

test('the device wall answers where every till is and whether it works, dead ones first', () => {
  const wall = deviceWall([alive, dead, unboxed], NOW);
  assert.equal(wall[0].alive, false, 'what is broken comes first, not last');
  assert.equal(wall[wall.length - 1].alive, true);
  const box = wall.find((w) => w.till.merchant_id === 'm3');
  assert.match(box!.says, /never checked in/);
  assert.match(box!.says, /still be in a box/, 'a device nobody unpacked is a real and common state');
  assert.match(wall.find((w) => w.till.merchant_id === 'm2')!.says, /quiet for 40 minutes/);
});

test('an order offered in the future is refused rather than quietly treated as fresh', () => {
  assert.throws(() => tillState(offer({ sent_at: new Date(Date.parse(NOW) + 60000).toISOString() }), alive, NOW), TillError);
});

test('every line a person reads is plain and has no dashes', () => {
  const lines = [
    says(offer({ sent_at: ago(30) }), alive, NOW),
    says(offer({ sent_at: ago(300) }), alive, NOW),
    says(offer({ merchant_id: 'm2' }), dead, NOW),
    deviceWall([unboxed], NOW)[0].says,
    ...ladder(alive).map((r) => r.what),
  ];
  for (const l of lines) {
    assert.ok(l.length > 15);
    assert.equal(l.includes(' - '), false, `dash in: ${l}`);
  }
});
```

---

## api/src/orders/till.ts

```typescript
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
```

---

## api/src/orders/tracking.test.ts

```typescript
/**
 * Brick 20's proof. Run with:
 *   npm --prefix api run test:orders
 *
 * The first two tests are the council ruling, written so it cannot be redesigned away.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrivalWindow, panels, shouldConfirmAddress, whatsappLine, isSafeForWhatsapp } from './tracking';
import { create, confirmAtDoor, AddressPassport } from './address_passport';

const T0 = '2026-09-13T12:00:00.000Z';
const typed: AddressPassport = create({
  id: 'p1', customer_id: 'c1', label: 'Home',
  plot: 'Plot 2147, Block 8', landmark: 'Blue gate opposite ABC Hardware', at: T0,
});
const confirmed = confirmAtDoor(typed, 'courier_amo', T0);

test('the council ruling: the arrival window is above the map, always', () => {
  const w = arrivalWindow('picked_up', T0, T0);
  const p = panels('picked_up', confirmed, true, w);
  const arrival = p.find((x) => x.kind === 'arrival');
  const map = p.find((x) => x.kind === 'map');
  assert.ok(arrival && map, 'both should be on screen');
  assert.ok(arrival!.rank < map!.rank, 'the map must never be the headline');
});

test('the council ruling: a problem outranks everything, including the time', () => {
  const w = arrivalWindow('address_problem', T0, T0);
  const p = panels('address_problem', typed, true, w);
  assert.equal(p[0].kind, 'problem');
  assert.match(p[0].says, /cannot find the place/);
});

test('the answer is a window, never a countdown', () => {
  const w = arrivalWindow('picked_up', T0, T0)!;
  assert.ok(Date.parse(w.to) > Date.parse(w.from), 'it must be a range');
  assert.match(w.says, /between \d\d:\d\d and \d\d:\d\d/);
  assert.equal(/\bin \d+ minutes?\b/.test(w.says), false, 'never a countdown');
});

test('running late widens the window instead of sliding it', () => {
  const onTime = arrivalWindow('picked_up', T0, '2026-09-13T12:10:00.000Z')!;
  const late = arrivalWindow('picked_up', T0, '2026-09-13T13:10:00.000Z')!;
  const span = (w: typeof onTime) => Date.parse(w.to) - Date.parse(w.from);
  assert.equal(onTime.confidence, 'firm');
  assert.ok(span(late) > span(onTime), 'the uncertainty should be visible, not hidden');
  assert.match(late.says, /Running a bit behind|cannot give you a good time/);
});

test('when it is really late the app admits it does not know', () => {
  const w = arrivalWindow('picked_up', T0, '2026-09-13T14:30:00.000Z')!;
  assert.equal(w.confidence, 'unknown');
  assert.match(w.says, /cannot give you a good time/);
});

test('no arrival time is offered once there is nothing to arrive', () => {
  for (const s of ['delivered', 'cancelled', 'closed', 'returning', 'refund_due'] as const) {
    assert.equal(arrivalWindow(s, T0, T0), null, `${s} should not show a time`);
  }
});

test('the address is checked early, while there is still time to act', () => {
  assert.equal(shouldConfirmAddress('paid', typed, false), true);
  assert.equal(shouldConfirmAddress('at_merchant', typed, false), true);
  assert.equal(shouldConfirmAddress('picked_up', typed, false), false, 'too late to be useful');
  assert.equal(shouldConfirmAddress('at_door', typed, false), false);
});

test('a customer is asked once, and never about an address a rider already confirmed', () => {
  assert.equal(shouldConfirmAddress('paid', typed, true), false, 'asked twice teaches people to ignore it');
  assert.equal(shouldConfirmAddress('paid', confirmed, false), false, 'a rider has already been there');
  assert.equal(shouldConfirmAddress('paid', null, false), false);
});

test('the confirm panel names the landmark, because that is what people recognise', () => {
  const p = panels('paid', typed, false, arrivalWindow('paid', T0, T0));
  const confirm = p.find((x) => x.kind === 'confirm_address');
  assert.ok(confirm);
  assert.match(confirm!.says, /Blue gate opposite ABC Hardware/);
});

test('the map only appears once there is a rider to follow', () => {
  for (const s of ['placed', 'paid', 'dispatch_offered'] as const) {
    assert.equal(panels(s, confirmed, true, arrivalWindow(s, T0, T0)).some((x) => x.kind === 'map'), false,
      `${s} has no rider yet, so a map is a blank promise`);
  }
  assert.equal(panels('picked_up', confirmed, true, arrivalWindow('picked_up', T0, T0)).some((x) => x.kind === 'map'), true);
});

test('panels come back in order with no gaps or repeats', () => {
  const p = panels('at_merchant', typed, false, arrivalWindow('at_merchant', T0, T0));
  assert.deepEqual(p.map((x) => x.rank), p.map((_, i) => i + 1));
  assert.equal(new Set(p.map((x) => x.kind)).size, p.length);
});

test('WhatsApp gets a short line only when something actually happened', () => {
  assert.equal(whatsappLine('dispatch_offered', null), null, 'nobody needs telling we are still looking');
  assert.equal(whatsappLine('paid', null), null);
  assert.match(whatsappLine('at_door', null)!, /at your gate/);
  assert.match(whatsappLine('delivered', null)!, /Delivered/);
});

test('nothing clinical ever goes to WhatsApp, because WhatsApp leaves the country', () => {
  const states = ['dispatch_accepted', 'picked_up', 'at_door', 'delivered', 'stock_problem', 'address_problem', 'customer_absent'] as const;
  for (const s of states) {
    const line = whatsappLine(s, arrivalWindow(s, T0, T0));
    if (line) assert.equal(isSafeForWhatsapp(line), true, `${s} leaked something clinical: ${line}`);
  }
  assert.equal(isSafeForWhatsapp('Your prescription is on the way'), false);
  assert.equal(isSafeForWhatsapp('Your 500mg tablets are here'), false);
  assert.equal(isSafeForWhatsapp('Your order is on the road.'), true);
});

test('every line a customer reads is plain and has no dashes', () => {
  const lines = [
    arrivalWindow('picked_up', T0, T0)!.says,
    ...panels('address_problem', typed, false, arrivalWindow('address_problem', T0, T0)).map((p) => p.says),
    whatsappLine('at_door', null)!,
  ];
  for (const l of lines) {
    assert.ok(l.length > 8);
    assert.equal(l.includes(' - '), false, `dash in: ${l}`);
  }
});
```

---

## api/src/orders/tracking.ts

```typescript
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
```

---

## api/src/simulator/simulator.module.ts

```typescript
import { Module } from '@nestjs/common';
import { SimulatorService } from './simulator.service';
import { DispatchModule } from '../dispatch/dispatch.module';
import { TrackingModule } from '../tracking/tracking.module';

@Module({
  imports: [DispatchModule, TrackingModule],
  providers: [SimulatorService],
})
export class SimulatorModule {}
```

---

## api/src/simulator/simulator.service.ts

```typescript
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CouriersRepo } from '../data-store/repositories/couriers.repo';
import { OrdersRepo } from '../data-store/repositories/orders.repo';
import { MerchantsRepo } from '../data-store/repositories/merchants.repo';
import { LedgerRepo } from '../data-store/repositories/ledger.repo';
import { OutboxRepo } from '../data-store/repositories/outbox.repo';
import { DispatchService } from '../dispatch/dispatch.service';
import { TrackingGateway } from '../tracking/tracking.gateway';
import { WAYPOINTS } from '../common/waypoints';
import { nextStepDelayMs } from '../orders/orders.service';
import { OrderRecord } from '../data-store/interfaces';
import { OrderStatus } from '../common/types';

const TICK_MS = 1000;
const IDLE_LERP = 0.12;
const BUSY_LERP = 0.28;
const ARRIVE_THRESHOLD = 0.003; // roughly 300m in degrees, close enough for a demo

// Order status walked through in order, each entry paired with the outbox
// event name used for that transition. Kept as a lookup table so the
// lifecycle only has to be spelled out once.
const NEXT_STEP: Record<string, { status: OrderStatus; event: string } | undefined> = {
  placed: { status: 'paid', event: 'order.paid' },
  paid: { status: 'dispatch.offered', event: 'dispatch.offered' },
  'dispatch.offered': { status: 'dispatch.accepted', event: 'dispatch.accepted' },
  'dispatch.accepted': { status: 'picked_up', event: 'order.picked_up' },
  picked_up: { status: 'delivered', event: 'order.delivered' },
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function distance(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  return Math.hypot(a.lat - b.lat, a.lng - b.lng);
}

// The whole demo's heartbeat: every second it nudges every courier's
// position and checks whether any order has reached its randomly rolled
// next_step_at, advancing the ones that have. This is what makes the API
// feel alive without any client ever polling for it.
@Injectable()
export class SimulatorService implements OnModuleInit {
  private readonly logger = new Logger(SimulatorService.name);

  constructor(
    private readonly couriersRepo: CouriersRepo,
    private readonly ordersRepo: OrdersRepo,
    private readonly merchantsRepo: MerchantsRepo,
    private readonly ledgerRepo: LedgerRepo,
    private readonly outboxRepo: OutboxRepo,
    private readonly dispatchService: DispatchService,
    private readonly tracking: TrackingGateway,
  ) {}

  onModuleInit(): void {
    setInterval(() => this.tick(), TICK_MS);
    this.logger.log('Simulator started, couriers wandering and orders advancing on their own.');
  }

  private tick(): void {
    this.moveCouriers();
    this.advanceDueOrders();
  }

  private moveCouriers(): void {
    const couriers = this.couriersRepo.listAll();
    for (const courier of couriers) {
      const activeOrder = this.ordersRepo
        .listActiveForCourier(courier.id)
        .find((o) => o.status === 'dispatch.accepted' || o.status === 'picked_up');

      if (activeOrder) {
        const target =
          activeOrder.status === 'picked_up'
            ? { lat: activeOrder.delivery_lat, lng: activeOrder.delivery_lng }
            : this.merchantPoint(activeOrder);
        if (target) {
          courier.lat = lerp(courier.lat, target.lat, BUSY_LERP);
          courier.lng = lerp(courier.lng, target.lng, BUSY_LERP);
        }
      } else {
        const wp = WAYPOINTS[courier.waypoint_target % WAYPOINTS.length];
        courier.lat = lerp(courier.lat, wp.lat, IDLE_LERP);
        courier.lng = lerp(courier.lng, wp.lng, IDLE_LERP);
        if (distance(courier, wp) < ARRIVE_THRESHOLD) {
          let next = Math.floor(Math.random() * WAYPOINTS.length);
          if (next === courier.waypoint_target) next = (next + 1) % WAYPOINTS.length;
          courier.waypoint_target = next;
        }
      }
    }
    for (const courier of couriers) {
      this.couriersRepo.update(courier.id, { lat: courier.lat, lng: courier.lng, waypoint_target: courier.waypoint_target });
    }
    this.tracking.emitCourierLocations(
      couriers.map((c) => ({ id: c.id, lat: c.lat, lng: c.lng, status: c.status })),
    );
  }

  private merchantPoint(order: OrderRecord): { lat: number; lng: number } | null {
    const merchant = this.merchantsRepo.findById(order.merchant_id);
    return merchant ? { lat: merchant.lat, lng: merchant.lng } : null;
  }

  private advanceDueOrders(): void {
    const due = this.ordersRepo.listDue(Date.now());
    for (const order of due) {
      this.advanceOrder(order);
    }
  }

  private advanceOrder(order: OrderRecord): void {
    const step = NEXT_STEP[order.status];
    if (!step) return;

    const nowIso = new Date().toISOString();
    order.status = step.status;
    order.timeline.push({ status: step.status, at: nowIso });
    order.next_step_at = Date.now() + nextStepDelayMs();
    this.ordersRepo.update(order.id, {
      status: order.status,
      timeline: order.timeline,
      next_step_at: order.next_step_at,
    });
    this.outboxRepo.append(step.event, order.id, { status: step.status });
    this.tracking.emitOrderStatus(order.id, step.status);

    if (step.status === 'dispatch.offered') {
      this.dispatchService.assign(order);
    } else if (step.status === 'dispatch.accepted') {
      if (order.courier_id) this.couriersRepo.update(order.courier_id, { status: 'busy' });
    } else if (step.status === 'delivered') {
      this.ledgerRepo.writeOrderSplit(order.id, order.total_bwp);
      if (order.courier_id) {
        const courier = this.couriersRepo.findById(order.courier_id);
        if (courier) {
          const courierAmt = Math.round(order.total_bwp * 0.18 * 100) / 100;
          this.couriersRepo.update(order.courier_id, {
            earnings_today_bwp: Math.round((courier.earnings_today_bwp + courierAmt) * 100) / 100,
            status: 'online',
          });
        }
      }
    }
  }
}
```

---

## api/src/tracking/tracking.gateway.ts

```typescript
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { DispatchScore } from '../data-store/interfaces';

// Namespace /rt carries every live update the web app cares about:
//  - courier_locations, an array of every courier, roughly once a second
//  - order_status, one order's new status the moment it changes
//  - dispatch_scored, the full scoring breakdown right after a courier
//    is offered an order
@WebSocketGateway({
  namespace: '/rt',
  cors: {
    origin: process.env.WEB_ORIGIN || 'http://localhost:5173',
    credentials: true,
  },
})
export class TrackingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  handleConnection(client: Socket): void {
    // No auth handshake needed for the alpha demo, the socket only ever
    // carries public-ish tracking data (positions, statuses, scores).
    void client;
  }

  handleDisconnect(client: Socket): void {
    void client;
  }

  emitCourierLocations(locations: { id: string; lat: number; lng: number; status: string }[]): void {
    this.server?.emit('courier_locations', locations);
  }

  emitOrderStatus(orderId: string, status: string): void {
    this.server?.emit('order_status', { order_id: orderId, status });
  }

  emitDispatchScored(orderId: string, scores: DispatchScore[]): void {
    this.server?.emit('dispatch_scored', { order_id: orderId, scores });
  }
}
```

---

## api/src/tracking/tracking.module.ts

```typescript
import { Module } from '@nestjs/common';
import { TrackingGateway } from './tracking.gateway';

@Module({
  providers: [TrackingGateway],
  exports: [TrackingGateway],
})
export class TrackingModule {}
```
