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
