import { Injectable } from '@nestjs/common';
import * as h3 from 'h3-js';
import { CouriersRepo } from '../data-store/repositories/couriers.repo';
import { OrdersRepo } from '../data-store/repositories/orders.repo';
import { MerchantsRepo } from '../data-store/repositories/merchants.repo';
import { StoreService } from '../data-store/store.service';
import { toPublicOrder } from '../orders/orders.service';

const H3_RES = 9;

@Injectable()
export class OpsService {
  constructor(
    private readonly couriersRepo: CouriersRepo,
    private readonly ordersRepo: OrdersRepo,
    private readonly merchantsRepo: MerchantsRepo,
    private readonly store: StoreService,
  ) {}

  getState() {
    const couriers = this.couriersRepo.listAll().map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      lat: c.lat,
      lng: c.lng,
      h3: h3.latLngToCell(c.lat, c.lng, H3_RES),
      rating: c.rating,
      earnings_today_bwp: c.earnings_today_bwp,
    }));

    const orders = this.ordersRepo.listAll().map((o) => {
      const courier = o.courier_id ? this.couriersRepo.findById(o.courier_id) : undefined;
      const merchant = this.merchantsRepo.findById(o.merchant_id);
      return toPublicOrder(
        o,
        courier ? { name: courier.name, rating: courier.rating, lat: courier.lat, lng: courier.lng } : null,
        merchant?.name,
      );
    });

    return {
      couriers,
      orders,
      last_dispatch: this.store.state.last_dispatch,
    };
  }
}
