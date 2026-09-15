import { Injectable } from '@nestjs/common';
import { StoreService } from '../store.service';
import { OrderRecord } from '../interfaces';
import { IOrdersRepo } from '../repo-interfaces';

@Injectable()
export class OrdersRepo implements IOrdersRepo {
  constructor(private readonly store: StoreService) {}

  create(order: OrderRecord): void {
    this.store.state.orders.push(order);
    this.store.persist();
  }

  findById(id: string): OrderRecord | undefined {
    return this.store.state.orders.find((o) => o.id === id);
  }

  findByIdempotency(userId: string, key: string): OrderRecord | undefined {
    const combo = `${userId}:${key}`;
    const rec = this.store.state.idempotency.find((i) => i.key === combo);
    if (!rec) return undefined;
    return this.findById(rec.order_id);
  }

  saveIdempotency(userId: string, key: string, orderId: string): void {
    this.store.state.idempotency.push({ key: `${userId}:${key}`, order_id: orderId });
  }

  listActiveForCourier(courierId: string): OrderRecord[] {
    return this.store.state.orders.filter(
      (o) => o.courier_id === courierId && o.status !== 'delivered',
    );
  }

  listAll(): OrderRecord[] {
    return this.store.state.orders;
  }

  listDue(nowMs: number): OrderRecord[] {
    return this.store.state.orders.filter(
      (o) => o.status !== 'delivered' && o.next_step_at <= nowMs,
    );
  }

  update(id: string, patch: Partial<OrderRecord>): void {
    const order = this.findById(id);
    if (!order) return;
    Object.assign(order, patch);
    this.store.markDirty();
  }
}
