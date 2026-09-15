import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeOnAccount, cancelOnAccount, outstanding, type CorporateAccount, type CorporateOrder } from './corporate';

const account = {
  company: 'Broadhurst Hardware',
  active: true,
  cost_centres: [{ code: 'OPS', name: 'Operations' }],
  credit_limit: 100000, // P1000
} as unknown as CorporateAccount;

const place = (book: CorporateOrder[], id: string, amount: number) =>
  placeOnAccount(book, account, 'A1', amount, 'OPS', id, '2026-09-16T09:00:00', 'goods');

test('THE RESERVATION: the second of two orders that would together break the limit is refused', () => {
  const book: CorporateOrder[] = [];
  assert.equal(place(book, 'o1', 60000).placed, true);
  const second = place(book, 'o2', 60000);
  assert.equal(second.placed, false, 'both passed, the account went over');
  assert.match(second.says, /past its limit/);
  assert.equal(outstanding(book, 'A1'), 60000);
});

test('the check and the record are one step: what is owed reflects the order just placed', () => {
  const book: CorporateOrder[] = [];
  place(book, 'o1', 30000);
  place(book, 'o2', 30000);
  place(book, 'o3', 30000);
  assert.equal(outstanding(book, 'A1'), 90000);
  assert.equal(place(book, 'o4', 20000).placed, false, 'P1100 against a P1000 limit');
});

test('a cancelled order gives its credit back and stops counting', () => {
  const book: CorporateOrder[] = [];
  place(book, 'o1', 80000);
  assert.equal(place(book, 'o2', 30000).placed, false);
  assert.equal(cancelOnAccount(book, 'o1'), true);
  assert.equal(outstanding(book, 'A1'), 0, 'a cancelled order still ate the limit');
  assert.equal(place(book, 'o2', 30000).placed, true);
});

test('cancelling twice, or cancelling nothing, does nothing', () => {
  const book: CorporateOrder[] = [];
  place(book, 'o1', 1000);
  assert.equal(cancelOnAccount(book, 'o1'), true);
  assert.equal(cancelOnAccount(book, 'o1'), false);
  assert.equal(cancelOnAccount(book, 'ghost'), false);
});

test('an amount that is not whole thebe is refused before it touches the book', () => {
  const book: CorporateOrder[] = [];
  assert.equal(place(book, 'o1', 10.5).placed, false);
  assert.equal(place(book, 'o1', 0).placed, false);
  assert.equal(book.length, 0);
});
