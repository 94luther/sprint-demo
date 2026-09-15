import {
  CourierRecord,
  LedgerEntryRecord,
  MerchantRecord,
  OrderRecord,
  UserRecord,
} from './interfaces';

// Repository interfaces. Controllers and services depend on these, never on
// StoreService directly, so the storage engine can change (see
// postgres.repo.stub.ts) without touching a single line of business logic.

export interface IOrdersRepo {
  create(order: OrderRecord): void;
  findById(id: string): OrderRecord | undefined;
  findByIdempotency(userId: string, key: string): OrderRecord | undefined;
  saveIdempotency(userId: string, key: string, orderId: string): void;
  listActiveForCourier(courierId: string): OrderRecord[];
  listAll(): OrderRecord[];
  listDue(nowMs: number): OrderRecord[];
  update(id: string, patch: Partial<OrderRecord>): void;
}

export interface ICouriersRepo {
  listAll(): CourierRecord[];
  findById(id: string): CourierRecord | undefined;
  update(id: string, patch: Partial<CourierRecord>): void;
  medianEarningsToday(): number;
}

export interface ILedgerRepo {
  writeOrderSplit(orderId: string, totalBwp: number): LedgerEntryRecord[];
}

export interface IOutboxRepo {
  append(event: string, orderId: string, payload: unknown): void;
}

export interface IUsersRepo {
  findByPhone(phone: string): UserRecord | undefined;
}

export interface IMerchantsRepo {
  listAll(): MerchantRecord[];
  findById(id: string): MerchantRecord | undefined;
}
