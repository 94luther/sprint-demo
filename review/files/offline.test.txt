/**
 * Brick 33's offline proof. Run with:
 *   npm --prefix api run test:orders
 *
 * The first test is the one that matters. A rider's phone may lose signal, run out of battery or
 * be replaced, and not one fact about money or evidence may disappear because of it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  queue,
  sync,
  sendOrder,
  remaining,
  whoWins,
  riderStatus,
  mustKeep,
  isPrecious,
  OfflineError,
  GIVE_UP_AFTER,
  QueuedAction,
} from './offline';

const act = (id: string, kind: any, order_id: string, at: string): Omit<QueuedAction, 'attempts' | 'last_error'> =>
  ({ id, kind, order_id, happened_at: at, payload: {} });

const ok = () => 'sent' as const;
const dead = () => { throw new Error('no route to host'); };

test('nothing is ever dropped, whatever the server says', () => {
  const box = [
    act('a1', 'handover', 'o1', '2026-09-13T10:00:00Z'),
    act('a2', 'cash_collected', 'o1', '2026-09-13T10:01:00Z'),
  ].reduce(queue, [] as QueuedAction[]);

  const refused = sync(box, () => 'needs_a_person');
  assert.equal(refused.sent.length, 0);
  assert.equal(refused.needs_a_person.length + refused.still_waiting.length, 2, 'both must still exist somewhere');
  assert.equal(remaining(refused).length, 2, 'and both are still on the phone');

  const broken = sync(box, dead);
  assert.equal(remaining(broken).length, 2);
});

test('no signal means everything waits, and the rider is told nothing is lost', () => {
  const box = [act('a1', 'handover', 'o1', '2026-09-13T10:00:00Z')].reduce(queue, [] as QueuedAction[]);
  const r = sync(box, ok, false);
  assert.equal(r.still_waiting.length, 1);
  assert.equal(r.sent.length, 0);
  assert.match(r.says, /nothing lost/);
  assert.match(riderStatus(box, false), /go when you have signal/);
});

test('an action sent twice is recognised, not repeated', () => {
  let box: QueuedAction[] = [];
  box = queue(box, act('a1', 'cash_collected', 'o1', '2026-09-13T10:00:00Z'));
  box = queue(box, act('a1', 'cash_collected', 'o1', '2026-09-13T10:00:00Z'));
  assert.equal(box.length, 1, 'queueing the same id twice must not double it');

  const r = sync(box, () => 'already_known');
  assert.equal(r.already_known.length, 1);
  assert.equal(r.sent.length, 0);
  assert.equal(remaining(r).length, 0, 'the office already had it, so the phone can let it go');
});

test('every action must carry an id and the time it actually happened', () => {
  assert.throws(() => queue([], { id: '', kind: 'handover', order_id: 'o1', happened_at: 'x', payload: {} } as any), OfflineError);
  assert.throws(() => queue([], { id: 'a1', kind: 'handover', order_id: 'o1', happened_at: '', payload: {} } as any), /when it happened/);
});

test('for one order things go in the right order, whatever order they were queued in', () => {
  const box = [
    act('a3', 'cash_collected', 'o1', '2026-09-13T10:02:00Z'),
    act('a1', 'handover', 'o1', '2026-09-13T10:01:00Z'),
    act('a2', 'address_confirmed', 'o1', '2026-09-13T10:00:00Z'),
  ].reduce(queue, [] as QueuedAction[]);
  assert.deepEqual(sendOrder(box).map((a) => a.kind), ['address_confirmed', 'handover', 'cash_collected']);
});

test('this morning delivery is not stuck behind this afternoon one', () => {
  const box = [
    act('b1', 'handover', 'o2', '2026-09-13T15:00:00Z'),
    act('a1', 'handover', 'o1', '2026-09-13T08:00:00Z'),
  ].reduce(queue, [] as QueuedAction[]);
  assert.deepEqual(sendOrder(box).map((a) => a.order_id), ['o1', 'o2']);
});

test('when one thing for an order will not go, nothing later for it jumps ahead', () => {
  const box = [
    act('a1', 'handover', 'o1', '2026-09-13T10:00:00Z'),
    act('a2', 'cash_collected', 'o1', '2026-09-13T10:01:00Z'),
    act('b1', 'handover', 'o2', '2026-09-13T11:00:00Z'),
  ].reduce(queue, [] as QueuedAction[]);
  const r = sync(box, (a) => { if (a.id === 'a1') throw new Error('server said no'); return 'sent'; });
  assert.equal(r.sent.length, 1, 'the other order still goes');
  assert.equal(r.sent[0].order_id, 'o2');
  assert.equal(r.still_waiting.some((a) => a.id === 'a2'), true, 'the cash must not arrive before the handover');
});

test('after enough failed tries it stops retrying and asks a person, still holding the action', () => {
  let box = [act('a1', 'handover', 'o1', '2026-09-13T10:00:00Z')].reduce(queue, [] as QueuedAction[]);
  for (let i = 0; i < GIVE_UP_AFTER; i++) {
    const r = sync(box, dead);
    box = remaining(r);
  }
  assert.equal(box.length, 1, 'it is still there');
  assert.equal(box[0].attempts >= GIVE_UP_AFTER, true);
  const last = sync(box, dead);
  assert.equal(last.needs_a_person.length + last.still_waiting.length, 1);
  assert.match(riderStatus(box, true), /Call the office, nothing is lost/);
});

test('a failure says what actually went wrong, not that something went wrong', () => {
  const box = [act('a1', 'handover', 'o1', '2026-09-13T10:00:00Z')].reduce(queue, [] as QueuedAction[]);
  const r = sync(box, () => { throw new Error('the battery died mid send'); });
  assert.match(r.still_waiting[0].last_error!, /battery died/);
});

test('money and evidence are marked so a full phone can never bin them', () => {
  assert.equal(isPrecious('handover'), true);
  assert.equal(isPrecious('cash_collected'), true);
  assert.equal(isPrecious('cold_box_reading'), true);
  assert.equal(isPrecious('address_confirmed'), false);
  const box = [
    act('a1', 'handover', 'o1', '2026-09-13T10:00:00Z'),
    act('a2', 'address_confirmed', 'o1', '2026-09-13T10:00:00Z'),
  ].reduce(queue, [] as QueuedAction[]);
  assert.deepEqual(mustKeep(box).map((a) => a.id), ['a1']);
});

test('the person who was actually there wins, except about dispatch', () => {
  assert.equal(whoWins('handover'), 'the rider');
  assert.equal(whoWins('cash_collected'), 'the rider');
  assert.equal(whoWins('address_confirmed'), 'the rider');
  assert.equal(whoWins('state_move'), 'the office');
});

test('the rider screen never says something vague', () => {
  assert.equal(riderStatus([], true), 'Everything is up to date');
  const box = [
    act('a1', 'handover', 'o1', '2026-09-13T10:00:00Z'),
    act('a2', 'address_confirmed', 'o1', '2026-09-13T10:00:00Z'),
  ].reduce(queue, [] as QueuedAction[]);
  const line = riderStatus(box, false);
  assert.match(line, /2 waiting to send/);
  assert.match(line, /including 1 about money or proof/);
  for (const l of [line, riderStatus([], true), riderStatus(box, true)]) {
    assert.equal(l.includes(' - '), false, `dash in: ${l}`);
  }
});

test('a whole day of work syncs in one go when the signal comes back', () => {
  let box: QueuedAction[] = [];
  for (let i = 1; i <= 12; i++) {
    box = queue(box, act(`h${i}`, 'handover', `o${i}`, `2026-09-13T${String(8 + i).padStart(2, '0')}:00:00Z`));
    box = queue(box, act(`c${i}`, 'cash_collected', `o${i}`, `2026-09-13T${String(8 + i).padStart(2, '0')}:05:00Z`));
  }
  assert.equal(box.length, 24);
  const r = sync(box, ok);
  assert.equal(r.sent.length, 24);
  assert.equal(remaining(r).length, 0);
  assert.match(r.says, /24 sent/);
});
