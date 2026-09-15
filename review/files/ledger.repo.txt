import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { StoreService } from '../store.service';
import { LedgerEntryRecord } from '../interfaces';
import { ILedgerRepo } from '../repo-interfaces';

// Writes the payout split for a delivered order as real double entry rows:
// every split (merchant_payable, courier_earnings, sprint_take) gets a debit
// against a clearing account and a matching credit against its own account,
// so the rows always balance in pairs.
/**
 * INVENTED FIGURES. NOT A COMMERCIAL AGREEMENT. Found 15 September 2026 while
 * checking the settlement rules, and named here rather than left loose in the
 * arithmetic.
 *
 * These 75 and 18 percent shares contradict the settlement engine, which is the
 * file that decides what anybody is actually paid. settlement.ts pays a merchant
 * ONE HUNDRED percent of the goods on a delivered order and keeps only the
 * delivery fee for Sprint. This repository splits the same order three ways.
 *
 * They disagree because they were written for different purposes: this one only
 * feeds the simulator, and simulator.service.ts is the only caller. Nobody is
 * paid from it. But a file called a ledger, writing double entry rows that
 * balance, is exactly the thing somebody trusts later without reading it, so the
 * numbers are marked rather than tidied away.
 *
 * Neither model can be the real one until Barbara agrees the fault model, which
 * docs/FAULT_MODEL.md still records as "Status: proposed. Not yet agreed by
 * Barbara." A test holds `agreed` at false so this cannot quietly become policy.
 */
export const SIMULATOR_SPLIT = {
  merchant: 0.75,
  courier: 0.18,
  /** Sprint takes the remainder, so the three always sum to the order exactly. */
  agreed: false,
  contradicts:
    'settlement.ts pays the merchant 100 percent of goods and gives Sprint only the delivery fee',
} as const;

@Injectable()
export class LedgerRepo implements ILedgerRepo {
  constructor(private readonly store: StoreService) {}

  writeOrderSplit(orderId: string, totalBwp: number): LedgerEntryRecord[] {
    const merchantAmt = Math.round(totalBwp * SIMULATOR_SPLIT.merchant * 100) / 100;
    const courierAmt = Math.round(totalBwp * SIMULATOR_SPLIT.courier * 100) / 100;
    // Sprint's cut takes the remainder so the three splits always sum to
    // the exact order total, rounding included.
    const sprintAmt = Math.round((totalBwp - merchantAmt - courierAmt) * 100) / 100;

    const now = new Date().toISOString();
    const rows: LedgerEntryRecord[] = [];
    const pairs: [string, number][] = [
      ['merchant_payable', merchantAmt],
      ['courier_earnings', courierAmt],
      ['sprint_take', sprintAmt],
    ];

    for (const [account, amount] of pairs) {
      rows.push({
        id: crypto.randomUUID(),
        order_id: orderId,
        account: 'cash_clearing',
        type: 'debit',
        amount_bwp: amount,
        created_at: now,
      });
      rows.push({
        id: crypto.randomUUID(),
        order_id: orderId,
        account,
        type: 'credit',
        amount_bwp: amount,
        created_at: now,
      });
    }

    this.store.state.ledger_entries.push(...rows);
    this.store.persist();
    return rows;
  }
}
