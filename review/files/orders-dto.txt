import { PaymentMethod } from '../common/types';

export interface CreateOrderItemDto {
  item_id: string;
  qty: number;
}

export interface CreateOrderDto {
  merchant_id: string;
  items: CreateOrderItemDto[];
  payment_method: PaymentMethod;
  address: string;
  age_confirmed?: boolean;
}
