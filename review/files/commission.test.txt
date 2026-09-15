import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BP,
  SANITY_CAP_BP,
  CommissionError,
  checkTerms,
  pct,
  commissionOn,
  merchantNets,
  whatRatesWouldEarn,
  whichEarnsMore,
  type MerchantTerms,
} from './commission';

const terms = (over: Partial<MerchantTerms> = {}): MerchantTerms => ({
  merchant_id: 'M1',
  merchant_name: 'Broadhurst Hardware',
  commission_bp: 1500,
  agreed: false,
  agreed_on: null,
  source: '',
  ...over,
});

const signed = (over: Partial<MerchantTerms> = {}) =>
  terms({ agreed: true, agreed_on: '2026-09-15', source: 'Signed schedule 2 of the merchant agreement', ...over });

/* ------------- the safety that matters most ------------- */

test('A RATE THAT IS NOT AGREED EARNS NOTHING, however real it looks', () => {
  const v = commissionOn(100000, terms({ commission_bp: 2000 }));
  assert.equal(v.thebe, 0);
  assert.equal(v.earned, false);
  assert.match(v.says, /proposed/);
  assert.match(v.says, /not agreed/);
});

test('a merchant with no terms on file is charged nothing, never a default', () => {
  const v = commissionOn(100000, null);
  assert.equal(v.thebe, 0);
  assert.equal(v.earned, false);
  assert.match(v.says, /No terms on file/);
});

test('a rate cannot be agreed without saying where the number came from', () => {
  assert.throws(() => checkTerms(terms({ agreed: true, agreed_on: '2026-09-15', source: '   ' })),
    /where it came from/);
});

test('an agreed rate must carry the day it was agreed', () => {
  assert.throws(() => checkTerms(terms({ agreed: true, agreed_on: null, source: 'the deal' })),
    /needs the day/);
});

/* ------------- money is integers, never a float ------------- */

test('a rate is whole basis points, so fifteen percent is 1500 and never 0.15', () => {
  assert.throws(() => checkTerms(terms({ commission_bp: 0.15 })), /whole basis points/);
  assert.throws(() => checkTerms(terms({ commission_bp: 15.5 })), CommissionError);
});

test('commission comes out as whole thebe on an awkward basket', () => {
  const v = commissionOn(6533, signed({ commission_bp: 1750 }));
  assert.ok(Number.isInteger(v.thebe), 'a fraction of a thebe came out');
  assert.equal(v.thebe, Math.round((6533 * 1750) / BP));
});

test('a rate below nothing or above the whole basket is refused', () => {
  assert.throws(() => checkTerms(terms({ commission_bp: -1 })), /less than nothing/);
  assert.throws(() => checkTerms(terms({ commission_bp: BP + 1 })), /more than the whole basket/);
});

/* ------------- the fat finger guard ------------- */

test('a rate above the sanity cap is refused, because it is probably a typo', () => {
  assert.throws(() => checkTerms(terms({ commission_bp: 5000 })), /sanity cap/);
  assert.equal(SANITY_CAP_BP, 3500);
});

test('but a rate above the cap can be set deliberately, if that really is the deal', () => {
  assert.doesNotThrow(() => checkTerms(terms({ commission_bp: 5000, allowAboveCap: true })));
});

/* ------------- what it actually earns ------------- */

test('an agreed rate takes its share of the goods and says so plainly', () => {
  const v = commissionOn(20000, signed({ commission_bp: 1500 }));
  assert.equal(v.thebe, 3000, 'P30 of a P200 basket');
  assert.equal(v.earned, true);
  assert.match(v.says, /15 percent/);
  assert.match(v.says, /2026-09-15/);
});

test('the merchant keeps the rest, and the two always sum to the goods', () => {
  for (const goods of [1, 999, 20000, 500000]) {
    const t = signed({ commission_bp: 1750 });
    assert.equal(merchantNets(goods, t) + commissionOn(goods, t).thebe, goods);
  }
});

test('commission is charged on the goods only, never on the delivery fee', () => {
  // the fee is not passed in at all, which is the guarantee
  const v = commissionOn(20000, signed({ commission_bp: 2000 }));
  assert.equal(v.thebe, 4000, 'P40 of the P200 goods, and nothing of the P25 fee');
});

test('a rate reads as a person would say it', () => {
  assert.equal(pct(1500), '15 percent');
  assert.equal(pct(1750), '17.50 percent');
  assert.equal(pct(0), '0 percent');
});

/* ------------- the negotiation ------------- */

test('a month of baskets is priced at every rate on the table, for the actual conversation', () => {
  const options = whatRatesWouldEarn(5000000, [1000, 1500, 2000]); // P50,000 of goods
  assert.equal(options.length, 3);
  assert.deepEqual(options.map((o) => o.label), ['10 percent', '15 percent', '20 percent']);
  assert.equal(options[0].sprint_earns_thebe, 500000); // P5,000
  assert.equal(options[1].sprint_earns_thebe, 750000); // P7,500
  assert.equal(options[2].sprint_earns_thebe, 1000000); // P10,000
  for (const o of options) {
    assert.equal(o.sprint_earns_thebe + o.merchant_keeps_thebe, 5000000);
  }
});

test('the options always come back lowest rate first, whatever order they are given in', () => {
  const options = whatRatesWouldEarn(100000, [2500, 500, 1500]);
  assert.deepEqual(options.map((o) => o.bp), [500, 1500, 2500]);
});

test('THE QUESTION NOBODY COULD ANSWER: is the rate or the volume the thing to argue about', () => {
  // A supermarket: P50,000 of goods a month, 200 drops at P25
  const big = whichEarnsMore(5000000, 500000, signed({ commission_bp: 1500 }));
  assert.equal(big.bigger, 'commission');
  assert.equal(big.commission, 750000);
  assert.match(big.says, /rate is the thing to negotiate/);

  // A small shop: P4,000 of goods a month, 60 drops at P25
  const small = whichEarnsMore(400000, 150000, signed({ commission_bp: 1500 }));
  assert.equal(small.bigger, 'fees');
  assert.match(small.says, /volume matters more than the rate/);
});

test('while a rate is unagreed, the comparison honestly shows nothing earned', () => {
  const v = whichEarnsMore(5000000, 500000, terms({ commission_bp: 1500 }));
  assert.equal(v.commission, 0);
  assert.equal(v.bigger, 'fees');
});
