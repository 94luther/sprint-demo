import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { StoreService } from '../store.service';
import { IOutboxRepo } from '../repo-interfaces';

// Append only log of lifecycle events (order.placed, order.paid,
// dispatch.offered, dispatch.accepted, order.picked_up, order.delivered).
// In production this feeds a real outbox pattern into a message queue; here
// it is just rows in store.json for the demo to show off.
@Injectable()
export class OutboxRepo implements IOutboxRepo {
  constructor(private readonly store: StoreService) {}

  append(event: string, orderId: string, payload: unknown): void {
    this.store.state.events_outbox.push({
      id: crypto.randomUUID(),
      event,
      order_id: orderId,
      payload,
      at: new Date().toISOString(),
    });
    this.store.markDirty();
  }
}
