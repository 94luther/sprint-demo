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
