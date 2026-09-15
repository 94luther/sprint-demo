export type Role = 'customer' | 'courier' | 'ops';

export type PaymentMethod = 'orange_money' | 'myzaka' | 'smega' | 'card' | 'cash';

export type MerchantType = 'food' | 'grocery' | 'vape' | 'pharmacy';

export type OrderStatus =
  | 'placed'
  | 'paid'
  | 'dispatch.offered'
  | 'dispatch.accepted'
  | 'picked_up'
  | 'delivered';

export interface AuthedRequest extends Express.Request {
  user?: {
    sub: string;
    role: Role;
    name: string;
  };
}
