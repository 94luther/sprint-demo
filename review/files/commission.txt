/**
 * Commission: what Sprint earns on the basket, not just on the drop.
 *
 * Asked for by Luther on 15 September 2026, after checking the settlement rules
 * turned up that there was no commission anywhere in the engine at all. Sprint's
 * whole upside was a flat delivery fee, so a merchant sending P50,000 a month paid
 * exactly the same as one sending P5,000 at the same order count. Wanzy and
 * Sixty60 both earn on the basket. It is the number a supermarket deal turns on,
 * and there was no field for it.
 *
 * Three mistakes this codebase has already made are deliberately designed out:
 *
 *   - INVENTED NUMBERS THAT HARDEN INTO POLICY. The 75 and 18 percent split in
 *     ledger.repo.ts was nobody's decision. So a rate here is worth nothing until
 *     `agreed` is true, and an unagreed rate earns ZERO rather than a guess.
 *   - A RATE WITH NO PROVENANCE. Every set of terms must say where the number came
 *     from, in writing, or it cannot be agreed.
 *   - MONEY AS A FLOAT. Rates are basis points as whole integers. 1500 is fifteen
 *     percent. There is no 0.15 anywhere in this file.
 *
 * And one thing is left deliberately undone: no rate is set for any merchant here.
 * Nobody has signed anything. The rates in a negotiation belong to Luther and
 * Barbara, and this file's job is to hold them correctly once they exist.
 */

export class CommissionError extends Error {}

/** 10,000 basis points is one hundred percent. 1500 is fifteen. */
export const BP = 10000;

/**
 * A rate this high is almost certainly a typo, not a deal. The cap is a guard
 * against a fat finger, not a commercial opinion: an override is possible, it
 * just has to be deliberate.
 */
export const SANITY_CAP_BP = 3500;

export interface MerchantTerms {
  merchant_id: string;
  merchant_name: string;
  /** basis points of the GOODS, never of the delivery fee */
  commission_bp: number;
  /** true only when the merchant has signed and Barbara has countersigned */
  agreed: boolean;
  /** the day it was agreed, or null while it is still a proposal */
  agreed_on: string | null;
  /** where the number came from. A rate with no source cannot be agreed. */
  source: string;
  /** set deliberately when a rate above the sanity cap is genuinely the deal */
  allowAboveCap?: boolean;
}

export function checkTerms(t: MerchantTerms): void {
  if (!Number.isInteger(t.commission_bp)) {
    throw new CommissionError('A commission rate is whole basis points. 1500 is fifteen percent.');
  }
  if (t.commission_bp < 0) throw new CommissionError('A commission rate cannot be less than nothing.');
  if (t.commission_bp > BP) throw new CommissionError('A commission rate cannot be more than the whole basket.');
  if (t.commission_bp > SANITY_CAP_BP && !t.allowAboveCap) {
    throw new CommissionError(
      `${pct(t.commission_bp)} is above the ${pct(SANITY_CAP_BP)} sanity cap. If that really is the deal, say so deliberately.`,
    );
  }
  if (t.agreed && !t.source.trim()) {
    throw new CommissionError('A rate cannot be agreed without saying where it came from.');
  }
  if (t.agreed && !t.agreed_on) {
    throw new CommissionError('An agreed rate needs the day it was agreed.');
  }
}

export function pct(bp: number): string {
  const whole = Math.floor(bp / 100);
  const rest = bp % 100;
  return rest === 0 ? `${whole} percent` : `${whole}.${String(rest).padStart(2, '0')} percent`;
}

export interface CommissionVerdict {
  /** thebe Sprint earns on these goods. Zero whenever the rate is not agreed. */
  thebe: number;
  earned: boolean;
  says: string;
}

/**
 * What Sprint earns on the goods of one order.
 *
 * An unagreed rate earns nothing. That is the whole safety of this file: a rate
 * typed in during a negotiation cannot start taking money from a merchant because
 * somebody forgot it was only a proposal.
 */
export function commissionOn(goodsThebe: number, terms: MerchantTerms | null): CommissionVerdict {
  if (!terms) {
    return { thebe: 0, earned: false, says: 'No terms on file for this merchant, so nothing is taken.' };
  }
  checkTerms(terms);
  if (!Number.isInteger(goodsThebe) || goodsThebe < 0) {
    throw new CommissionError('Goods are whole thebe, and cannot be less than nothing.');
  }
  if (!terms.agreed) {
    return {
      thebe: 0,
      earned: false,
      says: `${pct(terms.commission_bp)} is proposed for ${terms.merchant_name} and not agreed, so nothing is taken.`,
    };
  }
  const thebe = Math.round((goodsThebe * terms.commission_bp) / BP);
  return {
    thebe,
    earned: true,
    says: `${pct(terms.commission_bp)} of the goods, agreed ${terms.agreed_on}`,
  };
}

/** What the merchant is left with after Sprint's share of the goods. */
export function merchantNets(goodsThebe: number, terms: MerchantTerms | null): number {
  return goodsThebe - commissionOn(goodsThebe, terms).thebe;
}

/* ------------------------------------------------------------------ the deal */

export interface RateOption {
  bp: number;
  label: string;
  sprint_earns_thebe: number;
  merchant_keeps_thebe: number;
}

/**
 * What a month of this merchant's baskets would earn at each rate being
 * discussed, so a negotiation is done against arithmetic instead of a feeling.
 *
 * The delivery fees are passed in separately and deliberately: they are earned
 * whatever the commission is, and adding them to the commission column is how a
 * rate ends up looking better than it is.
 */
export function whatRatesWouldEarn(
  monthlyGoodsThebe: number,
  rates: number[] = [500, 1000, 1500, 2000, 2500],
): RateOption[] {
  if (!Number.isInteger(monthlyGoodsThebe) || monthlyGoodsThebe < 0) {
    throw new CommissionError('A month of goods is whole thebe, and cannot be less than nothing.');
  }
  return rates
    .filter((bp) => Number.isInteger(bp) && bp >= 0 && bp <= BP)
    .sort((a, b) => a - b)
    .map((bp) => {
      const earns = Math.round((monthlyGoodsThebe * bp) / BP);
      return {
        bp,
        label: pct(bp),
        sprint_earns_thebe: earns,
        merchant_keeps_thebe: monthlyGoodsThebe - earns,
      };
    });
}

/**
 * The question nobody could answer before this file existed: at this merchant's
 * volume, is the commission or the delivery fee the bigger line? If the fee wins,
 * the rate is too low to be worth arguing about and the conversation should be
 * about volume instead.
 */
export function whichEarnsMore(
  monthlyGoodsThebe: number,
  monthlyDeliveryFeesThebe: number,
  terms: MerchantTerms | null,
): { commission: number; fees: number; bigger: 'commission' | 'fees' | 'level'; says: string } {
  const commission = commissionOn(monthlyGoodsThebe, terms).thebe;
  const fees = monthlyDeliveryFeesThebe;
  const bigger = commission === fees ? 'level' : commission > fees ? 'commission' : 'fees';
  return {
    commission,
    fees,
    bigger,
    says:
      bigger === 'fees'
        ? 'The delivery fees earn more than the commission here, so volume matters more than the rate.'
        : bigger === 'commission'
          ? 'The commission earns more than the delivery fees here, so the rate is the thing to negotiate.'
          : 'The commission and the delivery fees earn the same here.',
  };
}
