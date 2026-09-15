import { Injectable } from '@nestjs/common';
import { StoreService } from '../store.service';
import { MerchantRecord } from '../interfaces';
import { IMerchantsRepo } from '../repo-interfaces';

@Injectable()
export class MerchantsRepo implements IMerchantsRepo {
  constructor(private readonly store: StoreService) {}

  listAll(): MerchantRecord[] {
    return this.store.state.merchants;
  }

  findById(id: string): MerchantRecord | undefined {
    return this.store.state.merchants.find((m) => m.id === id);
  }
}
