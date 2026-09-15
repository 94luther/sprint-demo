import { Injectable } from '@nestjs/common';
import { StoreService } from '../store.service';
import { CourierRecord } from '../interfaces';
import { ICouriersRepo } from '../repo-interfaces';

@Injectable()
export class CouriersRepo implements ICouriersRepo {
  constructor(private readonly store: StoreService) {}

  listAll(): CourierRecord[] {
    return this.store.state.couriers;
  }

  findById(id: string): CourierRecord | undefined {
    return this.store.state.couriers.find((c) => c.id === id);
  }

  update(id: string, patch: Partial<CourierRecord>): void {
    const courier = this.findById(id);
    if (!courier) return;
    Object.assign(courier, patch);
    this.store.markDirty();
  }

  // Fleet wide median of earnings_today_bwp, used by the dispatch fairness
  // boost so a courier who has earned less today is nudged toward more work.
  medianEarningsToday(): number {
    const values = this.listAll()
      .map((c) => c.earnings_today_bwp)
      .sort((a, b) => a - b);
    if (values.length === 0) return 0;
    const mid = Math.floor(values.length / 2);
    return values.length % 2 === 0 ? (values[mid - 1] + values[mid]) / 2 : values[mid];
  }
}
