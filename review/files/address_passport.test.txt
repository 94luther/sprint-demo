/**
 * Brick 16's proof. Run with:
 *   npm --prefix api run test:orders
 *
 * The tests that matter most are the last three. They prove the rider is never handed anything
 * beyond what finds the door, and that an identity number cannot be written into an address.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  create,
  confirmAtDoor,
  correctAtDoor,
  markNotFound,
  repair,
  chooseFor,
  needsAttention,
  isUsable,
  forRider,
  summary,
  isExpired,
  rejectIdentityNumbers,
  PassportError,
  DOUBT_AFTER_FAILURES,
  AddressPassport,
} from './address_passport';

const base = (over: Partial<Parameters<typeof create>[0]> = {}) =>
  create({
    id: 'p1',
    customer_id: 'c1',
    label: 'Home',
    plot: 'Plot 2147, Block 8',
    landmark: 'Blue gate opposite ABC Hardware',
    access: 'Ask for the gate to be opened',
    at: '2026-09-01T08:00:00.000Z',
    ...over,
  });

test('a new address is not trusted until somebody has been there', () => {
  const p = base();
  assert.equal(p.confidence, 'typed');
  assert.equal(p.confirmed_by, null);
  assert.equal(forRider(p).trusted, false);
  assert.match(forRider(p).says, /confirm it at the door/);
});

test('an address needs at least a plot or a landmark', () => {
  assert.throws(() => base({ plot: '   ', landmark: '' }), PassportError);
  assert.doesNotThrow(() => base({ plot: '', landmark: 'The green roof past the school' }));
});

test('the rider at the door is the only one who can make an address trusted', () => {
  const p = confirmAtDoor(base(), 'courier_7', '2026-09-02T10:00:00.000Z');
  assert.equal(p.confidence, 'rider_confirmed');
  assert.equal(p.confirmed_by, 'courier_7');
  assert.equal(p.times_used, 1);
  assert.equal(forRider(p).trusted, true);
  assert.throws(() => confirmAtDoor(base(), ''), /name the rider/);
});

test('a rider correcting the address counts as confirming it', () => {
  const p = correctAtDoor(base(), 'courier_7', { landmark: 'Red gate, the hardware shop moved' });
  assert.equal(p.landmark, 'Red gate, the hardware shop moved');
  assert.equal(p.confidence, 'rider_confirmed');
  assert.equal(p.confirmed_by, 'courier_7');
});

test('a correction may not empty the address', () => {
  assert.throws(() => correctAtDoor(base(), 'courier_7', { plot: '', landmark: '' }), /no plot and no landmark/);
});

test('one failure is bad luck, two means the address stops being used', () => {
  let p = confirmAtDoor(base(), 'courier_7');
  p = markNotFound(p);
  assert.equal(p.failed_finds, 1);
  assert.equal(isUsable(p), true, 'one miss should not condemn an address');
  p = markNotFound(p);
  assert.equal(p.failed_finds, DOUBT_AFTER_FAILURES);
  assert.equal(p.confidence, 'doubted');
  assert.equal(isUsable(p), false);
  assert.equal(p.confirmed_by, null, 'an old confirmation does not survive being unfindable');
  assert.equal(needsAttention(p), true);
});

test('a doubted address only comes back when something actually changed', () => {
  let p = markNotFound(markNotFound(base()));
  assert.throws(() => repair(p, { plot: 'Plot 2147, Block 8' }), /Nothing was changed/);
  p = repair(p, { plot: 'Plot 2174, Block 8' });
  assert.equal(p.confidence, 'typed');
  assert.equal(p.failed_finds, 0);
  assert.equal(isUsable(p), true);
});

test('a confirmed address beats a typed one when the app picks for a customer', () => {
  const typed = base({ id: 'a' });
  const confirmed = confirmAtDoor(base({ id: 'b', label: 'Office' }), 'courier_7', '2026-09-03T09:00:00.000Z');
  const chosen = chooseFor('c1', [typed, confirmed]);
  assert.equal(chosen?.id, 'b');
});

test('a doubted address is never offered silently', () => {
  const doubted = markNotFound(markNotFound(confirmAtDoor(base({ id: 'a' }), 'c7')));
  const typed = base({ id: 'b' });
  assert.equal(chooseFor('c1', [doubted, typed])?.id, 'b');
  assert.equal(chooseFor('c1', [doubted])?.id, undefined);
});

test('one customer never sees another customer address', () => {
  const mine = base({ id: 'a', customer_id: 'c1' });
  const theirs = confirmAtDoor(base({ id: 'b', customer_id: 'c2' }), 'c7');
  assert.equal(chooseFor('c1', [mine, theirs])?.id, 'a');
  assert.equal(chooseFor('c3', [mine, theirs]), null);
});

test('the most recently used confirmed address wins', () => {
  const older = confirmAtDoor(base({ id: 'a' }), 'c7', '2026-09-01T09:00:00.000Z');
  const newer = confirmAtDoor(base({ id: 'b' }), 'c8', '2026-09-05T09:00:00.000Z');
  assert.equal(chooseFor('c1', [older, newer])?.id, 'b');
});

test('an address nobody has used in two years is dropped', () => {
  const p = base({ at: '2024-01-01T00:00:00.000Z' });
  assert.equal(isExpired(p, '2026-09-12T00:00:00.000Z'), true);
  const fresh = confirmAtDoor(base(), 'c7', '2026-08-01T00:00:00.000Z');
  assert.equal(isExpired(fresh, '2026-09-12T00:00:00.000Z'), false);
});

test('the rider is handed only what finds the door', () => {
  const p = confirmAtDoor(base(), 'courier_7');
  const seen = forRider(p);
  assert.deepEqual(Object.keys(seen).sort(), ['access', 'landmark', 'plot', 'says', 'trusted']);
  const asText = JSON.stringify(seen);
  for (const leaked of ['customer_id', 'c1', 'confirmed_by', 'times_used', 'failed_finds', 'label']) {
    assert.equal(asText.includes(leaked), false, `the rider view leaks ${leaked}`);
  }
});

test('an identity number cannot be written into an address', () => {
  assert.throws(() => base({ access: 'Ask for Omang 123456789' }), /identity number/);
  assert.throws(() => base({ access: 'ID 12345 6789 at the gate' }), /identity number/);
  assert.throws(() => base({ landmark: 'Gate code 987654321' }), /identity number/);
  assert.throws(
    () => correctAtDoor(base(), 'c7', { access: 'his omang is 456123789' }),
    /identity number/,
  );
  assert.doesNotThrow(() => base({ access: 'Gate code 4417, ring twice' }));
  assert.doesNotThrow(() => base({ plot: 'Plot 123456789' }), 'a plot number is not an access note');
});

test('rejectIdentityNumbers names the field so the message is useful', () => {
  assert.throws(() => rejectIdentityNumbers('112233445', 'The access note'), /The access note/);
});

test('the summary reads like a person wrote it', () => {
  const p: AddressPassport = confirmAtDoor(base(), 'courier_7');
  assert.equal(summary(p), 'Home: Plot 2147, Block 8, Blue gate opposite ABC Hardware (confirmed)');
  assert.equal(summary(base()).includes('not yet confirmed'), true);
  for (const s of [summary(p), forRider(p).says]) {
    assert.equal(s.includes(' - '), false, 'no dashes in text a person reads');
  }
});
