import { BadRequestException, ForbiddenException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { OrdersRepo } from '../data-store/repositories/orders.repo';
import { MerchantsRepo } from '../data-store/repositories/merchants.repo';
import { CouriersRepo } from '../data-store/repositories/couriers.repo';
import { OutboxRepo } from '../data-store/repositories/outbox.repo';
import { StoreService } from '../data-store/store.service';
import { encrypt } from '../common/aes';
import { randomPointInGaborone } from '../common/waypoints';
import { CreateOrderDto } from './dto';
import { PaymentMethod } from '../common/types';
import { OrderRecord } from '../data-store/interfaces';

const PAYMENT_METHODS: PaymentMethod[] = ['orange_money', 'myzaka', 'smega', 'card', 'cash'];

// Random 6 to 10 second gap before the simulator advances an order to its
// next lifecycle step, scaled by DEMO_SPEED so the whole demo can run
// faster or slower without touching any other code.
export function nextStepDelayMs(): number {
  const speed = Number(process.env.DEMO_SPEED) || 1;
  const seconds = 6 + Math.random() * 4;
  return Math.round((seconds * 1000) / speed);
}

// Shape returned to API clients for both POST /orders and GET /orders/:id.
// Never includes the encrypted address ciphertext, that stays in
// data/store.json as the demo's "look, it's really encrypted" talking point.
export function toPublicOrder(
  order: OrderRecord,
  courier?: { name: string; rating: number; lat: number; lng: number } | null,
  merchantName?: string,
) {
  return {
    id: order.id,
    merchant_id: order.merchant_id,
    merchant_name: merchantName,
    items: order.items,
    total_bwp: order.total_bwp,
    payment_method: order.payment_method,
    status: order.status,
    timeline: order.timeline,
    courier: courier || undefined,
    eta_min: order.eta_min,
    created_at: order.created_at,
  };
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly ordersRepo: OrdersRepo,
    private readonly merchantsRepo: MerchantsRepo,
    private readonly couriersRepo: CouriersRepo,
    private readonly outboxRepo: OutboxRepo,
    private readonly store: StoreService,
  ) {}

  create(userId: string, dto: CreateOrderDto, idempotencyKey: string) {
    if (!idempotencyKey) {
      throw new BadRequestException('An Idempotency-Key header is needed so we never double place an order.');
    }

    const existing = this.ordersRepo.findByIdempotency(userId, idempotencyKey);
    if (existing) {
      return this.buildResponse(existing);
    }

    if (!dto || !dto.merchant_id) {
      throw new BadRequestException('merchant_id is needed.');
    }
    const merchant = this.merchantsRepo.findById(dto.merchant_id);
    if (!merchant) {
      throw new BadRequestException('We could not find that merchant.');
    }
    if (!Array.isArray(dto.items) || dto.items.length === 0) {
      throw new BadRequestException('Please add at least one item to the order.');
    }
    if (!PAYMENT_METHODS.includes(dto.payment_method)) {
      throw new BadRequestException('That payment method is not one we support yet.');
    }
    if (!dto.address || !dto.address.trim()) {
      throw new BadRequestException('A delivery address is needed.');
    }

    if (merchant.type === 'vape' && dto.age_confirmed !== true) {
      throw new HttpException({ code: 'AGE_GATE', message: 'Please confirm the customer is 18 or older before we can place this order.' }, 403);
    }

    const orderItems = dto.items.map((it) => {
      const found = merchant.items.find((mi) => mi.id === it.item_id);
      if (!found) {
        throw new BadRequestException(`Item ${it.item_id} is not on ${merchant.name}'s menu.`);
      }
      if (!it.qty || it.qty < 1) {
        throw new BadRequestException(`Quantity for ${found.name} needs to be at least 1.`);
      }
      return { item_id: found.id, name: found.name, qty: it.qty, price_bwp: found.price_bwp };
    });

    const total_bwp = Math.round(
      orderItems.reduce((sum, it) => sum + it.price_bwp * it.qty, 0) * 100,
    ) / 100;

    const point = randomPointInGaborone();
    const now = new Date().toISOString();
    const order: OrderRecord = {
      id: crypto.randomUUID(),
      customer_id: userId,
      merchant_id: merchant.id,
      items: orderItems,
      total_bwp,
      payment_method: dto.payment_method,
      address_enc: encrypt(dto.address.trim()),
      delivery_lat: point.lat,
      delivery_lng: point.lng,
      age_confirmed: dto.age_confirmed === true,
      status: 'placed',
      timeline: [{ status: 'placed', at: now }],
      courier_id: null,
      eta_min: null,
      idempotency_key: idempotencyKey,
      created_at: now,
      next_step_at: Date.now() + nextStepDelayMs(),
    };

    this.ordersRepo.create(order);
    this.ordersRepo.saveIdempotency(userId, idempotencyKey, order.id);
    this.outboxRepo.append('order.placed', order.id, { merchant_id: order.merchant_id, total_bwp: order.total_bwp });

    return this.buildResponse(order);
  }

  getById(id: string, requester: { sub: string; role: string }) {
    const order = this.ordersRepo.findById(id);
    // A stranger who guesses a UUID should never learn whether it belongs
    // to someone else, so a denied view looks exactly like a missing one.
    if (!order || !this.canView(order, requester)) {
      throw new NotFoundException('We could not find that order.');
    }
    return this.buildResponse(order);
  }

  // Customers see only their own order, the assigned courier sees only the
  // order they are delivering, ops can see any order.
  private canView(order: OrderRecord, requester: { sub: string; role: string }): boolean {
    if (requester.role === 'ops') return true;
    if (order.customer_id === requester.sub) return true;
    if (requester.role === 'courier' && order.courier_id) {
      const courierUser = this.store.state.users.find((u) => u.id === requester.sub);
      return courierUser?.courier_id === order.courier_id;
    }
    return false;
  }

  private buildResponse(order: OrderRecord) {
    let courier: { name: string; rating: number; lat: number; lng: number } | null = null;
    if (order.courier_id) {
      const c = this.couriersRepo.findById(order.courier_id);
      if (c) courier = { name: c.name, rating: c.rating, lat: c.lat, lng: c.lng };
    }
    const merchant = this.merchantsRepo.findById(order.merchant_id);
    return toPublicOrder(order, courier, merchant?.name);
  }
}
