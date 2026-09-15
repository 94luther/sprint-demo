import { Global, Module } from '@nestjs/common';
import { StoreService } from './store.service';
import { OrdersRepo } from './repositories/orders.repo';
import { CouriersRepo } from './repositories/couriers.repo';
import { LedgerRepo } from './repositories/ledger.repo';
import { OutboxRepo } from './repositories/outbox.repo';
import { UsersRepo } from './repositories/users.repo';
import { MerchantsRepo } from './repositories/merchants.repo';

// Global so every feature module can inject a repo without re-importing
// this module everywhere. The JSON file store itself lives behind
// StoreService; nothing outside this folder touches the filesystem.
@Global()
@Module({
  providers: [StoreService, OrdersRepo, CouriersRepo, LedgerRepo, OutboxRepo, UsersRepo, MerchantsRepo],
  exports: [StoreService, OrdersRepo, CouriersRepo, LedgerRepo, OutboxRepo, UsersRepo, MerchantsRepo],
})
export class DataStoreModule {}
