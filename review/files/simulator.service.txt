import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CouriersRepo } from '../data-store/repositories/couriers.repo';
import { OrdersRepo } from '../data-store/repositories/orders.repo';
import { MerchantsRepo } from '../data-store/repositories/merchants.repo';
import { LedgerRepo } from '../data-store/repositories/ledger.repo';
import { OutboxRepo } from '../data-store/repositories/outbox.repo';
import { DispatchService } from '../dispatch/dispatch.service';
import { TrackingGateway } from '../tracking/tracking.gateway';
import { WAYPOINTS } from '../common/waypoints';
import { nextStepDelayMs } from '../orders/orders.service';
import { OrderRecord } from '../data-store/interfaces';
import { OrderStatus } from '../common/types';

const TICK_MS = 1000;
const IDLE_LERP = 0.12;
const BUSY_LERP = 0.28;
const ARRIVE_THRESHOLD = 0.003; // roughly 300m in degrees, close enough for a demo

// Order status walked through in order, each entry paired with the outbox
// event name used for that transition. Kept as a lookup table so the
// lifecycle only has to be spelled out once.
const NEXT_STEP: Record<string, { status: OrderStatus; event: string } | undefined> = {
  placed: { status: 'paid', event: 'order.paid' },
  paid: { status: 'dispatch.offered', event: 'dispatch.offered' },
  'dispatch.offered': { status: 'dispatch.accepted', event: 'dispatch.accepted' },
  'dispatch.accepted': { status: 'picked_up', event: 'order.picked_up' },
  picked_up: { status: 'delivered', event: 'order.delivered' },
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function distance(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  return Math.hypot(a.lat - b.lat, a.lng - b.lng);
}

// The whole demo's heartbeat: every second it nudges every courier's
// position and checks whether any order has reached its randomly rolled
// next_step_at, advancing the ones that have. This is what makes the API
// feel alive without any client ever polling for it.
@Injectable()
export class SimulatorService implements OnModuleInit {
  private readonly logger = new Logger(SimulatorService.name);

  constructor(
    private readonly couriersRepo: CouriersRepo,
    private readonly ordersRepo: OrdersRepo,
    private readonly merchantsRepo: MerchantsRepo,
    private readonly ledgerRepo: LedgerRepo,
    private readonly outboxRepo: OutboxRepo,
    private readonly dispatchService: DispatchService,
    private readonly tracking: TrackingGateway,
  ) {}

  onModuleInit(): void {
    setInterval(() => this.tick(), TICK_MS);
    this.logger.log('Simulator started, couriers wandering and orders advancing on their own.');
  }

  private tick(): void {
    this.moveCouriers();
    this.advanceDueOrders();
  }

  private moveCouriers(): void {
    const couriers = this.couriersRepo.listAll();
    for (const courier of couriers) {
      const activeOrder = this.ordersRepo
        .listActiveForCourier(courier.id)
        .find((o) => o.status === 'dispatch.accepted' || o.status === 'picked_up');

      if (activeOrder) {
        const target =
          activeOrder.status === 'picked_up'
            ? { lat: activeOrder.delivery_lat, lng: activeOrder.delivery_lng }
            : this.merchantPoint(activeOrder);
        if (target) {
          courier.lat = lerp(courier.lat, target.lat, BUSY_LERP);
          courier.lng = lerp(courier.lng, target.lng, BUSY_LERP);
        }
      } else {
        const wp = WAYPOINTS[courier.waypoint_target % WAYPOINTS.length];
        courier.lat = lerp(courier.lat, wp.lat, IDLE_LERP);
        courier.lng = lerp(courier.lng, wp.lng, IDLE_LERP);
        if (distance(courier, wp) < ARRIVE_THRESHOLD) {
          let next = Math.floor(Math.random() * WAYPOINTS.length);
          if (next === courier.waypoint_target) next = (next + 1) % WAYPOINTS.length;
          courier.waypoint_target = next;
        }
      }
    }
    for (const courier of couriers) {
      this.couriersRepo.update(courier.id, { lat: courier.lat, lng: courier.lng, waypoint_target: courier.waypoint_target });
    }
    this.tracking.emitCourierLocations(
      couriers.map((c) => ({ id: c.id, lat: c.lat, lng: c.lng, status: c.status })),
    );
  }

  private merchantPoint(order: OrderRecord): { lat: number; lng: number } | null {
    const merchant = this.merchantsRepo.findById(order.merchant_id);
    return merchant ? { lat: merchant.lat, lng: merchant.lng } : null;
  }

  private advanceDueOrders(): void {
    const due = this.ordersRepo.listDue(Date.now());
    for (const order of due) {
      this.advanceOrder(order);
    }
  }

  private advanceOrder(order: OrderRecord): void {
    const step = NEXT_STEP[order.status];
    if (!step) return;

    const nowIso = new Date().toISOString();
    order.status = step.status;
    order.timeline.push({ status: step.status, at: nowIso });
    order.next_step_at = Date.now() + nextStepDelayMs();
    this.ordersRepo.update(order.id, {
      status: order.status,
      timeline: order.timeline,
      next_step_at: order.next_step_at,
    });
    this.outboxRepo.append(step.event, order.id, { status: step.status });
    this.tracking.emitOrderStatus(order.id, step.status);

    if (step.status === 'dispatch.offered') {
      this.dispatchService.assign(order);
    } else if (step.status === 'dispatch.accepted') {
      if (order.courier_id) this.couriersRepo.update(order.courier_id, { status: 'busy' });
    } else if (step.status === 'delivered') {
      this.ledgerRepo.writeOrderSplit(order.id, order.total_bwp);
      if (order.courier_id) {
        const courier = this.couriersRepo.findById(order.courier_id);
        if (courier) {
          const courierAmt = Math.round(order.total_bwp * 0.18 * 100) / 100;
          this.couriersRepo.update(order.courier_id, {
            earnings_today_bwp: Math.round((courier.earnings_today_bwp + courierAmt) * 100) / 100,
            status: 'online',
          });
        }
      }
    }
  }
}
