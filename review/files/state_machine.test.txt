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
