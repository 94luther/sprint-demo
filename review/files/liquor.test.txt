/**
 * Brick 26's proof. Run with:
 *   npm --prefix api run test:orders
 *
 * The first test is the one that matters legally. No licence on file means no liquor moves, and
 * that is the default rather than something somebody has to remember to switch on.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mayHandOver,
  latestArrivalToday,
  daysLeft,
  expiringSoon,
  checkLicenceRecord,
  parseTime,
  hhmm,
  LiquorError,
  EXPIRY_WARNING_DAYS,
  LiquorLicence,
} from './liquor';

const T = (s: string) => parseTime(s);

const LICENCE: LiquorLicence = {
  number: 'LL/GAB/0447',
  holder: 'A licensed bottle store',
  premises: 'Plot 5310, Gaborone West',
  hours: {
    mon: { from: T('10:00'), to: T('20:00') },
    tue: { from: T('10:00'), to: T('20:00') },
    wed: { from: T('10:00'), to: T('20:00') },
    thu: { from: T('10:00'), to: T('20:00') },
    fri: { from: T('10:00'), to: T('22:00') },
    sat: { from: T('10:00'), to: T('22:00') },
    // Sunday is deliberately absent. A day with no entry is a day it may not trade.
  },
  expires: '2027-03-31',
  source: 'Copy of the licence supplied by the merchant, filed 13 September 2026',
};

// 2026-09-14 is a Monday, 2026-09-20 is a Sunday.
const MON = (t: string) => `2026-09-14T${t}:00.000Z`;
const SUN = (t: string) => `2026-09-20T${t}:00.000Z`;
const FRI = (t: string) => `2026-09-18T${t}:00.000Z`;

test('with no licence on file, nothing moves, and that is the default', () => {
  const v = mayHandOver(null, MON('12:00'));
  assert.equal(v.allowed, false);
  assert.equal(v.reason, 'no_licence');
  assert.match(v.says, /No liquor licence is on file/);
});

test('inside the hours on the licence it is allowed, and the door check is still named', () => {
  const v = mayHandOver(LICENCE, MON('12:00'));
  assert.equal(v.allowed, true);
  assert.equal(v.reason, 'ok');
  assert.match(v.says, /LL\/GAB\/0447/);
  assert.match(v.says, /still checks a document at the door/);
});

test('the time that matters is when it ARRIVES, not when it was ordered', () => {
  // Ordered at five to eight, arriving half past. The licence ends at eight.
  const late = mayHandOver(LICENCE, MON('20:30'));
  assert.equal(late.allowed, false);
  assert.equal(late.reason, 'outside_hours');
  assert.match(late.says, /would arrive at 20:30/);
  assert.match(late.says, /between 10:00 and 20:00/);
  assert.equal(mayHandOver(LICENCE, MON('19:59')).allowed, true);
  assert.equal(mayHandOver(LICENCE, MON('20:00')).allowed, true, 'the closing minute itself is inside');
  assert.equal(mayHandOver(LICENCE, MON('20:01')).allowed, false);
});

test('too early is refused as firmly as too late', () => {
  assert.equal(mayHandOver(LICENCE, MON('09:59')).allowed, false);
  assert.equal(mayHandOver(LICENCE, MON('10:00')).allowed, true);
});

test('a day the licence does not cover is closed, not merely out of hours', () => {
  const v = mayHandOver(LICENCE, SUN('12:00'));
  assert.equal(v.allowed, false);
  assert.equal(v.reason, 'closed_today');
  assert.match(v.says, /does not permit trading on a Sunday/);
});

test('different days can have different hours, and Friday runs later here', () => {
  assert.equal(mayHandOver(LICENCE, FRI('21:30')).allowed, true);
  assert.equal(mayHandOver(LICENCE, MON('21:30')).allowed, false);
});

test('an expired licence switches the merchant off with no argument', () => {
  const old = { ...LICENCE, expires: '2026-09-01' };
  const v = mayHandOver(old, MON('12:00'));
  assert.equal(v.allowed, false);
  assert.equal(v.reason, 'expired');
  assert.match(v.says, /expired on 2026-09-01/);
  assert.equal(mayHandOver({ ...LICENCE, expires: '2026-09-14' }, MON('12:00')).allowed, true,
    'the expiry day itself is still valid');
});

test('a customer is told the last time they can be promised today, before they pay', () => {
  assert.equal(latestArrivalToday(LICENCE, MON('11:00')), '2026-09-14T20:00:00.000Z');
  assert.equal(latestArrivalToday(LICENCE, FRI('11:00')), '2026-09-18T22:00:00.000Z');
  assert.equal(latestArrivalToday(LICENCE, SUN('11:00')), null, 'nothing can be promised on a closed day');
});

test('the director question: what runs out inside sixty days', () => {
  const soon = { ...LICENCE, number: 'LL/GAB/0001', holder: 'A shop nearly out of time', expires: '2026-10-20' };
  const gone = { ...LICENCE, number: 'LL/GAB/0002', holder: 'A shop already out of time', expires: '2026-08-30' };
  const fine = LICENCE;
  const list = expiringSoon([fine, soon, gone], MON('09:00'));
  assert.equal(list.length, 2, 'only the two inside the window');
  assert.equal(list[0].licence.number, 'LL/GAB/0002', 'the expired one is first');
  assert.match(list[0].says, /EXPIRED 15 days ago/);
  assert.match(list[1].says, /runs out in 36 days/);
  assert.ok(daysLeft(fine, MON('09:00')) > EXPIRY_WARNING_DAYS);
});

test('a half filled licence record is listed as incomplete rather than trusted', () => {
  assert.deepEqual(checkLicenceRecord(LICENCE), []);
  const missing = checkLicenceRecord({ number: 'LL/1', holder: 'Someone' });
  assert.ok(missing.includes('the premises it covers'));
  assert.ok(missing.includes('the expiry date'));
  assert.ok(missing.includes('the permitted hours, copied off the licence'));
  assert.ok(missing.includes('where the copy on file came from'));
  assert.deepEqual(checkLicenceRecord({}).length > 4, true);
});

test('a time that is not a time is refused rather than guessed at', () => {
  assert.throws(() => parseTime('half eight'), LiquorError);
  assert.throws(() => parseTime('25:00'), /not a real time/);
  assert.throws(() => parseTime('10:70'), /not a real time/);
  assert.equal(parseTime('09:30'), 570);
  assert.equal(hhmm(570), '09:30');
  assert.equal(hhmm(1320), '22:00');
});

test('every line a person reads is plain and has no dashes', () => {
  const lines = [
    mayHandOver(null, MON('12:00')).says,
    mayHandOver(LICENCE, MON('12:00')).says,
    mayHandOver(LICENCE, SUN('12:00')).says,
    mayHandOver(LICENCE, MON('20:30')).says,
    mayHandOver({ ...LICENCE, expires: '2026-09-01' }, MON('12:00')).says,
  ];
  for (const l of lines) {
    assert.ok(l.length > 15);
    assert.equal(l.includes(' - '), false, `dash in: ${l}`);
  }
});
