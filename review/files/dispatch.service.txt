import { Injectable } from '@nestjs/common';
import * as h3 from 'h3-js';
import { CouriersRepo } from '../data-store/repositories/couriers.repo';
import { MerchantsRepo } from '../data-store/repositories/merchants.repo';
import { OrdersRepo } from '../data-store/repositories/orders.repo';
import { StoreService } from '../data-store/store.service';
import { TrackingGateway } from '../tracking/tracking.gateway';
import { DispatchScore, OrderRecord } from '../data-store/interfaces';

const H3_RES = 9;

// Real h3-js backed nearest-courier scoring. Lower score wins.
// score = 0.5*eta_min + 1.0*active_load + 0.2*(5 - rating) - 1.5*fairness_boost
@Injectable()
export class DispatchService {
  constructor(
    private readonly couriersRepo: CouriersRepo,
    private readonly merchantsRepo: MerchantsRepo,
    private readonly ordersRepo: OrdersRepo,
    private readonly store: StoreService,
    private readonly tracking: TrackingGateway,
  ) {}

  // Finds and scores couriers for an order, assigns the winner, emits
  // dispatch_scored, and returns the score list (order 0 is the winner).
  assign(order: OrderRecord): DispatchScore[] {
    const merchant = this.merchantsRepo.findById(order.merchant_id);
    const allCouriers = this.couriersRepo.listAll();

    const pickupCell = merchant
      ? h3.latLngToCell(merchant.lat, merchant.lng, H3_RES)
      : null;
    const ringCells = pickupCell ? new Set(h3.gridDisk(pickupCell, 3)) : null;

    const available = allCouriers.filter((c) => c.status !== 'offered' && c.status !== 'busy');
    let candidates = available;
    if (pickupCell && ringCells) {
      const inRing = available.filter((c) =>
        ringCells.has(h3.latLngToCell(c.lat, c.lng, H3_RES)),
      );
      if (inRing.length > 0) candidates = inRing;
    }
    // Safety net for the demo: never leave an order unassignable just
    // because every courier happens to be outside the 3 ring search.
    if (candidates.length === 0) candidates = allCouriers;

    const median = this.couriersRepo.medianEarningsToday();

    const scores: DispatchScore[] = candidates.map((c) => {
      const courierCell = h3.latLngToCell(c.lat, c.lng, H3_RES);
      let hexDistance = 4; // fallback ring distance if h3 cannot compute one
      if (pickupCell) {
        try {
          const d = h3.gridDistance(pickupCell, courierCell);
          if (d >= 0) hexDistance = d;
        } catch {
          // pentagon distortion or non-contiguous grid, keep the fallback
        }
      }
      const eta_min = Math.round((2 + hexDistance * 1.5) * 10) / 10;
      const active_load = this.ordersRepo.listActiveForCourier(c.id).length;
      const rating_gap = Math.round((5 - c.rating) * 10) / 10;
      const fairness_boost = c.earnings_today_bwp < median ? 1 : 0;
      const score =
        0.5 * eta_min + 1.0 * active_load + 0.2 * rating_gap - 1.5 * fairness_boost;

      return {
        courier_id: c.id,
        courier_name: c.name,
        score: Math.round(score * 1000) / 1000,
        components: { eta_min, active_load, rating_gap, fairness_boost },
      };
    });

    scores.sort((a, b) => a.score - b.score);

    const winner = scores[0];
    if (winner) {
      this.ordersRepo.update(order.id, {
        courier_id: winner.courier_id,
        eta_min: Math.round(winner.components.eta_min),
      });
      this.couriersRepo.update(winner.courier_id, { status: 'offered' });
    }

    this.store.state.last_dispatch = { order_id: order.id, scores };
    this.store.persist();
    this.tracking.emitDispatchScored(order.id, scores);
    return scores;
  }
}
