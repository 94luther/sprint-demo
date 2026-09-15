# Sprint delivery engine, review pack: everything that can move money

A customer facing delivery platform for Gaborone, Botswana. One app, many kinds of
shop, the way Checkers Sixty60 works: a shop has a KIND and each kind carries its
own rules. A pharmacy needs a pharmacist, a bottle store needs a licence and
trading hours, a pet shop needs neither.

TypeScript on NestJS. 271 tests passing, tsc clean.
Public copy: https://github.com/94luther/sprint-alpha-review

**This pack holds 27 files, which is 56 percent of the engine's code.** It is every file that can move a thebe, with its tests beside it.

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
   over it. Two tests had to change with the contract the day this was written.

Do not tell me the code is clean. Tell me the failure, the input that causes it,
and what it costs.

## Context that is not in the code

- No merchant has signed anything. Every shop name and price is invented.
- No payment rail is switched on. Cash and on account are the only live ones, and
  every other rail refuses by name rather than pretending to work.
- This is one person's project. There is no team and no production deployment.
- Money is thebe as whole integers. One hundred thebe is one pula.


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

## api/src/orders/commission.ts

```typescript
/**
 * Commission: what Sprint earns on the basket, not just on the drop.
 *
 * Asked for by Luther on 15 September 2026, after checking the settlement rules
 * turned up that there was no commission anywhere in the engine at all. Sprint's
 * whole upside was a flat delivery fee, so a merchant sending P50,000 a month paid
 * exactly the same as one sending P5,000 at the same order count. Wanzy and
 * Sixty60 both earn on the basket. It is the number a supermarket deal turns on,
 * and there was no field for it.
 *
 * Three mistakes this codebase has already made are deliberately designed out:
 *
 *   - INVENTED NUMBERS THAT HARDEN INTO POLICY. The 75 and 18 percent split in
 *     ledger.repo.ts was nobody's decision. So a rate here is worth nothing until
 *     `agreed` is true, and an unagreed rate earns ZERO rather than a guess.
 *   - A RATE WITH NO PROVENANCE. Every set of terms must say where the number came
 *     from, in writing, or it cannot be agreed.
 *   - MONEY AS A FLOAT. Rates are basis points as whole integers. 1500 is fifteen
 *     percent. There is no 0.15 anywhere in this file.
 *
 * And one thing is left deliberately undone: no rate is set for any merchant here.
 * Nobody has signed anything. The rates in a negotiation belong to Luther and
 * Barbara, and this file's job is to hold them correctly once they exist.
 */

export class CommissionError extends Error {}

/** 10,000 basis points is one hundred percent. 1500 is fifteen. */
export const BP = 10000;

/**
 * A rate this high is almost certainly a typo, not a deal. The cap is a guard
 * against a fat finger, not a commercial opinion: an override is possible, it
 * just has to be deliberate.
 */
export const SANITY_CAP_BP = 3500;

export interface MerchantTerms {
  merchant_id: string;
  merchant_name: string;
  /** basis points of the GOODS, never of the delivery fee */
  commission_bp: number;
  /** true only when the merchant has signed and Barbara has countersigned */
  agreed: boolean;
  /** the day it was agreed, or null while it is still a proposal */
  agreed_on: string | null;
  /** where the number came from. A rate with no source cannot be agreed. */
  source: string;
  /** set deliberately when a rate above the sanity cap is genuinely the deal */
  allowAboveCap?: boolean;
}

export function checkTerms(t: MerchantTerms): void {
  if (!Number.isInteger(t.commission_bp)) {
    throw new CommissionError('A commission rate is whole basis points. 1500 is fifteen percent.');
  }
  if (t.commission_bp < 0) throw new CommissionError('A commission rate cannot be less than nothing.');
  if (t.commission_bp > BP) throw new CommissionError('A commission rate cannot be more than the whole basket.');
  if (t.commission_bp > SANITY_CAP_BP && !t.allowAboveCap) {
    throw new CommissionError(
      `${pct(t.commission_bp)} is above the ${pct(SANITY_CAP_BP)} sanity cap. If that really is the deal, say so deliberately.`,
    );
  }
  if (t.agreed && !t.source.trim()) {
    throw new CommissionError('A rate cannot be agreed without saying where it came from.');
  }
  if (t.agreed && !t.agreed_on) {
    throw new CommissionError('An agreed rate needs the day it was agreed.');
  }
}

export function pct(bp: number): string {
  const whole = Math.floor(bp / 100);
  const rest = bp % 100;
  return rest === 0 ? `${whole} percent` : `${whole}.${String(rest).padStart(2, '0')} percent`;
}

export interface CommissionVerdict {
  /** thebe Sprint earns on these goods. Zero whenever the rate is not agreed. */
  thebe: number;
  earned: boolean;
  says: string;
}

/**
 * What Sprint earns on the goods of one order.
 *
 * An unagreed rate earns nothing. That is the whole safety of this file: a rate
 * typed in during a negotiation cannot start taking money from a merchant because
 * somebody forgot it was only a proposal.
 */
export function commissionOn(goodsThebe: number, terms: MerchantTerms | null): CommissionVerdict {
  if (!terms) {
    return { thebe: 0, earned: false, says: 'No terms on file for this merchant, so nothing is taken.' };
  }
  checkTerms(terms);
  if (!Number.isInteger(goodsThebe) || goodsThebe < 0) {
    throw new CommissionError('Goods are whole thebe, and cannot be less than nothing.');
  }
  if (!terms.agreed) {
    return {
      thebe: 0,
      earned: false,
      says: `${pct(terms.commission_bp)} is proposed for ${terms.merchant_name} and not agreed, so nothing is taken.`,
    };
  }
  const thebe = Math.round((goodsThebe * terms.commission_bp) / BP);
  return {
    thebe,
    earned: true,
    says: `${pct(terms.commission_bp)} of the goods, agreed ${terms.agreed_on}`,
  };
}

/** What the merchant is left with after Sprint's share of the goods. */
export function merchantNets(goodsThebe: number, terms: MerchantTerms | null): number {
  return goodsThebe - commissionOn(goodsThebe, terms).thebe;
}

/* ------------------------------------------------------------------ the deal */

export interface RateOption {
  bp: number;
  label: string;
  sprint_earns_thebe: number;
  merchant_keeps_thebe: number;
}

/**
 * What a month of this merchant's baskets would earn at each rate being
 * discussed, so a negotiation is done against arithmetic instead of a feeling.
 *
 * The delivery fees are passed in separately and deliberately: they are earned
 * whatever the commission is, and adding them to the commission column is how a
 * rate ends up looking better than it is.
 */
export function whatRatesWouldEarn(
  monthlyGoodsThebe: number,
  rates: number[] = [500, 1000, 1500, 2000, 2500],
): RateOption[] {
  if (!Number.isInteger(monthlyGoodsThebe) || monthlyGoodsThebe < 0) {
    throw new CommissionError('A month of goods is whole thebe, and cannot be less than nothing.');
  }
  return rates
    .filter((bp) => Number.isInteger(bp) && bp >= 0 && bp <= BP)
    .sort((a, b) => a - b)
    .map((bp) => {
      const earns = Math.round((monthlyGoodsThebe * bp) / BP);
      return {
        bp,
        label: pct(bp),
        sprint_earns_thebe: earns,
        merchant_keeps_thebe: monthlyGoodsThebe - earns,
      };
    });
}

/**
 * The question nobody could answer before this file existed: at this merchant's
 * volume, is the commission or the delivery fee the bigger line? If the fee wins,
 * the rate is too low to be worth arguing about and the conversation should be
 * about volume instead.
 */
export function whichEarnsMore(
  monthlyGoodsThebe: number,
  monthlyDeliveryFeesThebe: number,
  terms: MerchantTerms | null,
): { commission: number; fees: number; bigger: 'commission' | 'fees' | 'level'; says: string } {
  const commission = commissionOn(monthlyGoodsThebe, terms).thebe;
  const fees = monthlyDeliveryFeesThebe;
  const bigger = commission === fees ? 'level' : commission > fees ? 'commission' : 'fees';
  return {
    commission,
    fees,
    bigger,
    says:
      bigger === 'fees'
        ? 'The delivery fees earn more than the commission here, so volume matters more than the rate.'
        : bigger === 'commission'
          ? 'The commission earns more than the delivery fees here, so the rate is the thing to negotiate.'
          : 'The commission and the delivery fees earn the same here.',
  };
}
```

---

## api/src/orders/cash.ts

```typescript
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

## api/src/orders/corporate.ts

```typescript
/**
 * Brick 35. Corporate accounts.
 *
 * This is where the money already is. The banks and the land boards are on contract today and they
 * do not pay per delivery with a card at a gate. They order against an account, they split the cost
 * across their own cost centres, and finance pays one invoice a month.
 *
 * Neither Wanzy nor Zebras can do this at all, and it is the whole reason the app is worth building
 * for an incumbent rather than a startup. A consumer app that cannot invoice a bank is a consumer
 * app. This file is the difference.
 *
 * Three rules, each learned from how these accounts actually go wrong:
 *
 *   1. EVERY ORDER CARRIES A COST CENTRE. A corporate customer whose invoice cannot be split by
 *      department will not pay it, they will query it, and the query takes longer than the delivery.
 *   2. THE CREDIT LIMIT IS CHECKED WHEN THE ORDER IS PLACED, not when the invoice is raised. A
 *      limit discovered at month end is a limit that was never a limit.
 *   3. PRICES ARE ALREADY ALL INCLUSIVE. The domestic tariff includes VAT and the fuel surcharge,
 *      so an invoice that adds either on top double charges the customer. That is how a bank stops
 *      trusting a supplier.
 */

export interface CostCentre {
  code: string;
  name: string;
}

export interface CorporateAccount {
  id: string;
  company: string;
  /** Who at the company approves the bill. Never the same person who places orders. */
  billing_contact: string;
  billing_email: string;
  /** In thebe. Zero means no limit was agreed, which is treated as no credit at all. */
  credit_limit: number;
  payment_terms_days: number;
  cost_centres: CostCentre[];
  active: boolean;
}

export interface CorporateOrder {
  order_id: string;
  account_id: string;
  cost_centre: string;
  /** In thebe, all inclusive. */
  amount: number;
  placed_at: string;
  description: string;
}

export class CorporateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CorporateError';
  }
}

export function pula(thebe: number): string {
  return `P${(thebe / 100).toFixed(2)}`;
}

/** Can this account place this order right now. Checked at order time, never at invoice time. */
export function canOrder(
  account: CorporateAccount,
  outstanding: number,
  amount: number,
  costCentre: string,
): { allowed: boolean; says: string } {
  if (!account.active) {
    return { allowed: false, says: `The ${account.company} account is on hold. Please speak to your account manager.` };
  }
  if (!account.cost_centres.some((c) => c.code === costCentre)) {
    const codes = account.cost_centres.map((c) => c.code).join(', ');
    return { allowed: false, says: `Choose which cost centre this is for. Yours are ${codes}.` };
  }
  if (account.credit_limit <= 0) {
    return { allowed: false, says: `No credit limit has been agreed for ${account.company} yet.` };
  }
  if (outstanding + amount > account.credit_limit) {
    const room = Math.max(0, account.credit_limit - outstanding);
    return {
      allowed: false,
      says: `This would take ${account.company} past its limit of ${pula(account.credit_limit)}. There is ${pula(room)} left.`,
    };
  }
  return { allowed: true, says: 'Charged to the account' };
}

export interface StatementLine {
  cost_centre: string;
  cost_centre_name: string;
  orders: number;
  total: number;
}

export interface Statement {
  account: string;
  company: string;
  number: string;
  period_from: string;
  period_to: string;
  due_date: string;
  lines: StatementLine[];
  orders: CorporateOrder[];
  total: number;
  all_inclusive: true;
  note: string;
}

/** Invoice numbers a person can read out over the phone, and that sort in order. */
export function statementNumber(accountId: string, periodFrom: string): string {
  const d = new Date(periodFrom);
  const ym = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return `SPR-${accountId.toUpperCase()}-${ym}`;
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * One month, split the way the customer's own finance team needs to see it. Refuses rather than
 * quietly dropping an order whose cost centre was never set, because a missing line is the thing
 * that gets an invoice queried.
 */
export function statement(
  account: CorporateAccount,
  orders: CorporateOrder[],
  periodFrom: string,
  periodTo: string,
): Statement {
  const mine = orders.filter((o) => o.account_id === account.id);
  const from = Date.parse(periodFrom);
  const to = Date.parse(periodTo);
  if (!(to > from)) throw new CorporateError('The period must end after it starts.');

  const inPeriod = mine.filter((o) => {
    const t = Date.parse(o.placed_at);
    return t >= from && t <= to;
  });

  const known = new Map(account.cost_centres.map((c) => [c.code, c.name]));
  const orphan = inPeriod.filter((o) => !known.has(o.cost_centre));
  if (orphan.length) {
    throw new CorporateError(
      `${orphan.length} order${orphan.length === 1 ? '' : 's'} have no cost centre on this account ` +
        `(${orphan.map((o) => o.order_id).join(', ')}). Fix them before invoicing, or the customer will query it.`,
    );
  }

  const byCentre = new Map<string, StatementLine>();
  for (const o of inPeriod) {
    const line = byCentre.get(o.cost_centre) ?? {
      cost_centre: o.cost_centre,
      cost_centre_name: known.get(o.cost_centre) as string,
      orders: 0,
      total: 0,
    };
    line.orders += 1;
    line.total += o.amount;
    byCentre.set(o.cost_centre, line);
  }

  const lines = [...byCentre.values()].sort((a, b) => b.total - a.total);
  const total = lines.reduce((a, l) => a + l.total, 0);

  return {
    account: account.id,
    company: account.company,
    number: statementNumber(account.id, periodFrom),
    period_from: periodFrom.slice(0, 10),
    period_to: periodTo.slice(0, 10),
    due_date: addDays(periodTo, account.payment_terms_days),
    lines,
    orders: inPeriod.sort((a, b) => a.placed_at.localeCompare(b.placed_at)),
    total,
    all_inclusive: true,
    note: 'Every amount already includes VAT and the fuel surcharge. Nothing is added on top.',
  };
}

/** What the account owes right now, for the limit check on the next order. */
export function outstanding(orders: CorporateOrder[], accountId: string, paidUpTo?: string): number {
  const cutoff = paidUpTo ? Date.parse(paidUpTo) : -Infinity;
  return orders
    .filter((o) => o.account_id === accountId && Date.parse(o.placed_at) > cutoff)
    .reduce((a, o) => a + o.amount, 0);
}

/** The one line an account manager needs to see on a list of accounts. */
export function health(account: CorporateAccount, owed: number): string {
  if (!account.active) return `${account.company}: on hold`;
  if (account.credit_limit <= 0) return `${account.company}: no limit agreed`;
  const pct = Math.round((owed / account.credit_limit) * 100);
  if (pct >= 90) return `${account.company}: ${pct} percent of limit used, nearly blocked`;
  if (pct >= 70) return `${account.company}: ${pct} percent of limit used`;
  return `${account.company}: ${pula(owed)} owed of ${pula(account.credit_limit)}`;
}
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

## api/src/orders/liquor.ts

```typescript
/**
 * Brick 26. Liquor.
 *
 * A deliberate decision sits at the top of this file. **The app does not know the law, and does not
 * pretend to.** Botswana's Trade Act repealed the old Trade and Liquor Act, the liquor statute that
 * replaced it is not on this machine, and a trading hour invented by a delivery company is a
 * criminal offence waiting to happen.
 *
 * So the rule is the merchant's own licence. Every liquor licence names its holder, its premises,
 * the hours it permits and the day it expires. The app holds a copy of that licence and enforces
 * exactly what it says, nothing more and nothing less. If no licence is on file, no liquor moves.
 * That is both safer and more correct than any national constant, because hours differ by licence
 * type and by premises.
 *
 * The insight that makes this different from a shop till: **the time that matters is the HANDOVER,
 * not the order.** A customer ordering at five to eight for a delivery that arrives at half past is
 * a breach of the licence, and the person holding the bottle at the door is Sprint's rider. So the
 * check is run against when it will actually arrive.
 *
 * Age is checked at the door by brick 21, which refuses a handover without a document. Nothing here
 * duplicates that; this file decides whether the order may exist at all.
 */

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export const WEEKDAYS: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** Minutes from midnight. A closed day is simply absent from the map. */
export interface Hours {
  from: number;
  to: number;
}

export interface LiquorLicence {
  /** As printed on the licence. Quoted back to a customer or an inspector. */
  number: string;
  holder: string;
  premises: string;
  /** Copied off the licence itself, per day. A day with no entry is a day it may not trade. */
  hours: Partial<Record<Weekday, Hours>>;
  /** ISO date. The app stops selling the day after this, with no argument. */
  expires: string;
  /** Where the copy on file came from, so nobody has to wonder. */
  source: string;
}

export class LiquorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LiquorError';
  }
}

/** A licence inside this many days is flagged to the office, which is the director sweep question. */
export const EXPIRY_WARNING_DAYS = 60;

export function hhmm(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

export function parseTime(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) throw new LiquorError(`${s} is not a time. Use 24 hour clock, like 10:00 or 20:30.`);
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) throw new LiquorError(`${s} is not a real time.`);
  return h * 60 + mi;
}

function dayOf(iso: string): Weekday {
  return WEEKDAYS[new Date(iso).getUTCDay()];
}

function minutesOf(iso: string): number {
  const d = new Date(iso);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export interface Verdict {
  allowed: boolean;
  says: string;
  /** For the ops board. Nothing here is a guess about the law, only about this licence. */
  reason: 'no_licence' | 'expired' | 'closed_today' | 'outside_hours' | 'ok';
}

/**
 * May this merchant hand liquor over at this moment. Pass the time the order will ARRIVE, not the
 * time it was placed.
 */
export function mayHandOver(licence: LiquorLicence | null, arrivesAtISO: string): Verdict {
  if (!licence) {
    return {
      allowed: false,
      reason: 'no_licence',
      says: 'No liquor licence is on file for this shop, so Sprint cannot carry liquor for them.',
    };
  }
  const arrives = Date.parse(arrivesAtISO);
  if (Number.isNaN(arrives)) throw new LiquorError('The arrival time is not a real time.');

  const expiresEnd = Date.parse(licence.expires + 'T23:59:59Z');
  if (arrives > expiresEnd) {
    return {
      allowed: false,
      reason: 'expired',
      says: `Licence ${licence.number} expired on ${licence.expires}. Nothing may be carried for them until it is renewed.`,
    };
  }

  const day = dayOf(arrivesAtISO);
  const window = licence.hours[day];
  if (!window) {
    return {
      allowed: false,
      reason: 'closed_today',
      says: `Licence ${licence.number} does not permit trading on a ${longDay(day)}.`,
    };
  }

  const at = minutesOf(arrivesAtISO);
  if (at < window.from || at > window.to) {
    return {
      allowed: false,
      reason: 'outside_hours',
      says: `It would arrive at ${hhmm(at)}, and licence ${licence.number} permits ${longDay(day)} only between ${hhmm(window.from)} and ${hhmm(window.to)}.`,
    };
  }

  return {
    allowed: true,
    reason: 'ok',
    says: `Arriving ${hhmm(at)}, inside the hours on licence ${licence.number}. The rider still checks a document at the door.`,
  };
}

function longDay(d: Weekday): string {
  return { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' }[d];
}

/**
 * The last moment an order can be promised for today, so a customer is told before they pay rather
 * than after. Null when the shop may not trade today at all.
 */
export function latestArrivalToday(licence: LiquorLicence, nowISO: string): string | null {
  const day = dayOf(nowISO);
  const w = licence.hours[day];
  if (!w) return null;
  const d = new Date(nowISO);
  d.setUTCHours(Math.floor(w.to / 60), w.to % 60, 0, 0);
  return d.toISOString();
}

/** Days until this licence runs out. Negative once it has. */
export function daysLeft(licence: LiquorLicence, nowISO?: string): number {
  const now = nowISO ? Date.parse(nowISO) : Date.now();
  return Math.floor((Date.parse(licence.expires + 'T23:59:59Z') - now) / 86_400_000);
}

/** The director sweep question: what is running out inside sixty days. */
export function expiringSoon(licences: LiquorLicence[], nowISO?: string): Array<{ licence: LiquorLicence; days: number; says: string }> {
  return licences
    .map((l) => ({ licence: l, days: daysLeft(l, nowISO) }))
    .filter((x) => x.days <= EXPIRY_WARNING_DAYS)
    .sort((a, b) => a.days - b.days)
    .map((x) => ({
      ...x,
      says: x.days < 0
        ? `${x.licence.holder} licence ${x.licence.number} EXPIRED ${Math.abs(x.days)} days ago. They are switched off.`
        : `${x.licence.holder} licence ${x.licence.number} runs out in ${x.days} days.`,
    }));
}

/** Check a licence record is complete enough to rely on, before it is trusted with anything. */
export function checkLicenceRecord(l: Partial<LiquorLicence>): string[] {
  const missing: string[] = [];
  if (!l.number) missing.push('the licence number');
  if (!l.holder) missing.push('who holds it');
  if (!l.premises) missing.push('the premises it covers');
  if (!l.expires || !/^\d{4}-\d{2}-\d{2}$/.test(l.expires)) missing.push('the expiry date');
  if (!l.hours || Object.keys(l.hours).length === 0) missing.push('the permitted hours, copied off the licence');
  if (!l.source) missing.push('where the copy on file came from');
  return missing;
}
```

---

## api/src/catalog/verticals.ts

```typescript
/**
 * Verticals: one app, many kinds of shop.
 *
 * The Sixty60 move, which Luther brought back on 15 September 2026: they did not
 * build seven apps. They built one and taught it that a shop has a KIND, and that
 * each kind carries its own rules. A pharmacy needs a pharmacist. A bottle store
 * needs a licence and trading hours. A pet shop needs neither.
 *
 * The rules are written here, in one place, rather than scattered through screens,
 * because a screen can be redesigned by anybody and a rule must not be. Two of them
 * are law, not preference:
 *
 *   - PHARMACY IS BLOCKED IN CODE. Brick 8 is still open: BoMRA has not answered in
 *     writing whether a licensed courier may carry a sealed, pharmacist dispensed
 *     prescription, and nothing public was found on whether they licence online
 *     pharmacy at all. Until that letter exists this vertical cannot be listed, and
 *     removing the block requires editing this file and saying why in the commit.
 *   - LIQUOR DEFERS TO THE EXISTING ENGINE. orders/liquor.ts already holds the
 *     licence, the trading hours and a sixty day expiry warning. Nothing here
 *     re-implements any of that; this file only says that liquor HAS those gates.
 *
 * Adding a shop type is now a row in VERTICALS, not a new codebase.
 */

export type Vertical =
  | 'food'
  | 'grocery'
  | 'liquor'
  | 'pharmacy'
  | 'pet'
  | 'hardware'
  | 'baby'
  | 'parcel';

export interface VerticalRules {
  /** what a customer sees above the row of shops */
  label: string;
  /** where the row sits on the home page, lowest first */
  order: number;
  /** the rider checks identity at the door */
  ageRestricted: boolean;
  /** the merchant must have a licence on file before it may be listed */
  licenceRequired: boolean;
  /** handover only inside the merchant's licensed hours, judged on arrival */
  tradingHours: boolean;
  /** the item must be dispensed and sealed by a pharmacist before collection */
  prescription: boolean;
  /** a cold box is required where the item is flagged */
  coldChain: boolean;
  /**
   * A named external thing that must exist before this vertical may go live at
   * all. Null means nothing outside this building is in the way.
   */
  blockedBy: string | null;
}

export const VERTICALS: Record<Vertical, VerticalRules> = {
  food: {
    label: 'Restaurants',
    order: 1,
    ageRestricted: false,
    licenceRequired: false,
    tradingHours: false,
    prescription: false,
    coldChain: false,
    blockedBy: null,
  },
  grocery: {
    label: 'Groceries',
    order: 2,
    ageRestricted: false,
    licenceRequired: false,
    tradingHours: false,
    prescription: false,
    coldChain: true, // frozen and chilled baskets travel in a cold box
    blockedBy: null,
  },
  pet: {
    label: 'Pet and vet',
    order: 3,
    ageRestricted: false,
    licenceRequired: false,
    tradingHours: false,
    prescription: false,
    coldChain: false,
    blockedBy: null,
  },
  hardware: {
    label: 'Hardware and home',
    order: 4,
    ageRestricted: false,
    licenceRequired: false,
    tradingHours: false,
    prescription: false,
    coldChain: false,
    blockedBy: null,
  },
  baby: {
    label: 'Baby and kids',
    order: 5,
    ageRestricted: false,
    licenceRequired: false,
    tradingHours: false,
    prescription: false,
    coldChain: false,
    blockedBy: null,
  },
  parcel: {
    label: 'Send a parcel',
    order: 6,
    ageRestricted: false,
    licenceRequired: false,
    tradingHours: false,
    prescription: false,
    coldChain: false,
    blockedBy: null,
  },
  liquor: {
    label: 'Liquor',
    order: 7,
    ageRestricted: true,
    licenceRequired: true,
    tradingHours: true,
    prescription: false,
    coldChain: false,
    blockedBy: null, // the gates are built; a merchant licence is a merchant problem
  },
  pharmacy: {
    label: 'Pharmacy',
    order: 8,
    ageRestricted: true,
    licenceRequired: true,
    tradingHours: false,
    prescription: true,
    coldChain: true,
    blockedBy:
      "BoMRA's written answer on carrying a sealed, pharmacist dispensed prescription (brick 8)",
  },
};

/** Every vertical, in the order the home page draws them. */
export function allVerticals(): Vertical[] {
  return (Object.keys(VERTICALS) as Vertical[]).sort(
    (a, b) => VERTICALS[a].order - VERTICALS[b].order,
  );
}

export function isVertical(v: string): v is Vertical {
  return Object.prototype.hasOwnProperty.call(VERTICALS, v);
}

export function rulesFor(v: Vertical): VerticalRules {
  return VERTICALS[v];
}

/** The gates a rider or a screen must honour for this kind of shop. */
export function gatesFor(v: Vertical): string[] {
  const r = VERTICALS[v];
  const gates: string[] = [];
  if (r.ageRestricted) gates.push('identity checked at the door');
  if (r.licenceRequired) gates.push('merchant licence on file');
  if (r.tradingHours) gates.push('handover inside licensed hours');
  if (r.prescription) gates.push('pharmacist dispensed and sealed');
  if (r.coldChain) gates.push('cold box where flagged');
  return gates;
}

export interface ListingVerdict {
  listable: boolean;
  reason: string | null;
}

/**
 * May a shop of this kind appear in the app at all?
 *
 * This answers the question ABOUT THE VERTICAL, not about one merchant's paperwork.
 * A merchant missing its own liquor licence is caught later by orders/liquor.ts at
 * handover, which is where it belongs, because a licence can lapse between the
 * listing and the door.
 */
export function mayList(v: Vertical): ListingVerdict {
  const r = VERTICALS[v];
  if (r.blockedBy) return { listable: false, reason: r.blockedBy };
  return { listable: true, reason: null };
}

export interface MerchantLike {
  id: string;
  type: string;
  [k: string]: unknown;
}

export interface VerticalSection<T extends MerchantLike> {
  vertical: Vertical;
  label: string;
  gates: string[];
  merchants: T[];
}

/**
 * Group merchants into the rows the home page draws.
 *
 * Empty rows are dropped, so a vertical with no signed merchant never shows the
 * customer an empty shelf. Blocked verticals are dropped even when a merchant
 * exists, which is the point: seed data must never be able to put a pharmacy in
 * front of a customer before BoMRA has answered.
 *
 * A merchant whose type is not a known vertical is returned in `unplaced` rather
 * than silently dropped, because a shop that exists and is invisible is the worst
 * of the three outcomes and somebody has to see it.
 */
export function groupByVertical<T extends MerchantLike>(
  merchants: T[],
): { sections: VerticalSection<T>[]; unplaced: T[]; blocked: Vertical[] } {
  const unplaced: T[] = [];
  const bucket = new Map<Vertical, T[]>();

  for (const m of merchants) {
    if (!isVertical(m.type)) {
      unplaced.push(m);
      continue;
    }
    const list = bucket.get(m.type) ?? [];
    list.push(m);
    bucket.set(m.type, list);
  }

  const sections: VerticalSection<T>[] = [];
  const blocked: Vertical[] = [];

  for (const v of allVerticals()) {
    const found = bucket.get(v);
    if (!found || found.length === 0) continue;
    if (!mayList(v).listable) {
      blocked.push(v);
      continue;
    }
    sections.push({
      vertical: v,
      label: VERTICALS[v].label,
      gates: gatesFor(v),
      merchants: found,
    });
  }

  return { sections, unplaced, blocked };
}
```

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

## api/src/orders/orders.service.ts

```typescript
import { BadRequestException, ForbiddenException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { OrdersRepo } from '../data-store/repositories/orders.repo';
import { MerchantsRepo } from '../data-store/repositories/merchants.repo';
import { CouriersRepo } from '../data-store/repositories/couriers.repo';
import { OutboxRepo } from '../data-store/repositories/outbox.repo';
import { StoreService } from '../data-store/store.service';
import { encrypt } from '../common/aes';
import { randomPointInGaborone } from '../common/waypoints';
import { CreateOrderDto } from './dto';
import { PaymentMethod } from '../common/types';
import { OrderRecord } from '../data-store/interfaces';

const PAYMENT_METHODS: PaymentMethod[] = ['orange_money', 'myzaka', 'smega', 'card', 'cash'];

// Random 6 to 10 second gap before the simulator advances an order to its
// next lifecycle step, scaled by DEMO_SPEED so the whole demo can run
// faster or slower without touching any other code.
export function nextStepDelayMs(): number {
  const speed = Number(process.env.DEMO_SPEED) || 1;
  const seconds = 6 + Math.random() * 4;
  return Math.round((seconds * 1000) / speed);
}

// Shape returned to API clients for both POST /orders and GET /orders/:id.
// Never includes the encrypted address ciphertext, that stays in
// data/store.json as the demo's "look, it's really encrypted" talking point.
export function toPublicOrder(
  order: OrderRecord,
  courier?: { name: string; rating: number; lat: number; lng: number } | null,
  merchantName?: string,
) {
  return {
    id: order.id,
    merchant_id: order.merchant_id,
    merchant_name: merchantName,
    items: order.items,
    total_bwp: order.total_bwp,
    payment_method: order.payment_method,
    status: order.status,
    timeline: order.timeline,
    courier: courier || undefined,
    eta_min: order.eta_min,
    created_at: order.created_at,
  };
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly ordersRepo: OrdersRepo,
    private readonly merchantsRepo: MerchantsRepo,
    private readonly couriersRepo: CouriersRepo,
    private readonly outboxRepo: OutboxRepo,
    private readonly store: StoreService,
  ) {}

  create(userId: string, dto: CreateOrderDto, idempotencyKey: string) {
    if (!idempotencyKey) {
      throw new BadRequestException('An Idempotency-Key header is needed so we never double place an order.');
    }

    const existing = this.ordersRepo.findByIdempotency(userId, idempotencyKey);
    if (existing) {
      return this.buildResponse(existing);
    }

    if (!dto || !dto.merchant_id) {
      throw new BadRequestException('merchant_id is needed.');
    }
    const merchant = this.merchantsRepo.findById(dto.merchant_id);
    if (!merchant) {
      throw new BadRequestException('We could not find that merchant.');
    }
    if (!Array.isArray(dto.items) || dto.items.length === 0) {
      throw new BadRequestException('Please add at least one item to the order.');
    }
    if (!PAYMENT_METHODS.includes(dto.payment_method)) {
      throw new BadRequestException('That payment method is not one we support yet.');
    }
    if (!dto.address || !dto.address.trim()) {
      throw new BadRequestException('A delivery address is needed.');
    }

    if (merchant.type === 'vape' && dto.age_confirmed !== true) {
      throw new HttpException({ code: 'AGE_GATE', message: 'Please confirm the customer is 18 or older before we can place this order.' }, 403);
    }

    const orderItems = dto.items.map((it) => {
      const found = merchant.items.find((mi) => mi.id === it.item_id);
      if (!found) {
        throw new BadRequestException(`Item ${it.item_id} is not on ${merchant.name}'s menu.`);
      }
      if (!it.qty || it.qty < 1) {
        throw new BadRequestException(`Quantity for ${found.name} needs to be at least 1.`);
      }
      return { item_id: found.id, name: found.name, qty: it.qty, price_bwp: found.price_bwp };
    });

    const total_bwp = Math.round(
      orderItems.reduce((sum, it) => sum + it.price_bwp * it.qty, 0) * 100,
    ) / 100;

    const point = randomPointInGaborone();
    const now = new Date().toISOString();
    const order: OrderRecord = {
      id: crypto.randomUUID(),
      customer_id: userId,
      merchant_id: merchant.id,
      items: orderItems,
      total_bwp,
      payment_method: dto.payment_method,
      address_enc: encrypt(dto.address.trim()),
      delivery_lat: point.lat,
      delivery_lng: point.lng,
      age_confirmed: dto.age_confirmed === true,
      status: 'placed',
      timeline: [{ status: 'placed', at: now }],
      courier_id: null,
      eta_min: null,
      idempotency_key: idempotencyKey,
      created_at: now,
      next_step_at: Date.now() + nextStepDelayMs(),
    };

    this.ordersRepo.create(order);
    this.ordersRepo.saveIdempotency(userId, idempotencyKey, order.id);
    this.outboxRepo.append('order.placed', order.id, { merchant_id: order.merchant_id, total_bwp: order.total_bwp });

    return this.buildResponse(order);
  }

  getById(id: string, requester: { sub: string; role: string }) {
    const order = this.ordersRepo.findById(id);
    // A stranger who guesses a UUID should never learn whether it belongs
    // to someone else, so a denied view looks exactly like a missing one.
    if (!order || !this.canView(order, requester)) {
      throw new NotFoundException('We could not find that order.');
    }
    return this.buildResponse(order);
  }

  // Customers see only their own order, the assigned courier sees only the
  // order they are delivering, ops can see any order.
  private canView(order: OrderRecord, requester: { sub: string; role: string }): boolean {
    if (requester.role === 'ops') return true;
    if (order.customer_id === requester.sub) return true;
    if (requester.role === 'courier' && order.courier_id) {
      const courierUser = this.store.state.users.find((u) => u.id === requester.sub);
      return courierUser?.courier_id === order.courier_id;
    }
    return false;
  }

  private buildResponse(order: OrderRecord) {
    let courier: { name: string; rating: number; lat: number; lng: number } | null = null;
    if (order.courier_id) {
      const c = this.couriersRepo.findById(order.courier_id);
      if (c) courier = { name: c.name, rating: c.rating, lat: c.lat, lng: c.lng };
    }
    const merchant = this.merchantsRepo.findById(order.merchant_id);
    return toPublicOrder(order, courier, merchant?.name);
  }
}
```

---

## api/src/data-store/repositories/ledger.repo.ts

```typescript
import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { StoreService } from '../store.service';
import { LedgerEntryRecord } from '../interfaces';
import { ILedgerRepo } from '../repo-interfaces';

// Writes the payout split for a delivered order as real double entry rows:
// every split (merchant_payable, courier_earnings, sprint_take) gets a debit
// against a clearing account and a matching credit against its own account,
// so the rows always balance in pairs.
/**
 * INVENTED FIGURES. NOT A COMMERCIAL AGREEMENT. Found 15 September 2026 while
 * checking the settlement rules, and named here rather than left loose in the
 * arithmetic.
 *
 * These 75 and 18 percent shares contradict the settlement engine, which is the
 * file that decides what anybody is actually paid. settlement.ts pays a merchant
 * ONE HUNDRED percent of the goods on a delivered order and keeps only the
 * delivery fee for Sprint. This repository splits the same order three ways.
 *
 * They disagree because they were written for different purposes: this one only
 * feeds the simulator, and simulator.service.ts is the only caller. Nobody is
 * paid from it. But a file called a ledger, writing double entry rows that
 * balance, is exactly the thing somebody trusts later without reading it, so the
 * numbers are marked rather than tidied away.
 *
 * Neither model can be the real one until Barbara agrees the fault model, which
 * docs/FAULT_MODEL.md still records as "Status: proposed. Not yet agreed by
 * Barbara." A test holds `agreed` at false so this cannot quietly become policy.
 */
export const SIMULATOR_SPLIT = {
  merchant: 0.75,
  courier: 0.18,
  /** Sprint takes the remainder, so the three always sum to the order exactly. */
  agreed: false,
  contradicts:
    'settlement.ts pays the merchant 100 percent of goods and gives Sprint only the delivery fee',
} as const;

@Injectable()
export class LedgerRepo implements ILedgerRepo {
  constructor(private readonly store: StoreService) {}

  writeOrderSplit(orderId: string, totalBwp: number): LedgerEntryRecord[] {
    const merchantAmt = Math.round(totalBwp * SIMULATOR_SPLIT.merchant * 100) / 100;
    const courierAmt = Math.round(totalBwp * SIMULATOR_SPLIT.courier * 100) / 100;
    // Sprint's cut takes the remainder so the three splits always sum to
    // the exact order total, rounding included.
    const sprintAmt = Math.round((totalBwp - merchantAmt - courierAmt) * 100) / 100;

    const now = new Date().toISOString();
    const rows: LedgerEntryRecord[] = [];
    const pairs: [string, number][] = [
      ['merchant_payable', merchantAmt],
      ['courier_earnings', courierAmt],
      ['sprint_take', sprintAmt],
    ];

    for (const [account, amount] of pairs) {
      rows.push({
        id: crypto.randomUUID(),
        order_id: orderId,
        account: 'cash_clearing',
        type: 'debit',
        amount_bwp: amount,
        created_at: now,
      });
      rows.push({
        id: crypto.randomUUID(),
        order_id: orderId,
        account,
        type: 'credit',
        amount_bwp: amount,
        created_at: now,
      });
    }

    this.store.state.ledger_entries.push(...rows);
    this.store.persist();
    return rows;
  }
}
```

---

## api/src/orders/money_models.test.ts

```typescript
/**
 * Two money models live in this codebase and they disagree. This file holds that
 * fact still so nobody has to rediscover it.
 *
 * Found 15 September 2026 while checking the settlement rules, after the P200
 * cash ceiling had already shown that a number can sit under passing tests for
 * weeks and still be wrong.
 *
 *   settlement.ts        pays a merchant 100 percent of the goods on a delivered
 *                        order, and Sprint keeps only the delivery fee.
 *   ledger.repo.ts       splits the same order 75 percent merchant, 18 percent
 *                        courier, the remainder to Sprint.
 *
 * Only the first one decides what anybody is paid. The second feeds the
 * simulator and nothing else. Neither is policy: docs/FAULT_MODEL.md still says
 * "Status: proposed. Not yet agreed by Barbara."
 *
 * These tests do not pick a winner. That is Barbara's decision and Luther's.
 * They make sure the disagreement cannot be forgotten, cannot drift, and cannot
 * quietly become the thing that pays real merchants.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settleOne, dayPayout, readyToPay, type SettleableOrder } from './settlement';
import { SIMULATOR_SPLIT } from '../data-store/repositories/ledger.repo';

const order = (over: Partial<SettleableOrder> = {}): SettleableOrder => ({
  order_id: 'SPR-1',
  merchant_id: 'M1',
  merchant_name: 'Broadhurst Hardware',
  goods: 20000, // P200
  delivery_fee: 2500, // P25
  rail: 'cash',
  fault: 'none',
  delivered: true,
  perishable: false,
  ...over,
});

test('SETTLEMENT TAKES NO COMMISSION: a delivered order pays the merchant every thebe of the goods', () => {
  const s = settleOne(order());
  assert.equal(s.merchant, 20000, 'the merchant is paid the goods in full');
  assert.equal(s.sprint_fee, 2500, 'Sprint keeps only the delivery fee');
  assert.equal(s.merchant + s.sprint_fee, 22500);
});

test('so Sprint earns the delivery fee and nothing else on the basket', () => {
  const s = settleOne(order({ goods: 500000 })); // a P5000 basket
  assert.equal(s.sprint_fee, 2500, 'a twenty five times bigger basket earns Sprint the same P25');
  assert.equal(s.merchant, 500000);
});

test('THE OTHER MODEL DISAGREES, and it is marked as not agreed', () => {
  assert.equal(SIMULATOR_SPLIT.agreed, false, 'this became policy without anybody saying so');
  assert.equal(SIMULATOR_SPLIT.merchant, 0.75);
  assert.equal(SIMULATOR_SPLIT.courier, 0.18);
  assert.match(SIMULATOR_SPLIT.contradicts, /100 percent/);
});

test('the two models really do disagree, by a quarter of every basket', () => {
  const o = order();
  const bySettlement = settleOne(o).merchant;
  const byLedger = Math.round(o.goods * SIMULATOR_SPLIT.merchant);
  assert.notEqual(bySettlement, byLedger);
  assert.equal(bySettlement - byLedger, 5000, 'P50 on a P200 basket, every time');
});

test('nothing can be paid to anybody until Barbara agrees the fault model', () => {
  const day = dayPayout('2026-09-15', [order()], false);
  const verdict = readyToPay(day);
  assert.equal(verdict.ready, false);
  assert.match(verdict.says, /still a proposal|Barbara/);
});

test('and the day total says so on its face, not in a footnote', () => {
  const day = dayPayout('2026-09-15', [order()], false);
  assert.match(day.says, /NOT PAYABLE/);
});

test('even once agreed, the day only pays what the rules worked out', () => {
  const agreed = dayPayout('2026-09-15', [order()], true);
  assert.equal(readyToPay(agreed).ready, true);
  assert.equal(agreed.total, 20000, 'the merchant is owed the goods in full, no commission taken');
});

test('a fault that is nobody s does not quietly punish the merchant', () => {
  const s = settleOne(order({ delivered: false, fault: 'none', perishable: true }));
  assert.equal(s.perishable_loss, 20000, 'goods that cannot go back on a shelf are covered');
  assert.equal(s.sprint_fee, 0, 'Sprint does not charge for a delivery that did not happen');
});

test('when Sprint is at fault, Sprint carries it, including the fee it did not earn', () => {
  const s = settleOne(order({ delivered: false, fault: 'sprint', perishable: true }));
  assert.equal(s.sprint_absorbs, 20000 + 2500);
  assert.equal(s.merchant, 0);
});
```

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

## api/src/orders/cash.test.ts

```typescript
/**
 * Brick 18's cash half. Run with:
 *   npm --prefix api run test:orders
 *
 * The reconciliation tests are the ones that matter. Until that number exists nobody can say what
 * cash costs Sprint, and the director question about what leaks unbilled has no answer.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cashAllowed,
  changeFor,
  floatFor,
  reconcile,
  needsCashPhoto,
  pula,
  CashError,
  CASH_CAP_THEBE,
  FLOAT_SIGNOFF_THEBE,
  WRITE_OFF_THEBE,
  notesFor,
  canBeHandedOver,
  tendersFor,
  saysNotes,
  NOTES,
} from './cash';

const P = (n: number) => n * 100; // pula to thebe

test('money is counted in whole thebe, never in a decimal that can drift', () => {
  assert.equal(pula(8750), 'P87.50');
  assert.throws(() => cashAllowed(87.5), /whole number of thebe/);
  assert.throws(() => reconcile(0, [], 12.5), /whole number of thebe/);
});

test('a big order cannot be paid in cash, because a rider carrying that much is a target', () => {
  assert.equal(cashAllowed(P(500)).allowed, true);
  assert.equal(cashAllowed(CASH_CAP_THEBE).allowed, true, 'the cap itself is still allowed');
  const over = cashAllowed(CASH_CAP_THEBE + 1);
  assert.equal(over.allowed, false);
  assert.match(over.says, /cannot be paid in cash/);
  assert.throws(() => changeFor(CASH_CAP_THEBE + 1, P(100)), CashError);
});

test('the rider is told exactly what change to bring', () => {
  const c = changeFor(P(87), P(100));
  assert.equal(c.change, P(13));
  assert.match(c.says, /bring P13.00 change/);
  assert.equal(changeFor(P(100), P(100)).change, 0);
  assert.match(changeFor(P(100), P(100)).says, /No change needed/);
});

test('a note that does not cover the order is refused before the rider leaves', () => {
  assert.throws(() => changeFor(P(87), P(50)), /does not cover/);
  /* Still refused, with the wording the contract now uses: no combination of
     Botswana notes makes P75, so there is no sense pretending at the door. */
  assert.throws(() => changeFor(P(87), P(75)), /cannot hand|not an amount anyone can hand over/,
    'no set of notes makes P75');
  /* Changed 15 Sep 2026 with the contract. This used to assert that P500 was
     refused because Botswana has no P500 note. That is true about notes and wrong
     about tenders: a customer hands over two P200s and a P100. Refusing it capped
     every cash order at P200 and made cash useless for a normal basket. */
  assert.equal(changeFor(P(87), P(500)).change, P(413));
  assert.equal(changeFor(P(87), P(500)).handingOver, '2 x P200.00 and a P100.00');
});

test('the float is worked out from the orders actually on the run, not from habit', () => {
  const orders = [
    { order_id: 'o1', total: P(87), paying_with: P(100) },
    { order_id: 'o2', total: P(136), paying_with: P(200) },
    { order_id: 'o3', total: P(150), paying_with: P(200) },
  ];
  const f = floatFor(orders);
  assert.equal(f.float, P(13) + P(64) + P(50));
  assert.deepEqual(f.per_order.map((p) => p.order_id), ['o1', 'o2', 'o3']);
});

test('a big float needs a supervisor to sign for it', () => {
  const small = floatFor([{ order_id: 'o1', total: P(87), paying_with: P(100) }]);
  assert.equal(small.needs_signoff, false);
  const big = floatFor([
    { order_id: 'o1', total: P(10), paying_with: P(200) },
    { order_id: 'o2', total: P(10), paying_with: P(200) },
    { order_id: 'o3', total: P(10), paying_with: P(200) },
  ]);
  assert.ok(big.float > FLOAT_SIGNOFF_THEBE);
  assert.equal(big.needs_signoff, true);
  assert.match(big.says, /supervisor/);
});

test('a shift that balances says so plainly', () => {
  const orders = [
    { order_id: 'o1', total: P(87), paying_with: P(100) },
    { order_id: 'o2', total: P(136), paying_with: P(200) },
  ];
  const floatOut = floatFor(orders).float;
  // Everything collected, correct change given out, nothing lost.
  const expected = floatOut + P(300) - (P(13) + P(64));
  const r = reconcile(floatOut, orders, expected);
  assert.equal(r.difference, 0);
  assert.equal(r.says, 'Balanced exactly');
});

test('a small difference is written off rather than argued over', () => {
  const orders = [{ order_id: 'o1', total: P(87), paying_with: P(100) }];
  const floatOut = floatFor(orders).float;
  const expected = floatOut + P(100) - P(13);
  const r = reconcile(floatOut, orders, expected - WRITE_OFF_THEBE);
  assert.equal(r.within_write_off, true);
  assert.equal(r.short, true);
  assert.match(r.says, /inside the write off, closed/);
});

test('a real shortfall is named, not absorbed', () => {
  const orders = [{ order_id: 'o1', total: P(87), paying_with: P(100) }];
  const floatOut = floatFor(orders).float;
  const expected = floatOut + P(100) - P(13);
  const r = reconcile(floatOut, orders, expected - P(50));
  assert.equal(r.within_write_off, false);
  assert.equal(r.difference, -P(50));
  assert.match(r.says, /SHORT/);
  assert.match(r.says, /needs a person to look at it/);
});

test('too much money is a problem too, not a bonus', () => {
  const orders = [{ order_id: 'o1', total: P(87), paying_with: P(100) }];
  const floatOut = floatFor(orders).float;
  const expected = floatOut + P(100) - P(13);
  const r = reconcile(floatOut, orders, expected + P(20));
  assert.equal(r.short, false);
  assert.match(r.says, /OVER/);
  assert.match(r.says, /needs a person/);
});

test('the expected figure is arithmetic anyone can check by hand', () => {
  const orders = [{ order_id: 'o1', total: P(87), paying_with: P(100) }];
  const r = reconcile(P(13), orders, 0);
  // float out P13, collected P100, change given P13, so P100 should be in the bag
  assert.equal(r.expected, P(13) + P(100) - P(13));
  assert.equal(r.expected, P(100));
});

test('a cash handover over two hundred pula needs a photograph', () => {
  assert.equal(needsCashPhoto(P(199)), false);
  assert.equal(needsCashPhoto(P(200)), true);
  assert.equal(needsCashPhoto(P(200)), true);
});

test('every line a person reads is plain and has no dashes', () => {
  const lines = [
    cashAllowed(P(50)).says,
    cashAllowed(P(2000)).says,
    changeFor(P(87), P(100)).says,
    floatFor([{ order_id: 'o1', total: P(87), paying_with: P(100) }]).says,
    reconcile(P(13), [{ order_id: 'o1', total: P(87), paying_with: P(100) }], P(100)).says,
  ];
  for (const l of lines) {
    assert.ok(l.length > 8, 'a message should say something');
    assert.equal(l.includes(' - '), false, `dash in: ${l}`);
  }
});

/* ---------------------------------------------------------------------------
   People hand over more than one note. Added 15 September 2026 after driving
   the checkout turned up a P223 hardware basket that could not be paid in cash
   at all: the engine offered P200, the largest note in Botswana, then refused
   it for not covering the total. Every cash order above P200 was unpayable.
   --------------------------------------------------------------------------- */

test('THE CEILING: an order over P200 can now be paid, because people hand over more than one note', () => {
  const c = changeFor(P(223), P(250));
  assert.equal(c.change, P(27));
  assert.equal(c.handingOver, 'a P200.00 and a P50.00');
});

test('the notes a person actually hands over are named, biggest first', () => {
  assert.deepEqual(notesFor(P(250)), [P(200), P(50)]);
  assert.deepEqual(notesFor(P(380)), [P(200), P(100), P(50), P(20), P(10)]);
  assert.deepEqual(notesFor(P(10)), [P(10)]);
  assert.deepEqual(notesFor(0), []);
});

test('an amount no set of notes can make is still refused, before the rider leaves', () => {
  assert.equal(notesFor(P(75)), null, 'nothing makes P75');
  assert.equal(notesFor(P(5)), null, 'the smallest note is P10');
  assert.equal(canBeHandedOver(P(75)), false);
  assert.equal(canBeHandedOver(P(250)), true);
});

test('the tenders offered always cover the total, which is what the old list failed to do', () => {
  for (const total of [P(9), P(65), P(189), P(223), P(407), P(950)]) {
    const offers = tendersFor(total);
    assert.ok(offers.length > 0, 'nothing offered for ' + pula(total));
    for (const o of offers) {
      assert.ok(o >= total, pula(o) + ' does not cover ' + pula(total));
      assert.ok(canBeHandedOver(o), pula(o) + ' cannot be handed over');
      assert.doesNotThrow(() => changeFor(total, o));
    }
  }
});

test('the least a customer can hand over is offered first, so change stays small', () => {
  assert.equal(tendersFor(P(223))[0], P(230));
  assert.equal(tendersFor(P(189))[0], P(190));
});

test('the P1000 cap is untouched: it is a security rule, not arithmetic', () => {
  assert.deepEqual(tendersFor(CASH_CAP_THEBE + 1), [], 'over the cap nothing is offered');
  assert.throws(() => changeFor(CASH_CAP_THEBE + 1, P(1000)), CashError);
  for (const o of tendersFor(P(950))) assert.ok(o <= CASH_CAP_THEBE);
});

test('there is still no P500 note, and P500 is still payable', () => {
  assert.equal(NOTES.includes(P(500) as never), false);
  assert.equal(saysNotes(P(500)), '2 x P200.00 and a P100.00');
});
```

---

## api/src/orders/commission.test.ts

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BP,
  SANITY_CAP_BP,
  CommissionError,
  checkTerms,
  pct,
  commissionOn,
  merchantNets,
  whatRatesWouldEarn,
  whichEarnsMore,
  type MerchantTerms,
} from './commission';

const terms = (over: Partial<MerchantTerms> = {}): MerchantTerms => ({
  merchant_id: 'M1',
  merchant_name: 'Broadhurst Hardware',
  commission_bp: 1500,
  agreed: false,
  agreed_on: null,
  source: '',
  ...over,
});

const signed = (over: Partial<MerchantTerms> = {}) =>
  terms({ agreed: true, agreed_on: '2026-09-15', source: 'Signed schedule 2 of the merchant agreement', ...over });

/* ------------- the safety that matters most ------------- */

test('A RATE THAT IS NOT AGREED EARNS NOTHING, however real it looks', () => {
  const v = commissionOn(100000, terms({ commission_bp: 2000 }));
  assert.equal(v.thebe, 0);
  assert.equal(v.earned, false);
  assert.match(v.says, /proposed/);
  assert.match(v.says, /not agreed/);
});

test('a merchant with no terms on file is charged nothing, never a default', () => {
  const v = commissionOn(100000, null);
  assert.equal(v.thebe, 0);
  assert.equal(v.earned, false);
  assert.match(v.says, /No terms on file/);
});

test('a rate cannot be agreed without saying where the number came from', () => {
  assert.throws(() => checkTerms(terms({ agreed: true, agreed_on: '2026-09-15', source: '   ' })),
    /where it came from/);
});

test('an agreed rate must carry the day it was agreed', () => {
  assert.throws(() => checkTerms(terms({ agreed: true, agreed_on: null, source: 'the deal' })),
    /needs the day/);
});

/* ------------- money is integers, never a float ------------- */

test('a rate is whole basis points, so fifteen percent is 1500 and never 0.15', () => {
  assert.throws(() => checkTerms(terms({ commission_bp: 0.15 })), /whole basis points/);
  assert.throws(() => checkTerms(terms({ commission_bp: 15.5 })), CommissionError);
});

test('commission comes out as whole thebe on an awkward basket', () => {
  const v = commissionOn(6533, signed({ commission_bp: 1750 }));
  assert.ok(Number.isInteger(v.thebe), 'a fraction of a thebe came out');
  assert.equal(v.thebe, Math.round((6533 * 1750) / BP));
});

test('a rate below nothing or above the whole basket is refused', () => {
  assert.throws(() => checkTerms(terms({ commission_bp: -1 })), /less than nothing/);
  assert.throws(() => checkTerms(terms({ commission_bp: BP + 1 })), /more than the whole basket/);
});

/* ------------- the fat finger guard ------------- */

test('a rate above the sanity cap is refused, because it is probably a typo', () => {
  assert.throws(() => checkTerms(terms({ commission_bp: 5000 })), /sanity cap/);
  assert.equal(SANITY_CAP_BP, 3500);
});

test('but a rate above the cap can be set deliberately, if that really is the deal', () => {
  assert.doesNotThrow(() => checkTerms(terms({ commission_bp: 5000, allowAboveCap: true })));
});

/* ------------- what it actually earns ------------- */

test('an agreed rate takes its share of the goods and says so plainly', () => {
  const v = commissionOn(20000, signed({ commission_bp: 1500 }));
  assert.equal(v.thebe, 3000, 'P30 of a P200 basket');
  assert.equal(v.earned, true);
  assert.match(v.says, /15 percent/);
  assert.match(v.says, /2026-09-15/);
});

test('the merchant keeps the rest, and the two always sum to the goods', () => {
  for (const goods of [1, 999, 20000, 500000]) {
    const t = signed({ commission_bp: 1750 });
    assert.equal(merchantNets(goods, t) + commissionOn(goods, t).thebe, goods);
  }
});

test('commission is charged on the goods only, never on the delivery fee', () => {
  // the fee is not passed in at all, which is the guarantee
  const v = commissionOn(20000, signed({ commission_bp: 2000 }));
  assert.equal(v.thebe, 4000, 'P40 of the P200 goods, and nothing of the P25 fee');
});

test('a rate reads as a person would say it', () => {
  assert.equal(pct(1500), '15 percent');
  assert.equal(pct(1750), '17.50 percent');
  assert.equal(pct(0), '0 percent');
});

/* ------------- the negotiation ------------- */

test('a month of baskets is priced at every rate on the table, for the actual conversation', () => {
  const options = whatRatesWouldEarn(5000000, [1000, 1500, 2000]); // P50,000 of goods
  assert.equal(options.length, 3);
  assert.deepEqual(options.map((o) => o.label), ['10 percent', '15 percent', '20 percent']);
  assert.equal(options[0].sprint_earns_thebe, 500000); // P5,000
  assert.equal(options[1].sprint_earns_thebe, 750000); // P7,500
  assert.equal(options[2].sprint_earns_thebe, 1000000); // P10,000
  for (const o of options) {
    assert.equal(o.sprint_earns_thebe + o.merchant_keeps_thebe, 5000000);
  }
});

test('the options always come back lowest rate first, whatever order they are given in', () => {
  const options = whatRatesWouldEarn(100000, [2500, 500, 1500]);
  assert.deepEqual(options.map((o) => o.bp), [500, 1500, 2500]);
});

test('THE QUESTION NOBODY COULD ANSWER: is the rate or the volume the thing to argue about', () => {
  // A supermarket: P50,000 of goods a month, 200 drops at P25
  const big = whichEarnsMore(5000000, 500000, signed({ commission_bp: 1500 }));
  assert.equal(big.bigger, 'commission');
  assert.equal(big.commission, 750000);
  assert.match(big.says, /rate is the thing to negotiate/);

  // A small shop: P4,000 of goods a month, 60 drops at P25
  const small = whichEarnsMore(400000, 150000, signed({ commission_bp: 1500 }));
  assert.equal(small.bigger, 'fees');
  assert.match(small.says, /volume matters more than the rate/);
});

test('while a rate is unagreed, the comparison honestly shows nothing earned', () => {
  const v = whichEarnsMore(5000000, 500000, terms({ commission_bp: 1500 }));
  assert.equal(v.commission, 0);
  assert.equal(v.bigger, 'fees');
});
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

## api/src/orders/corporate.test.ts

```typescript
/**
 * Brick 35's proof. Run with:
 *   npm --prefix api run test:orders
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canOrder,
  statement,
  statementNumber,
  outstanding,
  health,
  pula,
  CorporateError,
  CorporateAccount,
  CorporateOrder,
} from './corporate';

const P = (n: number) => n * 100;

const ACCOUNT: CorporateAccount = {
  id: 'acc01',
  company: 'A Gaborone bank',
  billing_contact: 'Their accounts payable',
  billing_email: 'ap@example.co.bw',
  credit_limit: P(50000),
  payment_terms_days: 30,
  cost_centres: [
    { code: 'HO', name: 'Head office' },
    { code: 'BR12', name: 'Branch 12, Main Mall' },
    { code: 'CARDS', name: 'Card operations' },
  ],
  active: true,
};

const ORDERS: CorporateOrder[] = [
  { order_id: 'o1', account_id: 'acc01', cost_centre: 'HO', amount: P(136), placed_at: '2026-09-02T09:00:00.000Z', description: 'Documents to Francistown' },
  { order_id: 'o2', account_id: 'acc01', cost_centre: 'CARDS', amount: P(250), placed_at: '2026-09-05T11:00:00.000Z', description: 'Card stock to Maun' },
  { order_id: 'o3', account_id: 'acc01', cost_centre: 'HO', amount: P(87), placed_at: '2026-09-09T14:00:00.000Z', description: 'Envelope to Lobatse' },
  { order_id: 'o4', account_id: 'acc01', cost_centre: 'BR12', amount: P(163), placed_at: '2026-09-19T08:00:00.000Z', description: 'Branch pouch' },
  { order_id: 'x1', account_id: 'acc99', cost_centre: 'HO', amount: P(999), placed_at: '2026-09-03T09:00:00.000Z', description: 'Another company entirely' },
];

test('an order must say which cost centre it is for', () => {
  const r = canOrder(ACCOUNT, 0, P(100), 'NOPE');
  assert.equal(r.allowed, false);
  assert.match(r.says, /Choose which cost centre/);
  assert.match(r.says, /HO, BR12, CARDS/);
  assert.equal(canOrder(ACCOUNT, 0, P(100), 'HO').allowed, true);
});

test('the credit limit is checked when the order is placed, not at month end', () => {
  assert.equal(canOrder(ACCOUNT, P(49900), P(50), 'HO').allowed, true);
  const over = canOrder(ACCOUNT, P(49900), P(200), 'HO');
  assert.equal(over.allowed, false);
  assert.match(over.says, /past its limit/);
  assert.match(over.says, /P100.00 left/);
});

test('an account with no agreed limit gets no credit at all', () => {
  const noLimit = { ...ACCOUNT, credit_limit: 0 };
  const r = canOrder(noLimit, 0, P(50), 'HO');
  assert.equal(r.allowed, false);
  assert.match(r.says, /No credit limit has been agreed/);
});

test('an account on hold cannot order, and is told plainly', () => {
  const held = { ...ACCOUNT, active: false };
  const r = canOrder(held, 0, P(50), 'HO');
  assert.equal(r.allowed, false);
  assert.match(r.says, /on hold/);
  assert.equal(r.says.includes(' - '), false);
});

test('the month is split by cost centre, biggest first', () => {
  const s = statement(ACCOUNT, ORDERS, '2026-09-01T00:00:00.000Z', '2026-09-30T23:59:59.000Z');
  // CARDS is P250, HO is P136 plus P87 which is P223, BR12 is P163. Biggest first.
  assert.deepEqual(s.lines.map((l) => l.cost_centre), ['CARDS', 'HO', 'BR12']);
  const ho = s.lines.find((l) => l.cost_centre === 'HO')!;
  assert.equal(ho.orders, 2);
  assert.equal(ho.total, P(223));
  assert.equal(ho.cost_centre_name, 'Head office');
  assert.equal(s.total, P(136 + 250 + 87 + 163));
});

test('another company never appears on this invoice', () => {
  const s = statement(ACCOUNT, ORDERS, '2026-09-01T00:00:00.000Z', '2026-09-30T23:59:59.000Z');
  assert.equal(s.orders.some((o) => o.order_id === 'x1'), false);
  assert.equal(s.orders.length, 4);
});

test('only orders inside the period are billed', () => {
  const s = statement(ACCOUNT, ORDERS, '2026-09-01T00:00:00.000Z', '2026-09-10T23:59:59.000Z');
  assert.equal(s.orders.length, 3, 'o4 is on the 19th and belongs to the next run');
  assert.equal(s.total, P(136 + 250 + 87));
});

test('an order with no cost centre stops the invoice rather than hiding in it', () => {
  const withOrphan = [...ORDERS, {
    order_id: 'o5', account_id: 'acc01', cost_centre: 'GHOST',
    amount: P(100), placed_at: '2026-09-11T09:00:00.000Z', description: 'Nobody knows',
  }];
  assert.throws(
    () => statement(ACCOUNT, withOrphan, '2026-09-01T00:00:00.000Z', '2026-09-30T23:59:59.000Z'),
    /no cost centre on this account/,
  );
  try {
    statement(ACCOUNT, withOrphan, '2026-09-01T00:00:00.000Z', '2026-09-30T23:59:59.000Z');
  } catch (e: any) {
    assert.match(e.message, /o5/, 'it must name which order');
  }
});

test('nothing is ever added on top, because the prices already include it', () => {
  const s = statement(ACCOUNT, ORDERS, '2026-09-01T00:00:00.000Z', '2026-09-30T23:59:59.000Z');
  assert.equal(s.all_inclusive, true);
  assert.match(s.note, /already includes VAT and the fuel surcharge/);
  assert.equal(s.total, s.lines.reduce((a, l) => a + l.total, 0), 'the total is just the lines added up');
});

test('the invoice number can be read out on the phone and sorts by month', () => {
  assert.equal(statementNumber('acc01', '2026-09-01T00:00:00.000Z'), 'SPR-ACC01-202609');
  const months = ['2026-09-01', '2026-10-01', '2027-01-01'].map((m) => statementNumber('acc01', m));
  assert.deepEqual(months, [...months].sort());
});

test('payment terms set the due date', () => {
  const s = statement(ACCOUNT, ORDERS, '2026-09-01T00:00:00.000Z', '2026-09-30T00:00:00.000Z');
  assert.equal(s.due_date, '2026-10-30');
});

test('a period that ends before it starts is refused', () => {
  assert.throws(
    () => statement(ACCOUNT, ORDERS, '2026-09-30T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
    CorporateError,
  );
});

test('what is owed counts only this account and only what is unpaid', () => {
  assert.equal(outstanding(ORDERS, 'acc01'), P(136 + 250 + 87 + 163));
  assert.equal(outstanding(ORDERS, 'acc01', '2026-09-10T00:00:00.000Z'), P(163));
  assert.equal(outstanding(ORDERS, 'acc99'), P(999));
});

test('an account manager sees one line that says whether to worry', () => {
  assert.match(health(ACCOUNT, P(48000)), /96 percent of limit used, nearly blocked/);
  assert.match(health(ACCOUNT, P(38000)), /76 percent of limit used/);
  assert.match(health(ACCOUNT, P(500)), /P500.00 owed of P50000.00/);
  assert.match(health({ ...ACCOUNT, active: false }, 0), /on hold/);
  for (const line of [health(ACCOUNT, P(500)), health(ACCOUNT, P(48000))]) {
    assert.equal(line.includes(' - '), false, 'no dashes in anything a person reads');
  }
});

test('money is shown to the cent, never rounded in the customer favour or ours', () => {
  assert.equal(pula(P(136)), 'P136.00');
  assert.equal(pula(13650), 'P136.50');
});
```

---

## api/src/orders/parcel.ts

```typescript
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

## api/src/data-store/seed.ts

```typescript
import { hashSync, Algorithm } from '@node-rs/argon2';
import * as crypto from 'node:crypto';
import { encrypt, blindIndex } from '../common/aes';
import { WAYPOINTS } from '../common/waypoints';
import { StoreShape, UserRecord, MerchantRecord, CourierRecord } from './interfaces';

// Builds the fresh demo dataset described in the Sprint alpha contract:
// 3 demo login users, 4 merchants (food, grocery, vape, pharmacy) with
// realistic Pula pricing and delivery-app grade catalog imagery, and 5 named
// couriers wandering around Gaborone. Called once, the first time the API
// boots and data/store.json does not exist yet.
export function buildSeed(): StoreShape {
  const merchants: MerchantRecord[] = [
    {
      id: 'm1',
      name: "Mama T's Kitchen",
      type: 'food',
      age_restricted: false,
      lat: WAYPOINTS[1].lat + 0.002,
      lng: WAYPOINTS[1].lng - 0.001,
      heroImage: '/food/stew.jpg',
      rating: 4.7,
      ratingCount: 320,
      etaMinLow: 25,
      etaMinHigh: 40,
      deliveryFee: 12,
      promo: '20% off, up to P30',
      status: 'open',
      items: [
        {
          id: 'm1-i1',
          name: 'Seswaa and Pap',
          price_bwp: 55,
          photo: '/food/stew.jpg',
          description: 'Slow-cooked shredded beef with a mound of soft pap.',
        },
        {
          id: 'm1-i2',
          name: 'Chicken and Rice',
          price_bwp: 45,
          photo: '/food/curryrice.jpg',
          description: 'Spiced chicken pieces over fragrant rice.',
        },
        {
          id: 'm1-i3',
          name: 'Beef Stew Plate',
          price_bwp: 50,
          photo: '/food/beans.jpg',
          description: 'Hearty beef stew plate with a side of beans.',
        },
        {
          id: 'm1-i4',
          name: 'Vegetable Relish Plate',
          price_bwp: 35,
          photo: '/food/veg.jpg',
          description: 'Fresh seasonal vegetable relish, lightly spiced.',
        },
        {
          id: 'm1-i5',
          name: 'Grilled Chicken Quarter',
          price_bwp: 40,
          photo: '/food/friedrice.jpg',
          description: 'Chargrilled quarter chicken with a side of rice.',
        },
        {
          id: 'm1-i6',
          name: 'Bogobe with Sour Milk',
          price_bwp: 30,
          photo: '/food/bread2.jpg',
          description: 'Traditional sorghum porridge with cultured sour milk.',
        },
      ],
    },
    {
      id: 'm2',
      name: 'QuickMart Broadhurst',
      type: 'grocery',
      age_restricted: false,
      lat: WAYPOINTS[2].lat - 0.003,
      lng: WAYPOINTS[2].lng + 0.002,
      heroImage: '/food/grocery.jpg',
      rating: 3.9,
      ratingCount: 41,
      etaMinLow: 30,
      etaMinHigh: 50,
      deliveryFee: 15,
      promo: null,
      status: 'busy',
      items: [
        {
          id: 'm2-i1',
          name: 'White Bread 700g',
          price_bwp: 14,
          photo: '/food/bread.jpg',
          description: 'Fresh sliced white bread loaf, 700g.',
        },
        {
          id: 'm2-i2',
          name: 'Fresh Milk 1L',
          price_bwp: 18,
          photo: '/food/milk.jpg',
          description: 'Full cream fresh milk, 1 litre.',
        },
        {
          id: 'm2-i3',
          name: 'Eggs Tray of 30',
          price_bwp: 55,
          photo: '/food/grocery.jpg',
          description: 'Tray of 30 farm fresh eggs.',
        },
        {
          id: 'm2-i4',
          name: 'White Sugar 2kg',
          price_bwp: 32,
          photo: '/food/market.jpg',
          description: 'Refined white sugar, 2kg bag.',
        },
        {
          id: 'm2-i5',
          name: 'Cooking Oil 750ml',
          price_bwp: 28,
          photo: '/food/veg.jpg',
          description: 'Pure sunflower cooking oil, 750ml.',
        },
        {
          id: 'm2-i6',
          name: 'Maize Meal 10kg',
          price_bwp: 95,
          photo: '/food/beans.jpg',
          description: 'Coarse maize meal, 10kg bag, a kitchen staple.',
        },
      ],
    },
    {
      id: 'm3',
      name: 'CloudNine Vapes',
      type: 'vape',
      age_restricted: true,
      lat: WAYPOINTS[0].lat + 0.0015,
      lng: WAYPOINTS[0].lng + 0.0025,
      heroImage: '/food/market.jpg',
      rating: 4.2,
      ratingCount: 96,
      etaMinLow: 25,
      etaMinHigh: 45,
      deliveryFee: 18,
      promo: null,
      status: 'closed',
      items: [
        {
          id: 'm3-i1',
          name: 'Disposable Vape 2500 Puffs',
          price_bwp: 180,
          photo: '/food/market.jpg',
          description: 'Disposable vape device, approximately 2500 puffs.',
        },
        {
          id: 'm3-i2',
          name: 'Disposable Vape 5000 Puffs',
          price_bwp: 250,
          photo: '/food/grocery.jpg',
          description: 'Disposable vape device, approximately 5000 puffs.',
        },
        {
          id: 'm3-i3',
          name: 'Vape Juice 30ml',
          price_bwp: 120,
          photo: '/food/veg.jpg',
          description: 'E-liquid refill bottle, 30ml.',
        },
        {
          id: 'm3-i4',
          name: 'Replacement Coils 5 Pack',
          price_bwp: 90,
          photo: '/food/bread2.jpg',
          description: 'Pack of 5 replacement coils.',
        },
        {
          id: 'm3-i5',
          name: 'Starter Kit',
          price_bwp: 350,
          photo: '/food/beans.jpg',
          description: 'Complete starter kit with device and charger.',
        },
      ],
    },
    {
      id: 'm4',
      name: 'Kgale Pharmacy',
      type: 'pharmacy',
      age_restricted: false,
      lat: WAYPOINTS[3].lat + 0.001,
      lng: WAYPOINTS[3].lng - 0.0015,
      heroImage: '/food/pharmacy.jpg',
      rating: 4.8,
      ratingCount: 142,
      etaMinLow: 15,
      etaMinHigh: 30,
      deliveryFee: 10,
      promo: 'Free delivery on your first order',
      status: 'open',
      items: [
        {
          id: 'm4-i1',
          name: 'Paracetamol 500mg',
          price_bwp: 25,
          photo: '/food/pharmacy.jpg',
          description: 'Pack of 20 paracetamol tablets, 500mg.',
        },
        {
          id: 'm4-i2',
          name: 'Ibuprofen 200mg',
          price_bwp: 30,
          photo: '/food/pharmacy.jpg',
          description: 'Pack of 20 ibuprofen tablets, 200mg.',
        },
        {
          id: 'm4-i3',
          name: 'Multivitamin Tablets 30s',
          price_bwp: 65,
          photo: '/food/pharmacy.jpg',
          description: 'Daily multivitamin, 30 tablet pack.',
        },
        {
          id: 'm4-i4',
          name: 'Digital Thermometer',
          price_bwp: 85,
          photo: '/food/pharmacy.jpg',
          description: 'Fast-read digital body thermometer.',
        },
        {
          id: 'm4-i5',
          name: 'Hand Sanitizer 500ml',
          price_bwp: 35,
          photo: '/food/pharmacy.jpg',
          description: 'Alcohol-based hand sanitizer, 500ml pump bottle.',
        },
      ],
    },
  ];

  const courierNames = ['Kabelo', 'Tumi', 'Ofentse', 'Naledi', 'Thato'];
  // Fixed ratings and earnings: randomizing these on every reseed made the
  // demo data look synthetic (every courier 4.5+, different each restart).
  const courierRatings = [4.9, 4.6, 4.8, 4.3, 4.7];
  const courierEarnings = [86, 42, 110, 23, 67];
  const couriers: CourierRecord[] = courierNames.map((name, i) => {
    const wp = WAYPOINTS[i % WAYPOINTS.length];
    return {
      id: `c${i + 1}`,
      name,
      status: 'online',
      lat: wp.lat,
      lng: wp.lng,
      rating: courierRatings[i],
      earnings_today_bwp: courierEarnings[i],
      waypoint_target: (i + 1) % WAYPOINTS.length,
      move_target: null,
    };
  });

  function makeUser(name: string, role: 'customer' | 'courier' | 'ops', phone: string, courierId?: string): UserRecord {
    return {
      id: crypto.randomUUID(),
      name,
      role,
      phone_hash: blindIndex(phone),
      phone_enc: encrypt(phone),
      pin_hash: hashSync('1234', { algorithm: Algorithm.Argon2id }),
      courier_id: courierId,
    };
  }

  const users: UserRecord[] = [
    makeUser('Neo', 'customer', '71111111'),
    makeUser('Kabelo', 'courier', '72222222', 'c1'),
    makeUser('Amo', 'ops', '73333333'),
  ];

  return {
    users,
    merchants,
    couriers,
    orders: [],
    ledger_entries: [],
    events_outbox: [],
    idempotency: [],
    last_dispatch: null,
  };
}
```

---

## api/src/data-store/interfaces.ts

```typescript
import { MerchantType, OrderStatus, PaymentMethod, Role } from '../common/types';

export interface UserRecord {
  id: string;
  name: string;
  role: Role;
  phone_hash: string; // sha256 blind index, used to find the user at login
  phone_enc: string; // AES-256-GCM ciphertext, the demo talking point
  pin_hash: string; // argon2id hash
  courier_id?: string; // set when role is 'courier', links to CourierRecord
}

export interface MerchantItemRecord {
  id: string;
  name: string;
  price_bwp: number;
  photo: string; // /food/<name>.jpg, served from web/public/food
  description: string;
}

export interface MerchantRecord {
  id: string;
  name: string;
  type: MerchantType;
  age_restricted: boolean;
  items: MerchantItemRecord[];
  lat: number; // pickup point, internal only, not part of the /catalog contract
  lng: number;
  heroImage: string; // /food/<name>.jpg, served from web/public/food
  rating: number;
  ratingCount: number;
  etaMinLow: number;
  etaMinHigh: number;
  deliveryFee: number; // pula, flat per-merchant demo figure
  promo: string | null;
  status: 'open' | 'busy' | 'closed'; // live availability shown on cards and hero
}

export interface CourierRecord {
  id: string;
  name: string;
  status: 'online' | 'offered' | 'busy' | 'offline';
  lat: number;
  lng: number;
  rating: number;
  earnings_today_bwp: number;
  waypoint_target: number; // index into WAYPOINTS, used while wandering idle
  move_target?: { lat: number; lng: number } | null; // used while on an order
}

export interface OrderItemRecord {
  item_id: string;
  name: string;
  qty: number;
  price_bwp: number;
}

export interface TimelineEntry {
  status: OrderStatus;
  at: string;
}

export interface OrderRecord {
  id: string;
  customer_id: string;
  merchant_id: string;
  items: OrderItemRecord[];
  total_bwp: number;
  payment_method: PaymentMethod;
  address_enc: string; // AES-256-GCM ciphertext
  delivery_lat: number;
  delivery_lng: number;
  age_confirmed: boolean;
  status: OrderStatus;
  timeline: TimelineEntry[];
  courier_id: string | null;
  eta_min: number | null;
  idempotency_key: string;
  created_at: string;
  next_step_at: number; // epoch ms, when the simulator should advance this order
}

export interface DispatchScoreComponent {
  eta_min: number;
  active_load: number;
  rating_gap: number;
  fairness_boost: number;
}

export interface DispatchScore {
  courier_id: string;
  courier_name: string;
  score: number;
  components: DispatchScoreComponent;
}

export interface LastDispatch {
  order_id: string;
  scores: DispatchScore[];
}

export interface LedgerEntryRecord {
  id: string;
  order_id: string;
  account: string;
  type: 'debit' | 'credit';
  amount_bwp: number;
  created_at: string;
}

export interface OutboxEventRecord {
  id: string;
  event: string;
  order_id: string;
  payload: unknown;
  at: string;
}

export interface IdempotencyRecord {
  key: string; // `${user_id}:${idempotency_key}`
  order_id: string;
}

export interface StoreShape {
  users: UserRecord[];
  merchants: MerchantRecord[];
  couriers: CourierRecord[];
  orders: OrderRecord[];
  ledger_entries: LedgerEntryRecord[];
  events_outbox: OutboxEventRecord[];
  idempotency: IdempotencyRecord[];
  last_dispatch: LastDispatch | null;
}
```

---

## api/src/data-store/repositories/couriers.repo.ts

```typescript
import { Injectable } from '@nestjs/common';
import { StoreService } from '../store.service';
import { CourierRecord } from '../interfaces';
import { ICouriersRepo } from '../repo-interfaces';

@Injectable()
export class CouriersRepo implements ICouriersRepo {
  constructor(private readonly store: StoreService) {}

  listAll(): CourierRecord[] {
    return this.store.state.couriers;
  }

  findById(id: string): CourierRecord | undefined {
    return this.store.state.couriers.find((c) => c.id === id);
  }

  update(id: string, patch: Partial<CourierRecord>): void {
    const courier = this.findById(id);
    if (!courier) return;
    Object.assign(courier, patch);
    this.store.markDirty();
  }

  // Fleet wide median of earnings_today_bwp, used by the dispatch fairness
  // boost so a courier who has earned less today is nudged toward more work.
  medianEarningsToday(): number {
    const values = this.listAll()
      .map((c) => c.earnings_today_bwp)
      .sort((a, b) => a - b);
    if (values.length === 0) return 0;
    const mid = Math.floor(values.length / 2);
    return values.length % 2 === 0 ? (values[mid - 1] + values[mid]) / 2 : values[mid];
  }
}
```

---

## api/src/data-store/repositories/postgres.repo.stub.ts

```typescript
// This file is a stub on purpose. The alpha runs on a JSON file
// (data/store.json, see ../store.service.ts) so the whole demo starts with
// zero native dependencies and runs on any machine that has Node. Nothing
// here is wired up or imported by the app.
//
// When Sprint moves past alpha, each *.repo.ts in this folder gets a
// Postgres implementation of the same repo-interfaces.ts contract
// (IOrdersRepo, ICouriersRepo, ILedgerRepo, IOutboxRepo, ...), and the
// modules swap StoreService based repos for these without touching
// controllers or services.
//
// Production DDL note, per the Sprint blueprint:
//
// create table merchants (
//   id            uuid primary key default gen_random_uuid(),
//   name          text not null,
//   type          text not null check (type in ('food','grocery','vape')),
//   age_restricted boolean not null default false,
//   lat           double precision not null,
//   lng           double precision not null,
//   created_at    timestamptz not null default now()
// );
//
// create table merchant_items (
//   id            uuid primary key default gen_random_uuid(),
//   merchant_id   uuid not null references merchants(id),
//   name          text not null,
//   price_bwp     numeric(10,2) not null
// );
//
// create table orders (
//   id              uuid primary key default gen_random_uuid(),
//   customer_id     uuid not null references users(id),
//   merchant_id     uuid not null references merchants(id),
//   total_bwp       numeric(10,2) not null,
//   payment_method  text not null,
//   address_enc     text not null, -- AES-256-GCM ciphertext, iv:tag:ciphertext
//   delivery_lat    double precision not null,
//   delivery_lng    double precision not null,
//   age_confirmed   boolean not null default false,
//   status          text not null,
//   courier_id      uuid references couriers(id),
//   eta_min         integer,
//   idempotency_key text not null,
//   created_at      timestamptz not null default now(),
//   unique (customer_id, idempotency_key)
// );
//
// create table order_items (
//   id          uuid primary key default gen_random_uuid(),
//   order_id    uuid not null references orders(id),
//   item_id     text not null,
//   name        text not null,
//   qty         integer not null,
//   price_bwp   numeric(10,2) not null
// );
//
// create table couriers (
//   id                  uuid primary key default gen_random_uuid(),
//   name                text not null,
//   status              text not null default 'offline',
//   rating              numeric(2,1) not null default 5.0,
//   earnings_today_bwp  numeric(10,2) not null default 0,
//   created_at          timestamptz not null default now()
// );
//
// create table courier_locations (
//   courier_id  uuid not null references couriers(id),
//   lat         double precision not null,
//   lng         double precision not null,
//   h3_cell     text not null,
//   recorded_at timestamptz not null default now(),
//   primary key (courier_id, recorded_at)
// );
//
// create table payments (
//   id              uuid primary key default gen_random_uuid(),
//   order_id        uuid not null references orders(id),
//   method          text not null,
//   status          text not null,
//   created_at      timestamptz not null default now()
// );
//
// create table ledger_entries (
//   id          uuid primary key default gen_random_uuid(),
//   order_id    uuid not null references orders(id),
//   account     text not null,
//   type        text not null check (type in ('debit','credit')),
//   amount_bwp  numeric(10,2) not null,
//   created_at  timestamptz not null default now()
// );
//
// create table events_outbox (
//   id          uuid primary key default gen_random_uuid(),
//   event       text not null,
//   order_id    uuid not null references orders(id),
//   payload     jsonb not null,
//   created_at  timestamptz not null default now(),
//   published_at timestamptz
// );
//
// Note: pins are argon2id since 13 Sep 2026, and phone /
// address encryption keys move from a .env value to a managed secret store
// (KMS backed), rotated on a schedule.

export {};
```

---

## api/src/catalog/catalog.service.ts

```typescript
import { Injectable } from '@nestjs/common';
import { MerchantsRepo } from '../data-store/repositories/merchants.repo';
import { groupByVertical } from './verticals';

@Injectable()
export class CatalogService {
  constructor(private readonly merchantsRepo: MerchantsRepo) {}

  getCatalog() {
    const merchants = this.merchantsRepo.listAll().map((m) => ({
      id: m.id,
      name: m.name,
      type: m.type,
      age_restricted: m.age_restricted,
      heroImage: m.heroImage,
      rating: m.rating,
      ratingCount: m.ratingCount,
      etaMinLow: m.etaMinLow,
      etaMinHigh: m.etaMinHigh,
      deliveryFee: m.deliveryFee,
      promo: m.promo,
      status: m.status,
      items: m.items.map((i) => ({
        id: i.id,
        name: i.name,
        price_bwp: i.price_bwp,
        photo: i.photo,
        description: i.description,
      })),
    }));

    /* One app, many kinds of shop. `merchants` stays exactly as it was so nothing
       already reading this endpoint breaks; `sections` is the Sixty60 view the home
       page draws. `blocked` is deliberately returned rather than hidden: a vertical
       that law keeps off the page should be visible to whoever is running the
       business, just never to the customer. */
    const { sections, unplaced, blocked } = groupByVertical(merchants);
    return { merchants, sections, unplaced, blocked };
  }
}
```

---

## api/src/dispatch/dispatch.service.ts

```typescript
import { Injectable } from '@nestjs/common';
import * as h3 from 'h3-js';
import { CouriersRepo } from '../data-store/repositories/couriers.repo';
import { MerchantsRepo } from '../data-store/repositories/merchants.repo';
import { OrdersRepo } from '../data-store/repositories/orders.repo';
import { StoreService } from '../data-store/store.service';
import { TrackingGateway } from '../tracking/tracking.gateway';
import { DispatchScore, OrderRecord } from '../data-store/interfaces';

const H3_RES = 9;

// Real h3-js backed nearest-courier scoring. Lower score wins.
// score = 0.5*eta_min + 1.0*active_load + 0.2*(5 - rating) - 1.5*fairness_boost
@Injectable()
export class DispatchService {
  constructor(
    private readonly couriersRepo: CouriersRepo,
    private readonly merchantsRepo: MerchantsRepo,
    private readonly ordersRepo: OrdersRepo,
    private readonly store: StoreService,
    private readonly tracking: TrackingGateway,
  ) {}

  // Finds and scores couriers for an order, assigns the winner, emits
  // dispatch_scored, and returns the score list (order 0 is the winner).
  assign(order: OrderRecord): DispatchScore[] {
    const merchant = this.merchantsRepo.findById(order.merchant_id);
    const allCouriers = this.couriersRepo.listAll();

    const pickupCell = merchant
      ? h3.latLngToCell(merchant.lat, merchant.lng, H3_RES)
      : null;
    const ringCells = pickupCell ? new Set(h3.gridDisk(pickupCell, 3)) : null;

    const available = allCouriers.filter((c) => c.status !== 'offered' && c.status !== 'busy');
    let candidates = available;
    if (pickupCell && ringCells) {
      const inRing = available.filter((c) =>
        ringCells.has(h3.latLngToCell(c.lat, c.lng, H3_RES)),
      );
      if (inRing.length > 0) candidates = inRing;
    }
    // Safety net for the demo: never leave an order unassignable just
    // because every courier happens to be outside the 3 ring search.
    if (candidates.length === 0) candidates = allCouriers;

    const median = this.couriersRepo.medianEarningsToday();

    const scores: DispatchScore[] = candidates.map((c) => {
      const courierCell = h3.latLngToCell(c.lat, c.lng, H3_RES);
      let hexDistance = 4; // fallback ring distance if h3 cannot compute one
      if (pickupCell) {
        try {
          const d = h3.gridDistance(pickupCell, courierCell);
          if (d >= 0) hexDistance = d;
        } catch {
          // pentagon distortion or non-contiguous grid, keep the fallback
        }
      }
      const eta_min = Math.round((2 + hexDistance * 1.5) * 10) / 10;
      const active_load = this.ordersRepo.listActiveForCourier(c.id).length;
      const rating_gap = Math.round((5 - c.rating) * 10) / 10;
      const fairness_boost = c.earnings_today_bwp < median ? 1 : 0;
      const score =
        0.5 * eta_min + 1.0 * active_load + 0.2 * rating_gap - 1.5 * fairness_boost;

      return {
        courier_id: c.id,
        courier_name: c.name,
        score: Math.round(score * 1000) / 1000,
        components: { eta_min, active_load, rating_gap, fairness_boost },
      };
    });

    scores.sort((a, b) => a.score - b.score);

    const winner = scores[0];
    if (winner) {
      this.ordersRepo.update(order.id, {
        courier_id: winner.courier_id,
        eta_min: Math.round(winner.components.eta_min),
      });
      this.couriersRepo.update(winner.courier_id, { status: 'offered' });
    }

    this.store.state.last_dispatch = { order_id: order.id, scores };
    this.store.persist();
    this.tracking.emitDispatchScored(order.id, scores);
    return scores;
  }
}
```

---

## api/src/ops/ops.service.ts

```typescript
import { Injectable } from '@nestjs/common';
import * as h3 from 'h3-js';
import { CouriersRepo } from '../data-store/repositories/couriers.repo';
import { OrdersRepo } from '../data-store/repositories/orders.repo';
import { MerchantsRepo } from '../data-store/repositories/merchants.repo';
import { StoreService } from '../data-store/store.service';
import { toPublicOrder } from '../orders/orders.service';

const H3_RES = 9;

@Injectable()
export class OpsService {
  constructor(
    private readonly couriersRepo: CouriersRepo,
    private readonly ordersRepo: OrdersRepo,
    private readonly merchantsRepo: MerchantsRepo,
    private readonly store: StoreService,
  ) {}

  getState() {
    const couriers = this.couriersRepo.listAll().map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      lat: c.lat,
      lng: c.lng,
      h3: h3.latLngToCell(c.lat, c.lng, H3_RES),
      rating: c.rating,
      earnings_today_bwp: c.earnings_today_bwp,
    }));

    const orders = this.ordersRepo.listAll().map((o) => {
      const courier = o.courier_id ? this.couriersRepo.findById(o.courier_id) : undefined;
      const merchant = this.merchantsRepo.findById(o.merchant_id);
      return toPublicOrder(
        o,
        courier ? { name: courier.name, rating: courier.rating, lat: courier.lat, lng: courier.lng } : null,
        merchant?.name,
      );
    });

    return {
      couriers,
      orders,
      last_dispatch: this.store.state.last_dispatch,
    };
  }
}
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
