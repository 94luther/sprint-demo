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
