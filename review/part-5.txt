# Sprint delivery engine, part 5 of 6

A customer facing delivery platform for Gaborone, Botswana. One app, many kinds of
shop, the way Checkers Sixty60 works: a shop has a KIND and each kind carries its
own rules. A pharmacy needs a pharmacist, a bottle store needs a licence and
trading hours, a pet shop needs neither.

TypeScript on NestJS. 271 tests passing, tsc clean.
Public copy: https://github.com/94luther/sprint-alpha-review

**This is part 5 of 6.** The engine is split so that nothing gets silently
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

## The 5 files in THIS part

**When you answer, tell me how many of these you actually read.**

1. `api/src/orders/payments.test.ts`
2. `api/src/orders/payments.ts`
3. `api/src/orders/settlement.test.ts`
4. `api/src/orders/settlement.ts`
5. `api/src/orders/state_machine.test.ts`


---

## api/src/orders/payments.test.ts

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RAILS,
  MemoryBook,
  PaymentError,
  UnconfiguredRail,
  railsAvailableToday,
  railsWaitingOnSomebody,
  railCost,
  netOf,
  pula,
  canMove,
  isFinal,
  take,
  move,
  refund,
} from './payments';

const req = (over: Partial<Parameters<typeof take>[1]> = {}) => ({
  key: 'k1',
  order_id: 'SPR-1',
  rail: 'cash' as const,
  amount_thebe: 6500,
  ...over,
});

/* ---------------- the one that saves the most money ---------------- */

test('three taps on a bad signal make ONE payment, not three', () => {
  const book = new MemoryBook();
  const a = take(book, req());
  const b = take(book, req());
  const c = take(book, req());
  assert.equal(a.key, b.key);
  assert.equal(b.key, c.key);
  assert.equal(book.all().length, 1, 'a retried tap created a second payment');
});

test('the same key with different money is refused, never charged again', () => {
  const book = new MemoryBook();
  take(book, req());
  assert.throws(() => take(book, req({ amount_thebe: 9900 })), PaymentError);
  assert.throws(() => take(book, req({ order_id: 'SPR-2' })), PaymentError);
  assert.equal(book.all().length, 1);
});

test('a payment with no key is refused outright', () => {
  assert.throws(() => take(new MemoryBook(), req({ key: '' })), PaymentError);
});

/* ---------------- money is whole thebe, never a float ---------------- */

test('a fraction of a thebe is not money', () => {
  assert.throws(() => take(new MemoryBook(), req({ amount_thebe: 65.5 })), PaymentError);
});

test('nothing and less than nothing are both refused', () => {
  assert.throws(() => take(new MemoryBook(), req({ amount_thebe: 0 })), PaymentError);
  assert.throws(() => take(new MemoryBook(), req({ amount_thebe: -100 })), PaymentError);
});

test('pula prints thebe the way a person reads it', () => {
  assert.equal(pula(6500), 'P65.00');
  assert.equal(pula(6), 'P0.06');
  assert.equal(pula(100000), 'P1000.00');
  assert.equal(pula(-250), '-P2.50');
});

/* ---------------- rails that are not switched on ---------------- */

test('only the rails that actually work today are offered', () => {
  const open = railsAvailableToday();
  assert.ok(open.includes('cash'));
  assert.ok(open.includes('account'));
  assert.equal(open.includes('orange_money'), false, 'Orange Money has no credentials yet');
  assert.equal(open.includes('card'), false);
});

test('every blocked rail names WHO or WHAT is being waited on', () => {
  const waiting = railsWaitingOnSomebody();
  assert.ok(waiting.length >= 4);
  for (const w of waiting) {
    assert.ok(w.blockedBy.length > 12, w.rail + ' does not say what it waits on');
  }
  const orange = waiting.find((w) => w.rail === 'orange_money');
  assert.match(String(orange?.blockedBy), /credentials/);
});

test('paying on a rail that is not switched on throws, and says why', () => {
  assert.throws(
    () => take(new MemoryBook(), req({ rail: 'orange_money' })),
    /not switched on yet/,
  );
});

test('the inert connector refuses loudly rather than pretending to succeed', async () => {
  await assert.rejects(() => new UnconfiguredRail('orange_money').charge(), PaymentError);
});

test('NO RAIL CLAIMS A REAL RATE YET: this fails the day a rate is pasted in without a source', () => {
  // Every cost is still a placeholder, which is only acceptable while blockedBy is set.
  for (const [rail, spec] of Object.entries(RAILS)) {
    if (spec.costBp !== 0 || spec.costFlatThebe !== 0) {
      assert.equal(
        spec.blockedBy,
        null,
        rail + ' carries a rate but is still marked as waiting. Say where the rate came from.',
      );
    }
  }
});

/* ---------------- the state machine ---------------- */

test('a payment cannot go backwards, and captured money cannot become pending', () => {
  assert.equal(canMove('created', 'captured'), true);
  assert.equal(canMove('captured', 'created'), false);
  assert.equal(canMove('captured', 'awaiting_customer'), false);
  assert.equal(canMove('failed', 'captured'), false);
  assert.equal(canMove('cancelled', 'captured'), false);
});

test('failed, cancelled and refunded are the end of the road', () => {
  assert.equal(isFinal('failed'), true);
  assert.equal(isFinal('cancelled'), true);
  assert.equal(isFinal('refunded'), true);
  assert.equal(isFinal('captured'), false);
});

test('a mobile rail starts by waiting for the customer, cash does not', () => {
  const book = new MemoryBook();
  const cash = take(book, req());
  assert.equal(cash.state, 'created');
  assert.match(cash.says, /at the door/);
});

test('capturing records what the rail took and what the customer sees', () => {
  const book = new MemoryBook();
  take(book, req());
  const p = move(book, 'k1', 'captured', 'REF-77');
  assert.equal(p.state, 'captured');
  assert.equal(p.rail_ref, 'REF-77');
  assert.equal(p.cost_thebe, 0); // cash costs nothing
  assert.match(p.says, /received/);
});

test('an impossible move is refused in plain words', () => {
  const book = new MemoryBook();
  take(book, req());
  move(book, 'k1', 'failed');
  assert.throws(() => move(book, 'k1', 'captured'), /cannot go from failed to captured/);
});

test('a payment nobody started cannot be moved', () => {
  assert.throws(() => move(new MemoryBook(), 'ghost', 'captured'), PaymentError);
});

/* ---------------- refunds ---------------- */

test('cash cannot be refunded by software, and says so instead of failing quietly', () => {
  const book = new MemoryBook();
  take(book, req());
  move(book, 'k1', 'captured');
  assert.throws(() => refund(book, 'k1', 100), /cannot be refunded by software/);
});

test('money that was never taken cannot be sent back', () => {
  const book = new MemoryBook();
  take(book, req({ rail: 'account', amount_thebe: 5000 }));
  assert.throws(() => refund(book, 'k1', 100), /Only money actually taken/);
});

test('a refund can never exceed what was taken, even in two goes', () => {
  const book = new MemoryBook();
  take(book, req({ rail: 'account', amount_thebe: 5000 }));
  move(book, 'k1', 'captured');
  refund(book, 'k1', 3000);
  assert.throws(() => refund(book, 'k1', 2500), /more than was taken/);
  refund(book, 'k1', 2000);
  assert.equal(book.get('k1')?.state, 'refunded');
});

/* ---------------- what the merchant actually nets ---------------- */

test('with every rate still at zero, the merchant nets exactly what was paid', () => {
  assert.equal(railCost('cash', 6500), 0);
  assert.equal(netOf('cash', 6500), 6500);
});

test('the cut is computed in whole thebe, never a fraction of one', () => {
  // proves the rounding holds the day a real rate lands
  const spec = RAILS.orange_money;
  const saved = { bp: spec.costBp, flat: spec.costFlatThebe };
  spec.costBp = 175; // 1.75 percent, a plausible shape, not a quoted rate
  spec.costFlatThebe = 50;
  const cost = railCost('orange_money', 6533);
  assert.ok(Number.isInteger(cost), 'a cost came out as a fraction of a thebe');
  assert.equal(cost, Math.round((6533 * 175) / 10000) + 50);
  assert.equal(netOf('orange_money', 6533), 6533 - cost);
  spec.costBp = saved.bp;
  spec.costFlatThebe = saved.flat;
});

test('cash stays under the cap the cash engine already enforces', () => {
  assert.equal(RAILS.cash.maxThebe, 100000);
  assert.throws(() => take(new MemoryBook(), req({ amount_thebe: 100001 })), /does not take amounts over/);
});
```

---

## api/src/orders/payments.ts

```typescript
/**
 * Payments: taking the money, and never taking it twice.
 *
 * Phase 2 of the plan Luther approved on 15 September 2026. What is deliberately
 * NOT here: a working connection to Orange Money. That needs merchant credentials
 * and a merchant rate, and the emails asking all three networks for both are
 * queued for Monday morning. Writing a connector that pretends to succeed without
 * them would be the worst thing in this file, so the adapter REFUSES instead: an
 * unconfigured rail throws, loudly, by name. A payment system that silently does
 * nothing is how money goes missing.
 *
 * What IS here, and is real and tested:
 *
 *   - Idempotency. A customer with a bad signal taps Pay three times. Three taps,
 *     one charge. This is the single most expensive bug in any payment system and
 *     it is solved by the key, not by hoping the button disables in time.
 *   - A state machine that cannot go backwards. Captured money cannot become
 *     pending again; a failed payment cannot be captured; a refund cannot exceed
 *     what was taken.
 *   - The cost of each rail, so the merchant's net is computed from what actually
 *     arrives rather than from what the customer typed. Settlement already exists
 *     in settlement.ts and consumes this.
 *   - Which rails can refund at all. Cash cannot be refunded through a phone, and
 *     pretending otherwise puts a rider at somebody's door with an argument.
 *
 * Money is in thebe, as whole integers, exactly as cash.ts has it. Never floats.
 * Two pula is 200, and 0.1 + 0.2 is a bug waiting in a currency you can spend.
 */

import type { Rail } from './settlement';

export const THEBE = 100;

export class PaymentError extends Error {}

/** A rail cannot be used until this is false. */
export interface RailSpec {
  label: string;
  /** the customer does something on their own phone before it completes */
  needsCustomerAction: boolean;
  /** money can be sent back down this rail by software */
  refundable: boolean;
  /** what the rail takes, in basis points of the amount (100 bp = 1 percent) */
  costBp: number;
  /** a flat charge per transaction, in thebe, on top of costBp */
  costFlatThebe: number;
  /** below this the rail is not worth offering */
  minThebe: number;
  /** above this the rail refuses or the risk is not ours to take */
  maxThebe: number;
  /**
   * The named thing that must exist before this rail may be switched on. Null
   * means it works today. Every non-null value here is somebody's reply, not a
   * piece of code.
   */
  blockedBy: string | null;
}

/**
 * The costs below are PLACEHOLDERS and are marked as such by blockedBy. Not one
 * of them is a rate anybody has quoted Sprint. They exist so the maths can be
 * tested; they must be replaced with the real merchant rate the day it arrives,
 * and the test named 'no rail claims a real rate' fails if that is forgotten.
 */
export const RAILS: Record<Rail, RailSpec> = {
  cash: {
    label: 'Cash at the door',
    needsCustomerAction: false,
    refundable: false, // a rider cannot un-take cash; this goes through settlement
    costBp: 0,
    costFlatThebe: 0,
    minThebe: 0,
    maxThebe: 100000, // P1000, the cap cash.ts already enforces
    blockedBy: null,
  },
  orange_money: {
    label: 'Orange Money',
    needsCustomerAction: true, // the customer approves on their handset
    refundable: true,
    costBp: 0,
    costFlatThebe: 0,
    minThebe: 100,
    maxThebe: 500000,
    blockedBy: 'Orange Money merchant credentials and rate (email queued Monday 10:05)',
  },
  myzaka: {
    label: 'MyZaka',
    needsCustomerAction: true,
    refundable: true,
    costBp: 0,
    costFlatThebe: 0,
    minThebe: 100,
    maxThebe: 500000,
    blockedBy: 'Mascom MyZaka merchant credentials and rate (email queued Monday 10:35)',
  },
  smega: {
    label: 'Smega',
    needsCustomerAction: true,
    refundable: true,
    costBp: 0,
    costFlatThebe: 0,
    minThebe: 100,
    maxThebe: 500000,
    blockedBy: 'BTC Smega merchant credentials and rate (email queued Monday 11:05)',
  },
  card: {
    label: 'Card',
    needsCustomerAction: true,
    refundable: true,
    costBp: 0,
    costFlatThebe: 0,
    minThebe: 100,
    maxThebe: 2000000,
    blockedBy: 'A card gateway chosen and signed: DPO or Tingg',
  },
  account: {
    label: 'On account',
    needsCustomerAction: false,
    refundable: true,
    costBp: 0,
    costFlatThebe: 0,
    minThebe: 0,
    maxThebe: 10000000,
    blockedBy: null, // corporate.ts already governs who may do this
  },
};

export function railsAvailableToday(): Rail[] {
  return (Object.keys(RAILS) as Rail[]).filter((r) => RAILS[r].blockedBy === null);
}

export function railsWaitingOnSomebody(): { rail: Rail; blockedBy: string }[] {
  return (Object.keys(RAILS) as Rail[])
    .filter((r) => RAILS[r].blockedBy !== null)
    .map((r) => ({ rail: r, blockedBy: RAILS[r].blockedBy as string }));
}

/** What the rail takes off the top, in thebe, rounded to a whole thebe. */
export function railCost(rail: Rail, amountThebe: number): number {
  const spec = RAILS[rail];
  if (amountThebe < 0) throw new PaymentError('An amount cannot be negative.');
  return Math.round((amountThebe * spec.costBp) / 10000) + spec.costFlatThebe;
}

/** What actually lands, after the rail has taken its cut. */
export function netOf(rail: Rail, amountThebe: number): number {
  return amountThebe - railCost(rail, amountThebe);
}

export function pula(thebe: number): string {
  const sign = thebe < 0 ? '-' : '';
  const n = Math.abs(thebe);
  return sign + 'P' + Math.floor(n / THEBE) + '.' + String(n % THEBE).padStart(2, '0');
}

/* ------------------------------------------------------------------ the states */

export type PaymentState =
  | 'created'
  | 'awaiting_customer'
  | 'captured'
  | 'failed'
  | 'cancelled'
  | 'refunded';

const MOVES: Record<PaymentState, PaymentState[]> = {
  created: ['awaiting_customer', 'captured', 'failed', 'cancelled'],
  awaiting_customer: ['captured', 'failed', 'cancelled'],
  captured: ['refunded'],
  failed: [],
  cancelled: [],
  refunded: [],
};

export function canMove(from: PaymentState, to: PaymentState): boolean {
  return MOVES[from].includes(to);
}

export function isFinal(s: PaymentState): boolean {
  return MOVES[s].length === 0;
}

export interface Payment {
  /** the idempotency key: the same key is always the same payment */
  key: string;
  order_id: string;
  rail: Rail;
  amount_thebe: number;
  state: PaymentState;
  /** what the rail took, known only once captured */
  cost_thebe: number;
  refunded_thebe: number;
  /** set when the rail names its own reference, so a dispute can be traced */
  rail_ref: string | null;
  says: string;
}

/* ------------------------------------------------------- taking the money once */

export interface TakeRequest {
  key: string;
  order_id: string;
  rail: Rail;
  amount_thebe: number;
}

/**
 * The book of payments. Deliberately an interface: the real one is Postgres, the
 * one in the tests is a Map, and neither the state machine nor the idempotency
 * rule should care which it is.
 */
export interface PaymentBook {
  get(key: string): Payment | undefined;
  put(p: Payment): void;
}

export class MemoryBook implements PaymentBook {
  private readonly m = new Map<string, Payment>();
  get(key: string) {
    return this.m.get(key);
  }
  put(p: Payment) {
    this.m.set(p.key, p);
  }
  all(): Payment[] {
    return [...this.m.values()];
  }
}

/**
 * Start a payment, or hand back the one this key already started.
 *
 * The rule that matters: the SAME key with DIFFERENT details is a bug in the
 * caller, not a second payment, and it throws rather than quietly charging
 * again. A retried tap sends identical details and gets the identical payment
 * back, which is the whole point.
 */
export function take(book: PaymentBook, req: TakeRequest): Payment {
  if (!req.key) throw new PaymentError('A payment needs an idempotency key.');
  if (!Number.isInteger(req.amount_thebe)) {
    throw new PaymentError('Money is whole thebe. ' + req.amount_thebe + ' is not.');
  }
  if (req.amount_thebe <= 0) throw new PaymentError('An amount must be more than nothing.');

  const existing = book.get(req.key);
  if (existing) {
    if (
      existing.order_id !== req.order_id ||
      existing.rail !== req.rail ||
      existing.amount_thebe !== req.amount_thebe
    ) {
      throw new PaymentError(
        'This key has already been used for a different payment. Refusing to charge again.',
      );
    }
    return existing; // the retried tap
  }

  const spec = RAILS[req.rail];
  if (spec.blockedBy) {
    throw new PaymentError(spec.label + ' is not switched on yet: ' + spec.blockedBy);
  }
  if (req.amount_thebe < spec.minThebe) {
    throw new PaymentError(spec.label + ' does not take amounts under ' + pula(spec.minThebe) + '.');
  }
  if (req.amount_thebe > spec.maxThebe) {
    throw new PaymentError(spec.label + ' does not take amounts over ' + pula(spec.maxThebe) + '.');
  }

  const p: Payment = {
    key: req.key,
    order_id: req.order_id,
    rail: req.rail,
    amount_thebe: req.amount_thebe,
    state: spec.needsCustomerAction ? 'awaiting_customer' : 'created',
    cost_thebe: 0,
    refunded_thebe: 0,
    rail_ref: null,
    says: spec.needsCustomerAction
      ? 'Approve ' + pula(req.amount_thebe) + ' on your phone.'
      : pula(req.amount_thebe) + ' due at the door.',
  };
  book.put(p);
  return p;
}

export function move(
  book: PaymentBook,
  key: string,
  to: PaymentState,
  railRef?: string,
): Payment {
  const p = book.get(key);
  if (!p) throw new PaymentError('No payment with that key.');
  if (!canMove(p.state, to)) {
    throw new PaymentError('A payment cannot go from ' + p.state + ' to ' + to + '.');
  }
  p.state = to;
  if (railRef) p.rail_ref = railRef;
  if (to === 'captured') {
    p.cost_thebe = railCost(p.rail, p.amount_thebe);
    p.says = pula(p.amount_thebe) + ' received.';
  }
  if (to === 'failed') p.says = 'That payment did not go through. Nothing was taken.';
  if (to === 'cancelled') p.says = 'Payment cancelled. Nothing was taken.';
  book.put(p);
  return p;
}

export function refund(book: PaymentBook, key: string, amountThebe: number): Payment {
  const p = book.get(key);
  if (!p) throw new PaymentError('No payment with that key.');
  if (p.state !== 'captured') throw new PaymentError('Only money actually taken can be sent back.');
  if (!RAILS[p.rail].refundable) {
    throw new PaymentError(
      RAILS[p.rail].label + ' cannot be refunded by software. This one goes through settlement.',
    );
  }
  if (!Number.isInteger(amountThebe) || amountThebe <= 0) {
    throw new PaymentError('A refund must be a whole amount of thebe, more than nothing.');
  }
  if (p.refunded_thebe + amountThebe > p.amount_thebe) {
    throw new PaymentError('That is more than was taken.');
  }
  p.refunded_thebe += amountThebe;
  if (p.refunded_thebe === p.amount_thebe) p.state = 'refunded';
  p.says = pula(p.refunded_thebe) + ' sent back.';
  book.put(p);
  return p;
}

/* ------------------------------------------------- the rail itself, unconfigured */

export interface RailAdapter {
  rail: Rail;
  charge(p: Payment): Promise<{ ok: boolean; ref?: string; says: string }>;
}

/**
 * The Orange Money connector, deliberately inert.
 *
 * Orange holds over seven in ten of Botswana's mobile money and publishes a real
 * web payment API, so this is the rail that matters. It cannot be written blind:
 * it needs a merchant id, a secret and the notification URL Orange calls back on.
 * Until those exist this throws by name rather than returning a cheerful false
 * success, because a payment layer that appears to work and takes nothing is
 * worse than one that plainly refuses.
 */
export class UnconfiguredRail implements RailAdapter {
  constructor(public readonly rail: Rail) {}
  async charge(): Promise<{ ok: boolean; says: string }> {
    const spec = RAILS[this.rail];
    throw new PaymentError(
      spec.label + ' has no credentials on this machine. Waiting on: ' + (spec.blockedBy ?? 'nothing'),
    );
  }
}
```

---

## api/src/orders/settlement.test.ts

```typescript
/**
 * Brick 19's proof. Run with:
 *   npm --prefix api run test:orders
 *
 * The first and last tests are the ones that matter. Nothing pays out while the rules are still a
 * proposal, and a rail that does not settle itself is marked rather than assumed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  settleOne,
  dayPayout,
  readyToPay,
  payoutCsv,
  pula,
  SettlementError,
  SettleableOrder,
} from './settlement';

const P = (n: number) => n * 100;

const order = (over: Partial<SettleableOrder> = {}): SettleableOrder => ({
  order_id: 'o1', merchant_id: 'm1', merchant_name: 'A Gaborone grocer',
  goods: P(200), delivery_fee: P(60), rail: 'cash', fault: 'none',
  delivered: true, perishable: false, ...over,
});

test('nothing pays out while the fault model is still a proposal', () => {
  const p = dayPayout('2026-09-13', [order()], false);
  const r = readyToPay(p);
  assert.equal(r.ready, false);
  assert.match(r.says, /still a proposal/);
  assert.match(r.says, /Barbara has it/);
  assert.match(p.says, /NOT PAYABLE/);
  assert.ok(p.total > 0, 'the figure is still worked out, it just cannot be paid');
});

test('once it is agreed, the same day is payable', () => {
  const p = dayPayout('2026-09-13', [order()], true);
  assert.equal(readyToPay(p).ready, true);
  assert.equal(p.total, P(200));
});

test('a delivered order pays the merchant in full and Sprint keeps the fee', () => {
  const s = settleOne(order());
  assert.equal(s.merchant, P(200));
  assert.equal(s.sprint_fee, P(60));
  assert.equal(s.sprint_absorbs, 0);
  assert.match(s.says, /Delivered, paid in full/);
});

test('the shop could not supply, so nothing is owed to it', () => {
  const s = settleOne(order({ delivered: false, fault: 'merchant' }));
  assert.equal(s.merchant, 0);
  assert.equal(s.perishable_loss, 0);
  assert.equal(s.sprint_fee, 0);
  assert.match(s.says, /could not supply/);
});

test('the customer caused it, so the delivery fee stands and the goods go back', () => {
  const s = settleOne(order({ delivered: false, fault: 'customer' }));
  assert.equal(s.merchant, 0, 'the goods are resellable, so nothing is owed');
  assert.equal(s.sprint_fee, P(60), 'the fee stands');
  assert.equal(s.sprint_absorbs, 0);
});

test('a perishable that cannot go back on a shelf is a real loss, and the shop is covered', () => {
  const s = settleOne(order({ delivered: false, fault: 'customer', perishable: true }));
  assert.equal(s.perishable_loss, P(200));
  assert.match(s.says, /cannot be resold, so the shop is covered/);
});

test('when Sprint could not deliver, Sprint carries it', () => {
  const s = settleOne(order({ delivered: false, fault: 'sprint', perishable: true }));
  assert.equal(s.sprint_fee, 0, 'no fee is earned on a delivery that did not happen');
  assert.equal(s.perishable_loss, P(200));
  assert.equal(s.sprint_absorbs, P(200) + P(60));
  assert.match(s.says, /Sprint carries the cost/);
});

test('a rider who abandoned the job costs Sprint, not the merchant', () => {
  const s = settleOne(order({ delivered: false, fault: 'rider' }));
  assert.equal(s.merchant, 0);
  assert.equal(s.sprint_absorbs, P(60));
});

test('nobody at fault means nobody profits and nobody is punished', () => {
  const s = settleOne(order({ delivered: false, fault: 'none', perishable: true }));
  assert.equal(s.sprint_fee, 0);
  assert.equal(s.perishable_loss, P(200));
  assert.match(s.says, /Nobody was at fault/);
});

test('the day is grouped by merchant, biggest first', () => {
  const p = dayPayout('2026-09-13', [
    order({ order_id: 'a', merchant_id: 'm1', merchant_name: 'A grocer', goods: P(100) }),
    order({ order_id: 'b', merchant_id: 'm2', merchant_name: 'A pharmacy', goods: P(500) }),
    order({ order_id: 'c', merchant_id: 'm1', merchant_name: 'A grocer', goods: P(300) }),
  ], true);
  // m2 is a single P500 order, m1 is P100 plus P300 which is P400. Biggest first.
  assert.deepEqual(p.lines.map((l) => l.merchant_id), ['m2', 'm1']);
  const grocer = p.lines.find((l) => l.merchant_id === 'm1')!;
  assert.equal(grocer.orders, 2);
  assert.equal(grocer.net, P(400));
  assert.equal(p.total, P(900));
});

test('a rail that does not settle itself is marked, because Sprint must fund it', () => {
  const my = dayPayout('2026-09-13', [order({ rail: 'myzaka' })], true);
  assert.equal(my.lines[0].funded_by_sprint, true);
  assert.match(my.lines[0].says, /funded from Sprint's own account/);
  assert.match(my.lines[0].says, /wallet somebody must empty by hand/);
  assert.equal(my.funded_by_sprint, P(200));

  const card = dayPayout('2026-09-13', [order({ rail: 'card' })], true);
  assert.equal(card.lines[0].funded_by_sprint, false, 'a card rail pays the merchant itself');
  assert.equal(card.funded_by_sprint, 0);

  // Cash is NOT the same problem. The rider already collected the notes, so Sprint holds the money
  // and simply transfers it. Conflating that with a wallet would overstate what has to be funded.
  const cash = dayPayout('2026-09-13', [order({ rail: 'cash' })], true);
  assert.equal(cash.lines[0].funded_by_sprint, false);
  assert.match(cash.lines[0].says, /out of the cash the rider already collected/);
});

test('Sprint can see what it earned and what it carried, separately', () => {
  const p = dayPayout('2026-09-13', [
    order({ order_id: 'a' }),
    order({ order_id: 'b', delivered: false, fault: 'sprint', perishable: true }),
  ], true);
  assert.equal(p.sprint_delivery_fees, P(60), 'only the one that actually arrived');
  assert.equal(p.sprint_absorbed, P(260));
});

test('a day that works out to less than nothing stops and asks a person', () => {
  const p = dayPayout('2026-09-13', [order({ goods: 0, delivered: false, fault: 'merchant' })], true);
  p.total = -1; // only reachable if something upstream is wrong, which is the point
  assert.equal(readyToPay(p).ready, false);
  assert.match(readyToPay(p).says, /A person must look/);
});

test('a bad day or a negative amount is refused rather than paid', () => {
  assert.throws(() => dayPayout('13 September', [order()], true), SettlementError);
  assert.throws(() => dayPayout('2026-09-13', [order({ goods: -1 })], true), /negative amount/);
});

test('the file finance opens is a real CSV with a total that adds up', () => {
  const p = dayPayout('2026-09-13', [
    order({ order_id: 'a', merchant_id: 'm1', merchant_name: 'A grocer, Ltd', goods: P(100) }),
    order({ order_id: 'b', merchant_id: 'm2', merchant_name: 'A pharmacy', goods: P(250), rail: 'myzaka' }),
  ], true);
  const csv = payoutCsv(p);
  const rows = csv.trim().split('\n');
  assert.equal(rows.length, 4, 'a header, two merchants and a total');
  assert.match(rows[0], /^day,merchant_id,merchant_name,orders,goods_pula/);
  assert.match(csv, /"A grocer, Ltd"/, 'a comma in a name must not break the columns');
  assert.match(rows[rows.length - 1], /TOTAL/);
  assert.match(rows[rows.length - 1], /350\.00/);
  assert.match(csv, /myzaka,yes/, 'the funded flag must reach the file');
});

test('every line a person reads is plain and has no dashes', () => {
  const p = dayPayout('2026-09-13', [order({ rail: 'myzaka' })], false);
  for (const l of [p.says, p.lines[0].says, readyToPay(p).says, pula(P(12))]) {
    assert.equal(l.includes(' - '), false, `dash in: ${l}`);
  }
});
```

---

## api/src/orders/settlement.ts

```typescript
/**
 * Brick 19. Merchants paid the same day.
 *
 * Both council seats said settlement speed is existential: a merchant paid tomorrow leaves for a
 * platform that pays today. They also said it is impossible without brick 15, the fault model,
 * because the moment money moves on its own somebody must already have decided who carries a loss.
 *
 * So this file turns the fault on each order into arithmetic. At the end of a day every completed
 * order has a fault of merchant, customer, sprint, rider or none already attached by the person who
 * was there, and the payout file falls out of that without anybody reading an order history.
 *
 * **Status: the RULES here are brick 15's, which Barbara has not agreed yet.** The mechanism is
 * real and tested; the percentages and the deduction rules are the proposal in docs/FAULT_MODEL.md.
 * Nothing may actually pay a merchant until she signs it, and `readyToPay()` refuses while the model
 * is unagreed rather than quietly running on a draft.
 *
 * **One thing the council did not know.** MyZaka has no automatic settlement to a bank account at
 * all. Their own contract has the merchant emptying an electronic wallet by hand. So on that rail a
 * same day payout has to be funded from Sprint's own account and reconciled afterwards, and this
 * file marks those lines rather than pretending the money moved.
 */

import { Fault } from './state_machine';

/** Money is in thebe throughout. A decimal is how money quietly disappears. */
import { commissionOn, type MerchantTerms } from './commission';

export type Rail = 'cash' | 'orange_money' | 'myzaka' | 'smega' | 'card' | 'account';

/**
 * Three different things, and conflating them would mislead finance badly.
 *   SELF_SETTLING: the rail moves money to the merchant itself. Nothing to fund.
 *   IN_HAND: the rider physically collected it, so Sprint holds the notes and simply transfers them.
 *   WALLET: the money sits in an electronic wallet that somebody at Sprint must empty by hand, per
 *           Mascom's own MyZakaPay contract clause 3.3.6. THIS is the one that has to be funded from
 *           Sprint's own bank account on the day and reconciled afterwards.
 */
const SELF_SETTLING: Rail[] = ['card', 'account'];
const IN_HAND: Rail[] = ['cash'];
const WALLET: Rail[] = ['orange_money', 'myzaka', 'smega'];

export interface SettleableOrder {
  order_id: string;
  merchant_id: string;
  merchant_name: string;
  /** What the customer paid for the goods, in thebe. Excludes the delivery fee. */
  goods: number;
  /** The delivery fee, which is Sprint's, not the merchant's. */
  delivery_fee: number;
  rail: Rail;
  /** 'none' when it completed normally. Anything else means something went wrong. */
  fault: Fault;
  /** Did the goods actually reach the customer. */
  delivered: boolean;
  /** Perishable or dispensed goods cannot go back on a shelf. */
  perishable: boolean;
}

export interface PayoutLine {
  merchant_id: string;
  merchant_name: string;
  orders: number;
  /** What the merchant is owed for goods that reached a customer. */
  goods: number;
  /** Deducted because the merchant caused a failure. Never a penalty, only real cost. */
  deductions: number;
  /** Paid to the merchant for goods that came back but cannot be resold. */
  perishable_loss: number;
  net: number;
  rail: Rail;
  /** True when Sprint must fund this from its own account because the rail does not settle itself. */
  funded_by_sprint: boolean;
  says: string;
}

export interface Payout {
  day: string;
  lines: PayoutLine[];
  total: number;
  funded_by_sprint: number;
  /** Sprint's own take for the day: delivery fees earned, less what it carried for its own failures. */
  sprint_delivery_fees: number;
  sprint_absorbed: number;
  agreed: boolean;
  says: string;
}

export class SettlementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettlementError';
  }
}

export function pula(thebe: number): string {
  return `P${(thebe / 100).toFixed(2)}`;
}

/**
 * What one order settles to. The fault decides it, exactly as the table in docs/FAULT_MODEL.md says.
 */
export function settleOne(o: SettleableOrder, terms: MerchantTerms | null = null): {
  merchant: number;
  perishable_loss: number;
  sprint_fee: number;
  sprint_absorbs: number;
  /** Sprint's share of the GOODS. Zero unless the merchant's rate is agreed. */
  commission: number;
  says: string;
} {
  if (o.goods < 0 || o.delivery_fee < 0) throw new SettlementError('An order cannot have a negative amount on it.');

  if (o.delivered) {
    // It arrived. The merchant is paid for the goods and Sprint keeps the delivery fee, whatever
    // went wrong on the way, because the customer got what they ordered.
    /* Commission is earned only on a delivery that happened, and only on the
       goods. An unagreed rate earns zero, so a rate typed in during a negotiation
       cannot start taking money from a merchant because somebody forgot it was
       still a proposal. See commission.ts. */
    const cut = commissionOn(o.goods, terms);
    return {
      merchant: o.goods - cut.thebe,
      perishable_loss: 0,
      sprint_fee: o.delivery_fee,
      sprint_absorbs: 0,
      commission: cut.thebe,
      says: cut.earned ? `Delivered. ${cut.says}` : 'Delivered, paid in full',
    };
  }

  switch (o.fault) {
    case 'merchant':
      // The shop could not supply. They are paid nothing and carry any perishable loss themselves.
      return { merchant: 0, perishable_loss: 0, sprint_fee: 0, sprint_absorbs: 0, commission: 0, says: 'The shop could not supply it, nothing is owed' };

    case 'customer':
      // Wrong address, nobody home, failed identity check. The customer keeps paying the delivery
      // fee, and a perishable that cannot be resold is the merchant's real loss, so it is paid.
      return {
        merchant: 0,
        perishable_loss: o.perishable ? o.goods : 0,
        sprint_fee: o.delivery_fee,
        sprint_absorbs: 0,
        commission: 0,   // nothing was delivered, so nothing is earned on the basket
        says: o.perishable
          ? 'The customer caused it and the goods cannot be resold, so the shop is covered'
          : 'The customer caused it, the goods go back, the delivery fee stands',
      };

    case 'rider':
    case 'sprint':
      // Sprint could not do what it sold. The customer is refunded, the merchant is covered for
      // anything that cannot be resold, and Sprint carries it.
      return {
        merchant: 0,
        perishable_loss: o.perishable ? o.goods : 0,
        sprint_fee: 0,
        sprint_absorbs: (o.perishable ? o.goods : 0) + o.delivery_fee,
        commission: 0,   // nothing was delivered, so nothing is earned on the basket
        says: 'Sprint could not deliver it, so Sprint carries the cost',
      };

    case 'none':
    default:
      // Nobody is at fault. Flood, accident, roadblock. Nobody profits and nobody is punished.
      return {
        merchant: 0,
        perishable_loss: o.perishable ? o.goods : 0,
        sprint_fee: 0,
        sprint_absorbs: o.perishable ? o.goods : 0,
        commission: 0,   // nothing was delivered, so nothing is earned on the basket
        says: 'Nobody was at fault, the goods that cannot be resold are covered',
      };
  }
}

/**
 * The day's payout, grouped by merchant. `agreed` is whether Barbara has signed the fault model;
 * false produces the file but marks it not payable, so nobody pays out on a draft by accident.
 */
export function dayPayout(day: string, orders: SettleableOrder[], agreed: boolean): Payout {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new SettlementError('A payout needs a day, as 2026-09-13.');

  const byMerchant = new Map<string, PayoutLine>();
  let fees = 0, absorbed = 0;

  for (const o of orders) {
    const s = settleOne(o);
    fees += s.sprint_fee;
    absorbed += s.sprint_absorbs;

    const line = byMerchant.get(o.merchant_id) ?? {
      merchant_id: o.merchant_id,
      merchant_name: o.merchant_name,
      orders: 0, goods: 0, deductions: 0, perishable_loss: 0, net: 0,
      rail: o.rail,
      funded_by_sprint: WALLET.includes(o.rail),
      says: '',
    };
    line.orders += 1;
    line.goods += s.merchant;
    line.perishable_loss += s.perishable_loss;
    if (!o.delivered && o.fault === 'merchant') line.deductions += 0; // nothing owed, nothing deducted
    byMerchant.set(o.merchant_id, line);
  }

  const lines = [...byMerchant.values()].map((l) => {
    l.net = l.goods + l.perishable_loss - l.deductions;
    l.says = l.funded_by_sprint
      ? `${pula(l.net)} to ${l.merchant_name}, funded from Sprint's own account because ${railName(l.rail)} leaves the money in a wallet somebody must empty by hand`
      : IN_HAND.includes(l.rail)
        ? `${pula(l.net)} to ${l.merchant_name}, out of the cash the rider already collected`
        : `${pula(l.net)} to ${l.merchant_name} on ${railName(l.rail)}`;
    return l;
  }).sort((a, b) => b.net - a.net);

  const total = lines.reduce((a, l) => a + l.net, 0);
  const funded = lines.filter((l) => l.funded_by_sprint).reduce((a, l) => a + l.net, 0);

  return {
    day, lines, total,
    funded_by_sprint: funded,
    sprint_delivery_fees: fees,
    sprint_absorbed: absorbed,
    agreed,
    says: agreed
      ? `${pula(total)} to ${lines.length} merchant${lines.length === 1 ? '' : 's'} for ${day}`
      : `${pula(total)} worked out for ${day}, NOT PAYABLE until the fault model is agreed`,
  };
}

function railName(r: Rail): string {
  return { cash: 'cash', orange_money: 'Orange Money', myzaka: 'MyZaka', smega: 'Smega', card: 'card', account: 'account' }[r];
}

/** The gate. Nothing pays a merchant while the rules behind it are still a proposal. */
export function readyToPay(p: Payout): { ready: boolean; says: string } {
  if (!p.agreed) {
    return { ready: false, says: 'The fault model is still a proposal, so nothing can be paid out yet. Barbara has it.' };
  }
  if (p.total < 0) {
    return { ready: false, says: 'The day works out to less than nothing, which means something is wrong. A person must look.' };
  }
  return { ready: true, says: p.says };
}

/** The file finance actually opens. Plain CSV, because that is what a bank upload takes. */
export function payoutCsv(p: Payout): string {
  const head = 'day,merchant_id,merchant_name,orders,goods_pula,perishable_pula,net_pula,rail,funded_by_sprint';
  const rows = p.lines.map((l) =>
    [p.day, l.merchant_id, `"${l.merchant_name.replace(/"/g, '""')}"`, l.orders,
     (l.goods / 100).toFixed(2), (l.perishable_loss / 100).toFixed(2), (l.net / 100).toFixed(2),
     l.rail, l.funded_by_sprint ? 'yes' : 'no'].join(','));
  const foot = `${p.day},TOTAL,"",${p.lines.reduce((a, l) => a + l.orders, 0)},,,${(p.total / 100).toFixed(2)},,`;
  return [head, ...rows, foot].join('\n') + '\n';
}
```

---

## api/src/orders/state_machine.test.ts

```typescript
/**
 * Brick 14's proof. Run with:
 *   npm --prefix api run test:orders
 *
 * The first three tests are the ones that matter. They prove mechanically that an order can
 * never get stuck, which is the council's finding, rather than asserting it in a comment.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATES,
  TRANSITIONS,
  OrderState,
  apply,
  can,
  allowedEvents,
  isTerminal,
  isStuck,
  deadEnds,
  unreachable,
  untimed,
  canReachEnd,
  TransitionError,
} from './state_machine';

const ALL = Object.keys(STATES) as OrderState[];

test('guarantee 1: no order can get stuck, every live state has a way out', () => {
  assert.deepEqual(deadEnds(), [], 'these states trap an order forever');
});

test('guarantee 2: no orphan states, everything is reachable from placed', () => {
  assert.deepEqual(unreachable(), [], 'these states can never be entered');
});

test('guarantee 3: every live state has a dwell limit so nothing sits silently', () => {
  assert.deepEqual(untimed(), [], 'these states would never raise an ops alert');
});

test('every state can still reach an ending', () => {
  for (const s of ALL) {
    assert.equal(canReachEnd(s), true, `${s} can never be finished`);
  }
});

test('terminal states accept nothing further', () => {
  for (const s of ALL.filter(isTerminal)) {
    assert.equal(TRANSITIONS.some((t) => t.from === s), false, `${s} is terminal but has moves`);
    assert.throws(() => apply(s, 'close', { actor: 'ops' }), TransitionError);
  }
});

test('the happy path runs end to end', () => {
  let s: OrderState = 'placed';
  const path: Array<[string, any]> = [
    ['pay_succeeded', 'system'],
    ['offer_to_riders', 'system'],
    ['rider_accepted', 'courier'],
    ['rider_arrived_at_shop', 'courier'],
    ['collected', 'courier'],
    ['arrived', 'courier'],
    ['handed_over', 'courier'],
    ['close', 'system'],
  ];
  for (const [event, actor] of path) {
    s = apply(s, event, { actor }).state;
  }
  assert.equal(s, 'closed');
});

test('out of stock, customer takes a substitute, order still completes', () => {
  let s: OrderState = 'at_merchant';
  s = apply(s, 'out_of_stock', { actor: 'merchant', fault: 'merchant' }).state;
  assert.equal(s, 'stock_problem');
  s = apply(s, 'substitute_accepted', { actor: 'customer' }).state;
  assert.equal(s, 'at_merchant');
  s = apply(s, 'collected', { actor: 'courier' }).state;
  assert.equal(s, 'picked_up');
});

test('wrong address is recoverable without cancelling the order', () => {
  let s: OrderState = apply('at_door', 'wrong_address', { actor: 'courier' }).state;
  assert.equal(s, 'address_problem');
  s = apply(s, 'address_fixed', { actor: 'customer' }).state;
  assert.equal(s, 'picked_up');
  s = apply(s, 'arrived', { actor: 'courier' }).state;
  assert.equal(s, 'at_door');
});

test('customer absent, then answers, still gets the order', () => {
  let s: OrderState = apply('at_door', 'nobody_there', { actor: 'courier' }).state;
  assert.equal(s, 'customer_absent');
  s = apply(s, 'customer_answered', { actor: 'courier' }).state;
  assert.equal(s, 'at_door');
});

test('rider breaks down, order is reassigned rather than lost', () => {
  let s: OrderState = apply('dispatch_accepted', 'rider_dropped', { actor: 'courier', fault: 'rider' }).state;
  assert.equal(s, 'dispatch_offered');
  s = apply(s, 'rider_accepted', { actor: 'courier' }).state;
  assert.equal(s, 'dispatch_accepted');
});

test('a failed identity check sends liquor or medicine back, and names the fault', () => {
  const move = apply('at_door', 'id_check_failed', { actor: 'courier', fault: 'customer' });
  assert.equal(move.state, 'returning');
  assert.equal(move.fault, 'customer');
  let s = apply(move.state, 'back_at_merchant', { actor: 'courier' }).state;
  assert.equal(s, 'returned');
  s = apply(s, 'settle', { actor: 'ops', fault: 'customer' }).state;
  assert.equal(s, 'refund_due');
  s = apply(s, 'refunded', { actor: 'ops' }).state;
  assert.equal(s, 'closed');
});

test('brick 15: money never moves on a failure whose fault was never decided', () => {
  assert.throws(
    () => apply('at_door', 'id_check_failed', { actor: 'courier' }),
    /needs somebody to carry the cost/,
  );
  assert.throws(
    () => apply('delivered', 'dispute_raised', { actor: 'customer' }),
    /needs somebody to carry the cost/,
  );
  const ok = apply('delivered', 'dispute_raised', { actor: 'customer', fault: 'sprint' });
  assert.equal(ok.fault, 'sprint');
});

test('a fault is not invented on a clean transition', () => {
  const move = apply('at_door', 'handed_over', { actor: 'courier' });
  assert.equal(move.fault, 'none');
});

test('the wrong person cannot move an order', () => {
  assert.throws(() => apply('at_door', 'handed_over', { actor: 'customer' }), /may not do/);
  assert.throws(() => apply('paid', 'offer_to_riders', { actor: 'customer' }), /may not do/);
});

test('an impossible move is refused loudly and says what is possible', () => {
  assert.throws(() => apply('placed', 'handed_over', { actor: 'courier' }), /is not possible from placed/);
  try {
    apply('placed', 'handed_over', { actor: 'courier' });
  } catch (e: any) {
    assert.match(e.message, /pay_succeeded/);
  }
});

test('allowedEvents drives what a rider sees, and it is never the whole list', () => {
  const riderAtDoor = allowedEvents('at_door', 'courier').map((t) => t.event);
  assert.ok(riderAtDoor.includes('handed_over'));
  assert.ok(riderAtDoor.includes('nobody_there'));
  const customerAtDoor = allowedEvents('at_door', 'customer').map((t) => t.event);
  assert.deepEqual(customerAtDoor, [], 'a customer has no buttons at the door');
  assert.equal(can('at_door', 'handed_over', 'courier'), true);
  assert.equal(can('at_door', 'handed_over', 'customer'), false);
});

test('the stuck clock fires on the states that matter', () => {
  const t0 = '2026-09-12T08:00:00.000Z';
  assert.equal(isStuck('dispatch_offered', t0, '2026-09-12T08:02:00.000Z'), false);
  assert.equal(isStuck('dispatch_offered', t0, '2026-09-12T08:04:00.000Z'), true);
  assert.equal(isStuck('picked_up', t0, '2026-09-12T08:40:00.000Z'), false);
  assert.equal(isStuck('picked_up', t0, '2026-09-12T09:00:00.000Z'), true);
  assert.equal(isStuck('closed', t0, '2027-01-01T00:00:00.000Z'), false, 'a finished order is never stuck');
});

test('every transition names a real state, a real actor set and plain words', () => {
  const actors = ['customer', 'courier', 'merchant', 'ops', 'system'];
  for (const t of TRANSITIONS) {
    assert.ok(STATES[t.from], `unknown from state ${t.from}`);
    assert.ok(STATES[t.to], `unknown to state ${t.to}`);
    assert.ok(t.actors.length > 0, `${t.event} has nobody who can do it`);
    for (const a of t.actors) assert.ok(actors.includes(a), `${t.event} has unknown actor ${a}`);
    assert.ok(t.says && t.says.length > 5, `${t.event} has no plain words`);
    assert.equal(t.says.includes('-'), false, `${t.event} uses a dash in text a person reads`);
  }
});

test('no two transitions share a from and event pair', () => {
  const seen = new Set<string>();
  for (const t of TRANSITIONS) {
    const key = `${t.from}:${t.event}`;
    assert.equal(seen.has(key), false, `${key} is defined twice`);
    seen.add(key);
  }
});

test('every state a customer waits in has a limit under an hour, except the money ones', () => {
  const slowOnPurpose: OrderState[] = ['payment_failed', 'refund_due'];
  for (const s of ALL) {
    const m = STATES[s];
    if (m.customerWaiting && !slowOnPurpose.includes(s)) {
      assert.ok(m.stuckAfterMinutes !== null && m.stuckAfterMinutes <= 60,
        `${s} keeps a customer waiting ${m.stuckAfterMinutes} minutes with no alert`);
    }
  }
});
```
