/**
 * Brick 27's proof. Run with:
 *   npm --prefix api run test:orders
 *
 * Every expected number below was typed from the signed contract, UPDATED SLA_2026.pdf page 10,
 * read by word position on 13 September 2026. If a test here fails, either the tariff file drifted
 * from the contract or somebody changed the rules. Both are worth stopping for.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quote, chargedWeight, ladder, priceNote, provenance, ParcelError, MAX_TABLE_KG } from './parcel';

test('the prices are the ones in the signed contract', () => {
  // KGs | Zone 1 | Zone 2 | Zone 3 | Zone 4
  assert.equal(quote(0.5, '1').price, 87.0);
  assert.equal(quote(0.5, '2').price, 98.0);
  assert.equal(quote(0.5, '3').price, 114.0);
  assert.equal(quote(0.5, '4').price, 152.0);
  assert.equal(quote(1, '1').price, 93.0);
  assert.equal(quote(5, '1').price, 136.0);
  assert.equal(quote(5, '4').price, 250.0);
  assert.equal(quote(10, '2').price, 242.0);
  assert.equal(quote(20, '1').price, 298.0);
  assert.equal(quote(20, '4').price, 575.0);
});

test('the five to twenty kilo band is priced, which is the band that was missing elsewhere', () => {
  for (const kg of [5.5, 8, 12.5, 16, 19.5, 20]) {
    for (const z of ['1', '2', '3', '4'] as const) {
      const q = quote(kg, z);
      assert.ok(q.price > 0, `${kg}kg zone ${z} has no price`);
      assert.equal(q.beyond_table, false);
    }
  }
  assert.equal(quote(15, '3').price, 366.0);
});

test('a part weight is charged at the next half kilo, never rounded down', () => {
  assert.equal(chargedWeight(0.1), 0.5);
  assert.equal(chargedWeight(1.2), 1.5);
  assert.equal(chargedWeight(2.0), 2.0);
  assert.equal(quote(1.2, '1').price, quote(1.5, '1').price);
  assert.equal(quote(1.2, '1').charged_kg, 1.5);
});

test('past the table it uses the contract per kilo rate, not a guess', () => {
  const q = quote(25, '1');
  assert.equal(q.beyond_table, true);
  // 20kg zone 1 is 298.00, then 9.00 a kilo for the next five
  assert.equal(q.price, 298.0 + 5 * 9.0);
  assert.equal(quote(30, '4').price, 575.0 + 10 * 16.0);
});

test('a weight with no price is refused rather than estimated', () => {
  assert.throws(() => quote(0, '1'), /needs a weight/);
  assert.throws(() => quote(-3, '1'), /needs a weight/);
  assert.throws(() => quote(NaN, '1'), /needs a weight/);
});

test('a zone Sprint does not contract is refused', () => {
  assert.throws(() => quote(5, '5' as any), /zones 1 to 4 only/);
  assert.throws(() => quote(5, 'Gaborone' as any), /not in the contract/);
});

test('every price is all inclusive and the app says so', () => {
  const q = quote(5, '2');
  assert.equal(q.includes_vat, true);
  assert.match(q.says, /everything included/);
  assert.match(priceNote(), /Includes VAT at 14 percent and the fuel surcharge at 42 percent/);
  assert.match(priceNote(), /Nothing is added at the end/);
});

test('the price rises with weight and with distance, with no dips', () => {
  for (const z of ['1', '2', '3', '4'] as const) {
    let last = 0;
    for (let kg = 0.5; kg <= MAX_TABLE_KG; kg += 0.5) {
      const p = quote(Math.round(kg * 10) / 10, z).price;
      assert.ok(p >= last, `zone ${z} dips at ${kg}kg: ${p} after ${last}`);
      last = p;
    }
  }
  for (const kg of [0.5, 5, 12, 20]) {
    const prices = (['1', '2', '3', '4'] as const).map((z) => quote(kg, z).price);
    assert.deepEqual(prices, [...prices].sort((a, b) => a - b), `zones out of order at ${kg}kg`);
  }
});

test('the ladder a customer sees has no gaps and no invented rows', () => {
  const l = ladder('1', 5);
  assert.equal(l.length, 10, 'half kilo steps from 0.5 to 5');
  assert.equal(l[0].price, 87.0);
  assert.equal(l[l.length - 1].price, 136.0);
});

test('the prices can always be traced back to the document they came from', () => {
  const p = provenance();
  assert.match(p.document, /SLA/);
  assert.equal(p.page, 10);
  assert.match(p.method, /word position/);
  assert.match(p.why, /derived file is never a source/);
  assert.match(quote(5, '1').source, /page 10/);
});
