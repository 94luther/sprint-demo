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
