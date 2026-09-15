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
  assert.throws(() => refund(book, 'k1', 100, 'r100'), /cannot be refunded by software/);
});

test('money that was never taken cannot be sent back', () => {
  const book = new MemoryBook();
  take(book, req({ rail: 'account', amount_thebe: 5000 }));
  assert.throws(() => refund(book, 'k1', 100, 'r100'), /Only money actually taken/);
});

test('a refund can never exceed what was taken, even in two goes', () => {
  const book = new MemoryBook();
  take(book, req({ rail: 'account', amount_thebe: 5000 }));
  move(book, 'k1', 'captured');
  refund(book, 'k1', 3000, 'r3000');
  assert.throws(() => refund(book, 'k1', 2500, 'r2500'), /more than was taken/);
  refund(book, 'k1', 2000, 'r2000');
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

/* ---------------- a retried refund is the same refund ---------------- */

test('A RETRIED REFUND IS ONE REFUND: P20 tapped twice on a bad line stays P20', () => {
  const book = new MemoryBook();
  take(book, req({ rail: 'account', amount_thebe: 5000 }));
  move(book, 'k1', 'captured');
  refund(book, 'k1', 2000, 'rf-1');
  refund(book, 'k1', 2000, 'rf-1');
  refund(book, 'k1', 2000, 'rf-1');
  assert.equal(book.get('k1')?.refunded_thebe, 2000, 'three taps became more than one refund');
});

test('the same refund key with a different amount is refused, never applied', () => {
  const book = new MemoryBook();
  take(book, req({ rail: 'account', amount_thebe: 5000 }));
  move(book, 'k1', 'captured');
  refund(book, 'k1', 2000, 'rf-1');
  assert.throws(() => refund(book, 'k1', 1000, 'rf-1'), /different amount/);
  assert.equal(book.get('k1')?.refunded_thebe, 2000);
});

test('a refund with no key of its own is refused outright', () => {
  const book = new MemoryBook();
  take(book, req({ rail: 'account', amount_thebe: 5000 }));
  move(book, 'k1', 'captured');
  assert.throws(() => refund(book, 'k1', 1000, ''), /needs its own key/);
});
