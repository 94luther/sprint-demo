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
