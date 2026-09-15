# Sprint delivery engine, part 3 of 6

A customer facing delivery platform for Gaborone, Botswana. One app, many kinds of
shop, the way Checkers Sixty60 works: a shop has a KIND and each kind carries its
own rules. A pharmacy needs a pharmacist, a bottle store needs a licence and
trading hours, a pet shop needs neither.

TypeScript on NestJS. 271 tests passing, tsc clean.
Public copy: https://github.com/94luther/sprint-alpha-review

**This is part 3 of 6.** The engine is split so that nothing gets silently
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

1. `api/src/orders/corporate.test.ts`
2. `api/src/orders/corporate.ts`
3. `api/src/orders/dto.ts`
4. `api/src/orders/handover.test.ts`
5. `api/src/orders/handover.ts`
6. `api/src/orders/liquor.test.ts`
7. `api/src/orders/liquor.ts`
8. `api/src/orders/money_models.test.ts`
9. `api/src/orders/network.test.ts`


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

## api/src/orders/dto.ts

```typescript
import { PaymentMethod } from '../common/types';

export interface CreateOrderItemDto {
  item_id: string;
  qty: number;
}

export interface CreateOrderDto {
  merchant_id: string;
  items: CreateOrderItemDto[];
  payment_method: PaymentMethod;
  address: string;
  age_confirmed?: boolean;
}
```

---

## api/src/orders/handover.test.ts

```typescript
/**
 * Brick 21's proof. Run with:
 *   npm --prefix api run test:orders
 *
 * The tests that matter most are the ones about what is NOT stored. A proof of delivery that
 * quietly collects identity numbers is a breach waiting to be discovered.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  requirementFor,
  makeCode,
  checkCode,
  record,
  evidence,
  whatExpires,
  HandoverError,
  CODE_LENGTH,
  CODE_MAX_ATTEMPTS,
  PHOTO_RETENTION_DAYS,
} from './handover';

const ok = {
  order_id: 'o1',
  courier_id: 'courier_amo',
  photo_ref: 'pod/o1.jpg',
  photo_of: 'parcel' as const,
  at: '2026-09-13T10:00:00.000Z',
};
const goodId = { document: 'omang' as const, name_matched: true, old_enough: true };

test('an ordinary parcel needs a photograph and nothing more', () => {
  assert.deepEqual(requirementFor('ordinary').needs, ['photo']);
  const h = record({ ...ok, sensitivity: 'ordinary' });
  assert.equal(h.photo_of, 'parcel');
  assert.equal(h.identity, null);
});

test('liquor needs a document checked, a prescription needs the code as well', () => {
  assert.deepEqual(requirementFor('liquor').needs, ['photo', 'identity']);
  assert.deepEqual(requirementFor('prescription').needs, ['photo', 'code', 'identity']);
});

test('no delivery is recorded without a photograph', () => {
  assert.throws(() => record({ ...ok, photo_ref: null, sensitivity: 'ordinary' }), /needs a photograph/);
});

test('the photograph must be of the parcel, never of the customer', () => {
  assert.throws(
    () => record({ ...ok, photo_of: 'person', sensitivity: 'ordinary' }),
    /must be of the parcel, never of the customer/,
  );
  assert.throws(() => record({ ...ok, photo_of: null, sensitivity: 'ordinary' }), /Say what the photograph shows/);
});

test('liquor cannot be handed over with no document checked', () => {
  assert.throws(() => record({ ...ok, sensitivity: 'liquor' }), /No check was recorded/);
  const h = record({ ...ok, sensitivity: 'liquor', identity: goodId });
  assert.equal(h.identity?.checked_by, 'courier_amo');
});

test('a name that does not match, or somebody too young, stops the handover', () => {
  assert.throws(
    () => record({ ...ok, sensitivity: 'liquor', identity: { ...goodId, name_matched: false } }),
    /does not match the order/,
  );
  assert.throws(
    () => record({ ...ok, sensitivity: 'liquor', identity: { ...goodId, old_enough: false } }),
    /not old enough/,
  );
});

test('a prescription needs the code as well as the document', () => {
  assert.throws(
    () => record({ ...ok, sensitivity: 'prescription', identity: goodId }),
    /needs the code from the customer app/,
  );
  const h = record({ ...ok, sensitivity: 'prescription', identity: goodId, code_verified: true });
  assert.equal(h.code_verified, true);
  assert.match(h.says, /document and code both checked/);
});

test('an ordinary parcel must not carry an identity check it never needed', () => {
  assert.throws(
    () => record({ ...ok, sensitivity: 'ordinary', identity: goodId }),
    /must not have an identity check recorded/,
  );
});

test('an identity NUMBER is never stored, only that the check passed', () => {
  const h = record({ ...ok, sensitivity: 'liquor', identity: goodId, received_by_name: 'Neo Kgosi' });
  // Everything except the timestamp, which is legitimately full of digits and is not user input.
  const { at, ...rest } = h;
  const asText = JSON.stringify(rest);
  assert.equal(/\d{7,}/.test(asText.replace(/[\s-]/g, '')), false, 'something long and numeric got stored');
  assert.deepEqual(Object.keys(h.identity!).sort(), ['checked_by', 'document', 'name_matched', 'old_enough']);
  assert.equal('number' in h.identity!, false);
  assert.equal('date_of_birth' in h.identity!, false);
});

test('a rider typing an identity number into the name is refused', () => {
  assert.throws(
    () => record({ ...ok, sensitivity: 'liquor', identity: goodId, received_by_name: '123456789' }),
    /Record the name only, never the number/,
  );
  assert.throws(
    () => record({ ...ok, sensitivity: 'liquor', identity: goodId, received_by_name: 'Neo 12345 6789' }),
    /never the number/,
  );
  assert.doesNotThrow(() => record({ ...ok, sensitivity: 'liquor', identity: goodId, received_by_name: 'Neo Kgosi' }));
});

test('the code is short enough to read out at a gate', () => {
  const code = makeCode(() => 0.42);
  assert.equal(code.length, CODE_LENGTH);
  assert.match(code, /^\d+$/);
});

test('three wrong codes and it locks rather than letting anyone keep guessing', () => {
  let attempts = 0;
  for (let i = 0; i < CODE_MAX_ATTEMPTS - 1; i++) {
    const r = checkCode('1234', '0000', attempts);
    assert.equal(r.ok, false);
    assert.equal(r.locked, false);
    attempts = r.attempts;
  }
  const last = checkCode('1234', '0000', attempts);
  assert.equal(last.locked, true);
  assert.match(last.says, /call the office/);
  const after = checkCode('1234', '1234', last.attempts);
  assert.equal(after.ok, false, 'a locked code must not open on the right answer either');
});

test('the right code matches, and spacing around it does not matter', () => {
  assert.equal(checkCode('1234', '1234', 0).ok, true);
  assert.equal(checkCode('1234', ' 1234 ', 0).ok, true);
  assert.equal(checkCode('', '', 0).ok, false, 'an empty expected code must never match');
});

test('what a dispute is shown says the number was never recorded', () => {
  const h = record({ ...ok, sensitivity: 'prescription', identity: goodId, code_verified: true, received_by_name: 'Neo Kgosi' });
  const e = evidence(h);
  assert.match(e.identity, /never recorded/);
  assert.match(e.proof, /photograph of the parcel/);
  assert.equal(e.code, 'the customer read out the code from their app');
  assert.equal(/\d{7,}/.test(JSON.stringify(e)), false);
});

test('the photograph dies at ninety days and the record at two years', () => {
  const h = record({ ...ok, sensitivity: 'liquor', identity: goodId });
  assert.deepEqual(whatExpires(h, '2026-10-01T10:00:00.000Z'), [], 'nothing goes in the first month');
  assert.deepEqual(whatExpires(h, '2027-01-01T10:00:00.000Z'), ['photo'], `the photo should go after ${PHOTO_RETENTION_DAYS} days`);
  const old = whatExpires(h, '2029-01-01T10:00:00.000Z');
  assert.ok(old.includes('identity') && old.includes('whole_record'));
});

test('every message a person reads is plain and has no dashes', () => {
  const messages = [
    requirementFor('ordinary').says,
    requirementFor('liquor').says,
    requirementFor('prescription').says,
    checkCode('1234', '9999', 0).says,
    record({ ...ok, sensitivity: 'ordinary' }).says,
  ];
  for (const m of messages) {
    assert.ok(m.length > 10, 'a message should say something');
    assert.equal(m.includes(' - '), false, `dash in: ${m}`);
  }
});
```

---

## api/src/orders/handover.ts

```typescript
/**
 * Brick 21. Proof at the door.
 *
 * Every handover leaves a record. For most orders that is a photograph of the parcel where it
 * was left. For liquor and for a prescription it is more, because the law and the pharmacist
 * both need to know the goods reached an adult, and the right one.
 *
 * The fault model at docs/FAULT_MODEL.md leans on this. When a customer disputes a delivery,
 * the answer is whatever was recorded here at the time, by the person standing there. When an
 * identity check fails, the order goes back and the customer carries the delivery fee, and that
 * is only defensible if the check was recorded properly.
 *
 * Three rules come from the data protection assessment and are enforced by the shape of the
 * code rather than by anybody remembering them:
 *
 *   1. AN IDENTITY NUMBER IS NEVER STORED. The rider looks at the document and records that the
 *      name matched and the person is old enough. The number itself is never typed, so it can
 *      never leak, never be subpoenaed and never sit in a backup.
 *   2. THE PHOTOGRAPH IS OF THE PARCEL, NOT THE PERSON. The rider must say which, and a handover
 *      photographed with a person in it is refused.
 *   3. EVERYTHING HAS A DEATH DATE. Photographs at 90 days, identity checks at two years.
 */

export type Sensitivity = 'ordinary' | 'liquor' | 'prescription';

export type ProofKind =
  /** A photograph of the parcel at the door. The floor for every delivery. */
  | 'photo'
  /** The customer reads out the code from their app. Proves it reached the right person. */
  | 'code'
  /** The rider sees a document, checks the name and the age, and records neither number. */
  | 'identity';

export interface HandoverRequirement {
  needs: ProofKind[];
  says: string;
}

export interface IdentityCheck {
  /** What kind of document was shown. Never which one, never its number. */
  document: 'omang' | 'passport' | 'drivers_licence';
  /** Did the name on it match the name on the order. */
  name_matched: boolean;
  /** Is the person old enough. The rider answers yes or no, never types a birth date. */
  old_enough: boolean;
}

export interface Handover {
  order_id: string;
  courier_id: string;
  at: string;
  sensitivity: Sensitivity;
  photo_ref: string | null;
  /** What the photograph is of. A person is refused. */
  photo_of: 'parcel' | null;
  code_verified: boolean;
  identity: (IdentityCheck & { checked_by: string }) | null;
  received_by_name: string | null;
  says: string;
}

export class HandoverError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HandoverError';
  }
}

export const PHOTO_RETENTION_DAYS = 90;
export const IDENTITY_RETENTION_DAYS = 730;
export const CODE_LENGTH = 4;
export const CODE_MAX_ATTEMPTS = 3;

// Named for what it DETECTS, not what it stores. Nothing here ever holds an identity number.
const LOOKS_LIKE_AN_ID = /\d{7,}/;

/** What this order needs before it can be handed over. */
export function requirementFor(sensitivity: Sensitivity): HandoverRequirement {
  switch (sensitivity) {
    case 'prescription':
      return {
        needs: ['photo', 'code', 'identity'],
        says: 'A prescription goes only to the patient, so the rider checks a document and the code',
      };
    case 'liquor':
      return {
        needs: ['photo', 'identity'],
        says: 'Liquor goes only to an adult, so the rider checks a document',
      };
    default:
      return { needs: ['photo'], says: 'A photograph of the parcel where it was left' };
  }
}

/** The code the customer reads out. Digits only, because it is read aloud at a gate. */
export function makeCode(random: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += Math.floor(random() * 10).toString();
  return out;
}

export function checkCode(
  expected: string,
  given: string,
  attemptsSoFar: number,
): { ok: boolean; attempts: number; locked: boolean; says: string } {
  const attempts = attemptsSoFar + 1;
  if (attemptsSoFar >= CODE_MAX_ATTEMPTS) {
    return { ok: false, attempts: attemptsSoFar, locked: true, says: 'Too many tries, call the office' };
  }
  const ok = expected.length > 0 && expected === given.trim();
  const locked = !ok && attempts >= CODE_MAX_ATTEMPTS;
  return {
    ok,
    attempts,
    locked,
    says: ok
      ? 'Code matched'
      : locked
        ? 'Too many tries, call the office'
        : `That code does not match, ${CODE_MAX_ATTEMPTS - attempts} tries left`,
  };
}

/**
 * Record the handover. Refuses rather than recording something half done, because a proof with
 * a hole in it is worse than none: it looks like evidence and is not.
 */
export function record(input: {
  order_id: string;
  courier_id: string;
  sensitivity: Sensitivity;
  photo_ref?: string | null;
  photo_of?: 'parcel' | 'person' | null;
  code_verified?: boolean;
  identity?: IdentityCheck | null;
  received_by_name?: string | null;
  at?: string;
}): Handover {
  const req = requirementFor(input.sensitivity);
  if (!input.courier_id) throw new HandoverError('A handover must name the rider who made it.');

  if (req.needs.includes('photo')) {
    if (!input.photo_ref) {
      throw new HandoverError('Every delivery needs a photograph of the parcel at the door.');
    }
    if (input.photo_of === 'person') {
      throw new HandoverError(
        'The photograph must be of the parcel, never of the customer. Take it again showing the parcel where it was left.',
      );
    }
    if (input.photo_of !== 'parcel') {
      throw new HandoverError('Say what the photograph shows. It must be the parcel.');
    }
  }

  if (req.needs.includes('code') && !input.code_verified) {
    throw new HandoverError('This one needs the code from the customer app before it can be handed over.');
  }

  if (req.needs.includes('identity')) {
    const id = input.identity;
    if (!id) throw new HandoverError(`${req.says}. No check was recorded.`);
    if (!id.name_matched) {
      throw new HandoverError('The name on the document does not match the order. This cannot be handed over.');
    }
    if (!id.old_enough) {
      throw new HandoverError('The person is not old enough for this order. This cannot be handed over.');
    }
  } else if (input.identity) {
    throw new HandoverError('An ordinary parcel must not have an identity check recorded against it.');
  }

  const name = (input.received_by_name ?? '').trim() || null;
  if (name && LOOKS_LIKE_AN_ID.test(name.replace(/[\s-]/g, ''))) {
    throw new HandoverError('That looks like an identity number. Record the name only, never the number.');
  }

  return {
    order_id: input.order_id,
    courier_id: input.courier_id,
    at: input.at ?? new Date().toISOString(),
    sensitivity: input.sensitivity,
    photo_ref: input.photo_ref ?? null,
    photo_of: req.needs.includes('photo') ? 'parcel' : null,
    code_verified: Boolean(input.code_verified),
    identity: input.identity ? { ...input.identity, checked_by: input.courier_id } : null,
    received_by_name: name,
    says: describe(input.sensitivity, name),
  };
}

function describe(sensitivity: Sensitivity, name: string | null): string {
  const who = name ? `to ${name}` : 'at the door';
  if (sensitivity === 'prescription') return `Prescription handed ${who}, document and code both checked`;
  if (sensitivity === 'liquor') return `Liquor handed ${who}, document checked`;
  return `Delivered ${who}, photographed`;
}

/** What a dispute or a regulator is shown. Never more than this. */
export function evidence(h: Handover): Record<string, string> {
  const out: Record<string, string> = {
    order: h.order_id,
    when: h.at,
    rider: h.courier_id,
    proof: h.photo_ref ? 'photograph of the parcel at the door' : 'none',
    summary: h.says,
  };
  if (h.identity) {
    out.identity = `${h.identity.document} seen by ${h.identity.checked_by}, name matched, old enough. The number was never recorded.`;
  }
  if (h.code_verified) out.code = 'the customer read out the code from their app';
  return out;
}

/** Retention, from the data protection assessment. Returns what must go, not what may stay. */
export function whatExpires(h: Handover, nowISO?: string): Array<'photo' | 'identity' | 'whole_record'> {
  const now = nowISO ? Date.parse(nowISO) : Date.now();
  const age = (now - Date.parse(h.at)) / 86_400_000;
  const gone: Array<'photo' | 'identity' | 'whole_record'> = [];
  if (h.photo_ref && age > PHOTO_RETENTION_DAYS) gone.push('photo');
  if (h.identity && age > IDENTITY_RETENTION_DAYS) gone.push('identity');
  if (age > IDENTITY_RETENTION_DAYS) gone.push('whole_record');
  return gone;
}
```

---

## api/src/orders/liquor.test.ts

```typescript
/**
 * Brick 26's proof. Run with:
 *   npm --prefix api run test:orders
 *
 * The first test is the one that matters legally. No licence on file means no liquor moves, and
 * that is the default rather than something somebody has to remember to switch on.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mayHandOver,
  latestArrivalToday,
  daysLeft,
  expiringSoon,
  checkLicenceRecord,
  parseTime,
  hhmm,
  LiquorError,
  EXPIRY_WARNING_DAYS,
  LiquorLicence,
} from './liquor';

const T = (s: string) => parseTime(s);

const LICENCE: LiquorLicence = {
  number: 'LL/GAB/0447',
  holder: 'A licensed bottle store',
  premises: 'Plot 5310, Gaborone West',
  hours: {
    mon: { from: T('10:00'), to: T('20:00') },
    tue: { from: T('10:00'), to: T('20:00') },
    wed: { from: T('10:00'), to: T('20:00') },
    thu: { from: T('10:00'), to: T('20:00') },
    fri: { from: T('10:00'), to: T('22:00') },
    sat: { from: T('10:00'), to: T('22:00') },
    // Sunday is deliberately absent. A day with no entry is a day it may not trade.
  },
  expires: '2027-03-31',
  source: 'Copy of the licence supplied by the merchant, filed 13 September 2026',
};

// 2026-09-14 is a Monday, 2026-09-20 is a Sunday.
const MON = (t: string) => `2026-09-14T${t}:00.000Z`;
const SUN = (t: string) => `2026-09-20T${t}:00.000Z`;
const FRI = (t: string) => `2026-09-18T${t}:00.000Z`;

test('with no licence on file, nothing moves, and that is the default', () => {
  const v = mayHandOver(null, MON('12:00'));
  assert.equal(v.allowed, false);
  assert.equal(v.reason, 'no_licence');
  assert.match(v.says, /No liquor licence is on file/);
});

test('inside the hours on the licence it is allowed, and the door check is still named', () => {
  const v = mayHandOver(LICENCE, MON('12:00'));
  assert.equal(v.allowed, true);
  assert.equal(v.reason, 'ok');
  assert.match(v.says, /LL\/GAB\/0447/);
  assert.match(v.says, /still checks a document at the door/);
});

test('the time that matters is when it ARRIVES, not when it was ordered', () => {
  // Ordered at five to eight, arriving half past. The licence ends at eight.
  const late = mayHandOver(LICENCE, MON('20:30'));
  assert.equal(late.allowed, false);
  assert.equal(late.reason, 'outside_hours');
  assert.match(late.says, /would arrive at 20:30/);
  assert.match(late.says, /between 10:00 and 20:00/);
  assert.equal(mayHandOver(LICENCE, MON('19:59')).allowed, true);
  assert.equal(mayHandOver(LICENCE, MON('20:00')).allowed, true, 'the closing minute itself is inside');
  assert.equal(mayHandOver(LICENCE, MON('20:01')).allowed, false);
});

test('too early is refused as firmly as too late', () => {
  assert.equal(mayHandOver(LICENCE, MON('09:59')).allowed, false);
  assert.equal(mayHandOver(LICENCE, MON('10:00')).allowed, true);
});

test('a day the licence does not cover is closed, not merely out of hours', () => {
  const v = mayHandOver(LICENCE, SUN('12:00'));
  assert.equal(v.allowed, false);
  assert.equal(v.reason, 'closed_today');
  assert.match(v.says, /does not permit trading on a Sunday/);
});

test('different days can have different hours, and Friday runs later here', () => {
  assert.equal(mayHandOver(LICENCE, FRI('21:30')).allowed, true);
  assert.equal(mayHandOver(LICENCE, MON('21:30')).allowed, false);
});

test('an expired licence switches the merchant off with no argument', () => {
  const old = { ...LICENCE, expires: '2026-09-01' };
  const v = mayHandOver(old, MON('12:00'));
  assert.equal(v.allowed, false);
  assert.equal(v.reason, 'expired');
  assert.match(v.says, /expired on 2026-09-01/);
  assert.equal(mayHandOver({ ...LICENCE, expires: '2026-09-14' }, MON('12:00')).allowed, true,
    'the expiry day itself is still valid');
});

test('a customer is told the last time they can be promised today, before they pay', () => {
  assert.equal(latestArrivalToday(LICENCE, MON('11:00')), '2026-09-14T20:00:00.000Z');
  assert.equal(latestArrivalToday(LICENCE, FRI('11:00')), '2026-09-18T22:00:00.000Z');
  assert.equal(latestArrivalToday(LICENCE, SUN('11:00')), null, 'nothing can be promised on a closed day');
});

test('the director question: what runs out inside sixty days', () => {
  const soon = { ...LICENCE, number: 'LL/GAB/0001', holder: 'A shop nearly out of time', expires: '2026-10-20' };
  const gone = { ...LICENCE, number: 'LL/GAB/0002', holder: 'A shop already out of time', expires: '2026-08-30' };
  const fine = LICENCE;
  const list = expiringSoon([fine, soon, gone], MON('09:00'));
  assert.equal(list.length, 2, 'only the two inside the window');
  assert.equal(list[0].licence.number, 'LL/GAB/0002', 'the expired one is first');
  assert.match(list[0].says, /EXPIRED 15 days ago/);
  assert.match(list[1].says, /runs out in 36 days/);
  assert.ok(daysLeft(fine, MON('09:00')) > EXPIRY_WARNING_DAYS);
});

test('a half filled licence record is listed as incomplete rather than trusted', () => {
  assert.deepEqual(checkLicenceRecord(LICENCE), []);
  const missing = checkLicenceRecord({ number: 'LL/1', holder: 'Someone' });
  assert.ok(missing.includes('the premises it covers'));
  assert.ok(missing.includes('the expiry date'));
  assert.ok(missing.includes('the permitted hours, copied off the licence'));
  assert.ok(missing.includes('where the copy on file came from'));
  assert.deepEqual(checkLicenceRecord({}).length > 4, true);
});

test('a time that is not a time is refused rather than guessed at', () => {
  assert.throws(() => parseTime('half eight'), LiquorError);
  assert.throws(() => parseTime('25:00'), /not a real time/);
  assert.throws(() => parseTime('10:70'), /not a real time/);
  assert.equal(parseTime('09:30'), 570);
  assert.equal(hhmm(570), '09:30');
  assert.equal(hhmm(1320), '22:00');
});

test('every line a person reads is plain and has no dashes', () => {
  const lines = [
    mayHandOver(null, MON('12:00')).says,
    mayHandOver(LICENCE, MON('12:00')).says,
    mayHandOver(LICENCE, SUN('12:00')).says,
    mayHandOver(LICENCE, MON('20:30')).says,
    mayHandOver({ ...LICENCE, expires: '2026-09-01' }, MON('12:00')).says,
  ];
  for (const l of lines) {
    assert.ok(l.length > 15);
    assert.equal(l.includes(' - '), false, `dash in: ${l}`);
  }
});
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

## api/src/orders/network.test.ts

```typescript
/**
 * Brick 17's proof. Run with:
 *   npm --prefix api run test:orders
 *
 * The numbers below are not invented. They come from the company profile, read on 12 September
 * 2026. If one of these fails, either the profile changed or somebody edited the network file, and
 * both are worth stopping for.
 *
 * The last four tests exist because the FIRST read of this profile was wrong and every test here
 * passed anyway. The branch pages print in two columns, the read took them as flowing text, and
 * Kanye's address, phone and email ended up under Commerce Park while Kanye vanished. Nothing asked
 * whether each address belonged to the branch above it. Now something does.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allSites,
  offices,
  servicePoints,
  internationalSites,
  routeTo,
  placesCovered,
  contactFor,
  reachLine,
  coverageClaim,
  provenance,
  incompleteSites,
  branchClaim,
  checkEmailsMatchBranches,
  unresolvedSites,
  NetworkError,
} from './network';

test('the network is the real one, read out of the company profile', () => {
  const p = provenance();
  assert.match(p.document, /Profile/);
  assert.match(p.method, /never from memory/i, 'case insensitive: this exact trap already cost a brick once');
  assert.equal(allSites().length, 57, 'fifty seven sites in Botswana with a printed address');
  assert.equal(offices().length, 30);
  assert.equal(servicePoints().length, 27);
  assert.equal(internationalSites().length, 3);
});

test('the reach line quotes the profile instead of a rounded number nobody can source', () => {
  const line = reachLine();
  assert.match(line, /30 offices and 27 service points/);
  assert.match(coverageClaim(), /more than 50 towns/);
  assert.match(coverageClaim(), /over 75 sites/);
  assert.match(branchClaim(), /over 50 branches/, "the profile's own branch words, page 2");
  assert.equal(/55 branches/.test(line), false, 'the unsourced figure must not come back');
});

test('a real town routes to a real office with a real address', () => {
  const maun = routeTo('Maun');
  assert.equal(maun.covered, true);
  assert.equal(maun.has_office, true);
  assert.ok(maun.site);
  assert.match(maun.says, /Maun/);
  const fran = routeTo('Francistown');
  assert.equal(fran.has_office, true);
  assert.ok(fran.site!.phones.length > 0, 'a customer must be able to ring it');
});

test('a service point is named as a service point, not dressed up as an office', () => {
  const t = routeTo('Tlokweng');
  assert.equal(t.covered, true);
  assert.equal(t.has_office, false);
  assert.match(t.says, /service point/);
});

test('somewhere Sprint does not go is refused, never promised', () => {
  const v = routeTo('Timbuktu');
  assert.equal(v.covered, false);
  assert.equal(v.site, null);
  assert.match(v.says, /does not list Timbuktu/);
  assert.match(v.says, /Ask the office before quoting it/);
});

test('a place on a route with no branch is carried there, and says so honestly', () => {
  const onRoute = placesCovered().find((p) => {
    const r = routeTo(p);
    return r.covered && !r.site;
  });
  if (onRoute) {
    const r = routeTo(onRoute);
    assert.match(r.says, /carried there rather than collected there/);
  }
});

test('an empty destination is refused rather than matched to something', () => {
  assert.throws(() => routeTo('   '), NetworkError);
  assert.throws(() => routeTo(''), /needs somewhere to go/);
});

test('case and spacing do not decide whether we deliver somewhere', () => {
  for (const v of ['maun', 'MAUN', '  Maun  ']) {
    assert.equal(routeTo(v).covered, true, `${v} should route`);
  }
});

test('the place picker can only offer places on the network', () => {
  const places = placesCovered();
  assert.ok(places.length > 50);
  assert.equal(places.includes('Timbuktu'), false);
  assert.deepEqual(places, [...places].sort((a, b) => a.localeCompare(b)), 'sorted for a picker');
  assert.equal(new Set(places).size, places.length, 'no duplicates');
});

test('a customer can be told exactly who has their parcel', () => {
  const c = contactFor('Kasane');
  assert.ok(c);
  assert.ok(c!.phones.length > 0);
  assert.match(c!.says, /Call Kasane on/);
  assert.equal(contactFor('Timbuktu'), null);
});

test('every site can actually be reached by somebody', () => {
  for (const s of allSites()) {
    assert.ok(s.phones.length > 0 || s.email, `${s.name} has no phone and no email`);
    assert.ok(s.address.length > 5, `${s.name} has no usable address`);
  }
});

test('thin site records are listed rather than quietly trusted', () => {
  const thin = incompleteSites();
  // Service points legitimately have no email. What matters is that the list is honest.
  for (const t of thin) {
    assert.ok(t.missing.length > 0);
    assert.equal(t.missing.includes('an address'), false, `${t.name} has no address, which is not usable`);
  }
});

test('every line a person reads is plain and has no dashes', () => {
  const lines = [reachLine(), routeTo('Maun').says, routeTo('Timbuktu').says, routeTo('Tlokweng').says];
  for (const l of lines) {
    assert.ok(l.length > 15);
    assert.equal(l.includes(' - '), false, `dash in: ${l}`);
  }
});

test('no branch carries another branch email, which is how the column shift showed itself', () => {
  assert.deepEqual(checkEmailsMatchBranches(), [],
    'an email whose name is not the branch name means the name column slid against the address column');
});

test('Kanye is back, and Commerce Park has its own address again', () => {
  const kanye = routeTo('Kanye');
  assert.equal(kanye.covered, true, 'a whole Sprint office was missing from the app');
  assert.match(kanye.site!.address, /Motlhala Ward/);
  assert.equal(kanye.site!.email, 'office@example.com');

  const cp = routeTo('Commerce Park');
  assert.match(cp.site!.address, /Commerce Park/, 'it had been given Kanye address, 85 km away');
  assert.equal(cp.site!.email, 'office@example.com');
  assert.notEqual(cp.site!.address, kanye.site!.address);
});

test('the three branches dropped by the first read are all on the network', () => {
  for (const place of ['BDF SSKB Camp', 'Letlhakeng', 'Shoshong']) {
    assert.equal(routeTo(place).covered, true, `${place} is a real Sprint site and was missing`);
  }
});

test('no place name is two towns glued together off the map drawing', () => {
  const realTwoWord = new Set(['Charles Hill', 'Selibe Phikwe', 'Pitsane Molopo',
    'Commerce Park', 'BDF SSKB Camp', 'Main Mall', 'Rail Park', 'Bus Rank',
    'Francistown Warehouse', 'Francistown Express', 'Francistown Donga Express',
    'Maun Express', 'Maun Warehouse', 'Selibe Phikwe']);
  for (const p of placesCovered()) {
    if (p.includes(' ') && !realTwoWord.has(p)) {
      assert.fail(`"${p}" reads like two map labels glued together, the way Bobonong Gabojango was`);
    }
  }
});

test('a branch with no address is never offered as a place to collect from', () => {
  const open = unresolvedSites();
  assert.ok(open.length > 0, 'the profile does leave one Ramotswa heading without an address');
  for (const u of open) {
    assert.match(u.why, /Owner: Barbara/, 'an open question needs a name against it');
    assert.equal(allSites().some((s) => s.name === u.name && !s.address), false);
  }
  const r = routeTo('Ramotswa');
  assert.ok(r.site!.address, 'the Ramotswa that does have an address is the one used');
});
```
