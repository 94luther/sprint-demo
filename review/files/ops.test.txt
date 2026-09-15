/**
 * Brick 34's proof. Run with:
 *   npm --prefix api run test:orders
 *
 * The board must lead with what needs a person. The last test is the one that keeps it that way.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  exceptionQueue, byState, perRider, perMerchant, failuresByFault, theOneThing,
  LiveOrder,
} from './ops';
import { SettleableOrder } from './settlement';

const NOW = '2026-09-13T12:00:00.000Z';
const ago = (mins: number) => new Date(Date.parse(NOW) - mins * 60000).toISOString();
const P = (n: number) => n * 100;

const live: LiveOrder[] = [
  { order_id: 'o1', state: 'picked_up', since: ago(70), courier_id: 'c1', courier_name: 'Amo', merchant_id: 'm1', merchant_name: 'A grocer', place: 'Mogoditshane' },
  { order_id: 'o2', state: 'dispatch_offered', since: ago(9), courier_id: null, courier_name: null, merchant_id: 'm2', merchant_name: 'A pharmacy', place: 'Phakalane' },
  { order_id: 'o3', state: 'picked_up', since: ago(10), courier_id: 'c2', courier_name: 'Kabelo', merchant_id: 'm1', merchant_name: 'A grocer', place: 'Tlokweng' },
  { order_id: 'o4', state: 'at_door', since: ago(2), courier_id: 'c1', courier_name: 'Amo', merchant_id: 'm2', merchant_name: 'A pharmacy', place: 'Main Mall' },
];

const done: SettleableOrder[] = [
  { order_id: 'd1', merchant_id: 'm1', merchant_name: 'A grocer', goods: P(200), delivery_fee: P(60), rail: 'cash', fault: 'none', delivered: true, perishable: false },
  { order_id: 'd2', merchant_id: 'm1', merchant_name: 'A grocer', goods: P(150), delivery_fee: P(60), rail: 'cash', fault: 'merchant', delivered: false, perishable: false },
  { order_id: 'd3', merchant_id: 'm1', merchant_name: 'A grocer', goods: P(150), delivery_fee: P(60), rail: 'cash', fault: 'merchant', delivered: false, perishable: false },
  { order_id: 'd4', merchant_id: 'm2', merchant_name: 'A pharmacy', goods: P(400), delivery_fee: P(60), rail: 'myzaka', fault: 'none', delivered: true, perishable: false },
  { order_id: 'd5', merchant_id: 'm2', merchant_name: 'A pharmacy', goods: P(90), delivery_fee: P(60), rail: 'cash', fault: 'rider', delivered: false, perishable: false },
];

const riderOf = new Map([
  ['d1', { id: 'c1', name: 'Amo' }],
  ['d2', { id: 'c1', name: 'Amo' }],
  ['d3', { id: 'c2', name: 'Kabelo' }],
  ['d4', { id: 'c2', name: 'Kabelo' }],
  ['d5', { id: 'c1', name: 'Amo' }],
]);

test('the stuck queue is worst first, and names who has it', () => {
  const q = exceptionQueue(live, NOW);
  assert.equal(q.length, 2, 'o1 at 70 minutes and o2 at 9 minutes are both over');
  assert.equal(q[0].order.order_id, 'o1', 'the worst comes first');
  assert.equal(q[0].minutes, 70);
  assert.equal(q[0].over_by, 25, 'picked up allows 45 minutes');
  assert.match(q[0].says, /with Amo/);
  assert.match(q[1].says, /with nobody/);
});

test('an order inside its time is not in the queue', () => {
  const ids = exceptionQueue(live, NOW).map((e) => e.order.order_id);
  assert.equal(ids.includes('o3'), false, 'picked up 10 minutes ago is fine');
  assert.equal(ids.includes('o4'), false, 'at the door 2 minutes ago is fine');
});

test('the board says what to do, not just what is true', () => {
  const one = theOneThing(live, NOW);
  assert.match(one, /^Ring Amo about o1/);
  assert.match(one, /70 minutes/);
  assert.match(one, /Mogoditshane/, 'it must say where, so the caller has context');
});

test('with nothing stuck it says so plainly and counts who is waiting', () => {
  const calm: LiveOrder[] = [{ ...live[3], since: ago(1) }];
  const line = theOneThing(calm, NOW);
  assert.match(line, /Nothing is stuck/);
  assert.match(line, /1 customer is waiting/);
  assert.match(theOneThing([], NOW), /nobody is waiting/);
});

test('the shape of the day groups by where orders are', () => {
  const s = byState(live);
  assert.equal(s[0].state, 'picked_up');
  assert.equal(s[0].count, 2);
  assert.equal(s.reduce((a, x) => a + x.count, 0), live.length);
  assert.equal(s.every((x) => typeof x.waiting === 'boolean'), true);
});

test('output per rider is by name, and failures are split by whose fault', () => {
  const rs = perRider(live, done, riderOf);
  const amo = rs.find((r) => r.courier_id === 'c1')!;
  assert.equal(amo.delivered, 1, 'd1');
  assert.equal(amo.failed_own_fault, 1, 'd5 was the rider');
  assert.equal(amo.failed_other, 1, 'd2 was the shop');
  assert.equal(amo.live, 2, 'o1 and o4');
  assert.match(amo.says, /1 their own/);
  assert.match(amo.says, /1 not their fault/);
});

test('a rider who only took hard jobs is not made to look bad for other people failures', () => {
  const rs = perRider(live, done, riderOf);
  const kabelo = rs.find((r) => r.courier_id === 'c2')!;
  assert.equal(kabelo.failed_own_fault, 0);
  assert.equal(kabelo.failed_other, 1, 'the shop had no stock, not Kabelo');
  assert.equal(kabelo.says.includes('their own'), false);
});

test('the merchant quietly costing money is at the top', () => {
  const ms = perMerchant(done);
  assert.equal(ms[0].merchant_id, 'm1', 'two failed trips because the shop had no stock');
  assert.equal(ms[0].cost_of_their_failures, P(120));
  assert.match(ms[0].says, /67 percent failed/);
  assert.match(ms[0].says, /costing Sprint 120.00 pula in wasted trips/);
});

test('a merchant who simply had a rider problem is not blamed for it', () => {
  const ms = perMerchant(done);
  const pharmacy = ms.find((m) => m.merchant_id === 'm2')!;
  assert.equal(pharmacy.failures, 1);
  assert.equal(pharmacy.cost_of_their_failures, 0, 'the rider caused it, not the pharmacy');
});

test('the leak is shown by whose fault, dearest first', () => {
  const f = failuresByFault(done);
  assert.equal(f[0].fault, 'rider', 'Sprint carried that one');
  assert.equal(f[0].cost, P(60));
  const merchantRow = f.find((x) => x.fault === 'merchant')!;
  assert.equal(merchantRow.count, 2);
  assert.equal(merchantRow.cost, 0, 'Sprint absorbed nothing, the shop simply was not paid');
});

test('every line a person reads is plain and has no dashes', () => {
  const lines = [
    theOneThing(live, NOW),
    exceptionQueue(live, NOW)[0].says,
    perRider(live, done, riderOf)[0].says,
    perMerchant(done)[0].says,
  ];
  for (const l of lines) {
    assert.ok(l.length > 15);
    assert.equal(l.includes(' - '), false, `dash in: ${l}`);
  }
});
