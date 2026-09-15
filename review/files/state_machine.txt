/**
 * Brick 14. The order state machine, with the exception states.
 *
 * The council's finding, agreed independently by two seats, was that the missing exception
 * workflow (wrong address, out of stock, rider breakdown, customer absent, refund) would
 * collapse operations. The old flow had six states and every one of them was the happy path:
 * an order that went wrong had nowhere to go and simply sat there.
 *
 * Three guarantees are made here, and each one is proved by a test rather than asserted:
 *
 *   1. NO DEAD ENDS. Every state that is not terminal has at least one way out. An order can
 *      always be moved forward or closed out by somebody.
 *   2. NO ORPHANS. Every state is reachable from 'placed'. No state exists that nothing can
 *      ever enter.
 *   3. NOTHING SITS SILENTLY. Every non-terminal state carries a dwell limit in minutes.
 *      Past that, the order belongs on the exception queue in the ops tower.
 *
 * It also carries the hook for brick 15, who pays when a delivery fails: any transition into
 * a failure path must name a fault, and apply() refuses the move without one. Money is never
 * split (brick 19) on an order whose fault was never decided.
 *
 * Deliberately free of NestJS imports so it can be tested on its own and reused by the rider
 * app, the ops tower and the ledger without dragging the framework along.
 */

export type OrderState =
  // the way it goes when nothing goes wrong
  | 'placed'
  | 'paid'
  | 'dispatch_offered'
  | 'dispatch_accepted'
  | 'at_merchant'
  | 'picked_up'
  | 'at_door'
  | 'delivered'
  // the way it actually goes often enough to matter
  | 'payment_failed'
  | 'stock_problem'
  | 'address_problem'
  | 'customer_absent'
  | 'rider_failed'
  | 'returning'
  | 'returned'
  | 'refund_due'
  // the end
  | 'cancelled'
  | 'closed';

/** Who is allowed to move an order. 'system' is the platform acting on its own. */
export type Actor = 'customer' | 'courier' | 'merchant' | 'ops' | 'system';

/** Brick 15. Who carries the cost when this order fails. 'none' means nobody is at fault. */
export type Fault = 'merchant' | 'customer' | 'sprint' | 'rider' | 'none';

export interface Transition {
  from: OrderState;
  event: string;
  to: OrderState;
  actors: Actor[];
  /** When true, apply() refuses the move unless a fault is named. */
  faultRequired?: boolean;
  /** Plain words, so an ops screen can say what happened without a translation table. */
  says: string;
}

export interface StateMeta {
  terminal: boolean;
  /** Minutes an order may sit here before the ops tower is told. null for terminal states. */
  stuckAfterMinutes: number | null;
  /** Is a customer still waiting on an answer while the order sits here. */
  customerWaiting: boolean;
  says: string;
}

export const STATES: Record<OrderState, StateMeta> = {
  placed:            { terminal: false, stuckAfterMinutes: 10,   customerWaiting: true,  says: 'Order placed, payment not settled yet' },
  payment_failed:    { terminal: false, stuckAfterMinutes: 60,   customerWaiting: true,  says: 'Payment did not go through' },
  paid:              { terminal: false, stuckAfterMinutes: 5,    customerWaiting: true,  says: 'Paid, waiting to go to a rider' },
  dispatch_offered:  { terminal: false, stuckAfterMinutes: 3,    customerWaiting: true,  says: 'Offered to riders, none has taken it yet' },
  dispatch_accepted: { terminal: false, stuckAfterMinutes: 20,   customerWaiting: true,  says: 'A rider is on the way to the shop' },
  at_merchant:       { terminal: false, stuckAfterMinutes: 15,   customerWaiting: true,  says: 'Rider is at the shop waiting for the order' },
  stock_problem:     { terminal: false, stuckAfterMinutes: 10,   customerWaiting: true,  says: 'The shop cannot supply something, the customer must choose' },
  picked_up:         { terminal: false, stuckAfterMinutes: 45,   customerWaiting: true,  says: 'Rider has the order and is on the road' },
  at_door:           { terminal: false, stuckAfterMinutes: 10,   customerWaiting: true,  says: 'Rider is at the address' },
  address_problem:   { terminal: false, stuckAfterMinutes: 15,   customerWaiting: true,  says: 'The rider cannot find the place' },
  customer_absent:   { terminal: false, stuckAfterMinutes: 10,   customerWaiting: true,  says: 'Nobody is answering at the address' },
  rider_failed:      { terminal: false, stuckAfterMinutes: 10,   customerWaiting: true,  says: 'The rider cannot finish this one' },
  returning:         { terminal: false, stuckAfterMinutes: 90,   customerWaiting: false, says: 'Goods are going back to the shop' },
  returned:          { terminal: false, stuckAfterMinutes: 1440, customerWaiting: false, says: 'Goods are back with the shop, money not settled' },
  delivered:         { terminal: false, stuckAfterMinutes: 1440, customerWaiting: false, says: 'Handed over, not closed off yet' },
  refund_due:        { terminal: false, stuckAfterMinutes: 2880, customerWaiting: true,  says: 'Money is owed back to somebody' },
  cancelled:         { terminal: true,  stuckAfterMinutes: null, customerWaiting: false, says: 'Cancelled before anyone was out of pocket' },
  closed:            { terminal: true,  stuckAfterMinutes: null, customerWaiting: false, says: 'Finished and settled' },
};

export const TRANSITIONS: Transition[] = [
  // placed
  { from: 'placed', event: 'pay_succeeded', to: 'paid', actors: ['system'], says: 'Payment cleared' },
  { from: 'placed', event: 'pay_failed', to: 'payment_failed', actors: ['system'], says: 'Payment was refused' },
  { from: 'placed', event: 'customer_cancelled', to: 'cancelled', actors: ['customer', 'ops'], says: 'Customer changed their mind before paying' },

  // payment_failed
  { from: 'payment_failed', event: 'retry_payment', to: 'placed', actors: ['customer', 'ops'], says: 'Trying the payment again' },
  { from: 'payment_failed', event: 'abandon', to: 'cancelled', actors: ['customer', 'ops', 'system'], says: 'Payment was never completed' },

  // paid
  { from: 'paid', event: 'offer_to_riders', to: 'dispatch_offered', actors: ['system', 'ops'], says: 'Sent to the riders nearby' },
  { from: 'paid', event: 'merchant_rejected', to: 'stock_problem', actors: ['merchant', 'ops'], faultRequired: true, says: 'The shop cannot take the order' },
  { from: 'paid', event: 'customer_cancelled', to: 'refund_due', actors: ['customer', 'ops'], faultRequired: true, says: 'Cancelled after paying' },

  // dispatch_offered
  { from: 'dispatch_offered', event: 'rider_accepted', to: 'dispatch_accepted', actors: ['courier'], says: 'A rider took it' },
  { from: 'dispatch_offered', event: 'offer_expired', to: 'dispatch_offered', actors: ['system'], says: 'Nobody took it, offering again' },
  { from: 'dispatch_offered', event: 'no_rider_available', to: 'rider_failed', actors: ['system', 'ops'], faultRequired: true, says: 'No rider can take this one' },
  { from: 'dispatch_offered', event: 'customer_cancelled', to: 'refund_due', actors: ['customer', 'ops'], faultRequired: true, says: 'Cancelled while waiting for a rider' },

  // dispatch_accepted
  { from: 'dispatch_accepted', event: 'rider_arrived_at_shop', to: 'at_merchant', actors: ['courier'], says: 'Rider reached the shop' },
  { from: 'dispatch_accepted', event: 'rider_dropped', to: 'dispatch_offered', actors: ['courier', 'ops'], faultRequired: true, says: 'Rider gave it up, offering again' },
  { from: 'dispatch_accepted', event: 'customer_cancelled', to: 'refund_due', actors: ['customer', 'ops'], faultRequired: true, says: 'Cancelled while the rider was on the way' },

  // at_merchant
  { from: 'at_merchant', event: 'collected', to: 'picked_up', actors: ['courier'], says: 'Rider has the goods' },
  { from: 'at_merchant', event: 'out_of_stock', to: 'stock_problem', actors: ['merchant', 'courier', 'ops'], faultRequired: true, says: 'Something is not available' },
  { from: 'at_merchant', event: 'rider_failed_at_shop', to: 'dispatch_offered', actors: ['courier', 'ops'], faultRequired: true, says: 'Rider cannot carry on, offering again' },

  // stock_problem
  { from: 'stock_problem', event: 'substitute_accepted', to: 'at_merchant', actors: ['customer'], says: 'Customer accepted a swap' },
  { from: 'stock_problem', event: 'line_dropped', to: 'at_merchant', actors: ['customer', 'ops', 'merchant'], says: 'Item taken off the order, the rest goes' },
  { from: 'stock_problem', event: 'cancel_order', to: 'refund_due', actors: ['customer', 'ops'], faultRequired: true, says: 'Order dropped over stock' },

  // picked_up
  { from: 'picked_up', event: 'arrived', to: 'at_door', actors: ['courier'], says: 'Rider is at the address' },
  { from: 'picked_up', event: 'address_unclear', to: 'address_problem', actors: ['courier'], says: 'Rider cannot work out where to go' },
  { from: 'picked_up', event: 'rider_failed_en_route', to: 'returning', actors: ['courier', 'ops'], faultRequired: true, says: 'Rider cannot finish, goods going back' },

  // at_door
  { from: 'at_door', event: 'handed_over', to: 'delivered', actors: ['courier'], says: 'Given to the customer' },
  { from: 'at_door', event: 'nobody_there', to: 'customer_absent', actors: ['courier'], says: 'No answer at the address' },
  { from: 'at_door', event: 'wrong_address', to: 'address_problem', actors: ['courier'], says: 'This is not the right place' },
  { from: 'at_door', event: 'id_check_failed', to: 'returning', actors: ['courier'], faultRequired: true, says: 'Identity check failed, liquor or medicine cannot be handed over' },

  // address_problem
  { from: 'address_problem', event: 'address_fixed', to: 'picked_up', actors: ['customer', 'courier', 'ops'], says: 'New directions given, rider going again' },
  { from: 'address_problem', event: 'give_up', to: 'returning', actors: ['courier', 'ops'], faultRequired: true, says: 'The address could not be found' },

  // customer_absent
  { from: 'customer_absent', event: 'customer_answered', to: 'at_door', actors: ['courier', 'customer'], says: 'Customer came to the door' },
  { from: 'customer_absent', event: 'wait_expired', to: 'returning', actors: ['courier', 'ops'], faultRequired: true, says: 'Waited long enough, going back' },

  // rider_failed
  { from: 'rider_failed', event: 'reassigned', to: 'dispatch_offered', actors: ['ops'], says: 'Given to the riders again' },
  { from: 'rider_failed', event: 'cannot_recover', to: 'refund_due', actors: ['ops'], faultRequired: true, says: 'Nobody can deliver this one today' },

  // returning and returned
  { from: 'returning', event: 'back_at_merchant', to: 'returned', actors: ['courier'], says: 'Goods are back with the shop' },
  { from: 'returned', event: 'settle', to: 'refund_due', actors: ['ops', 'system'], faultRequired: true, says: 'Working out who pays' },

  // delivered
  { from: 'delivered', event: 'close', to: 'closed', actors: ['system', 'ops'], says: 'Order finished' },
  { from: 'delivered', event: 'dispute_raised', to: 'refund_due', actors: ['customer', 'ops'], faultRequired: true, says: 'Customer says something was wrong' },

  // refund_due
  { from: 'refund_due', event: 'refunded', to: 'closed', actors: ['ops', 'system'], says: 'Money returned, order finished' },
  { from: 'refund_due', event: 'no_refund_owed', to: 'closed', actors: ['ops'], faultRequired: true, says: 'Decided that nothing is owed back' },
];

export interface OrderMove {
  state: OrderState;
  fault: Fault;
  event: string;
  actor: Actor;
  at: string;
  says: string;
}

export class TransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransitionError';
  }
}

export function isTerminal(state: OrderState): boolean {
  return STATES[state].terminal;
}

export function stuckAfter(state: OrderState): number | null {
  return STATES[state].stuckAfterMinutes;
}

/** Has this order been sitting in one state longer than that state allows. */
export function isStuck(state: OrderState, sinceISO: string, nowISO?: string): boolean {
  const limit = stuckAfter(state);
  if (limit === null) return false;
  const since = Date.parse(sinceISO);
  const now = nowISO ? Date.parse(nowISO) : Date.now();
  if (Number.isNaN(since) || Number.isNaN(now)) return false;
  return now - since > limit * 60_000;
}

export function transitionsFrom(state: OrderState): Transition[] {
  return TRANSITIONS.filter((t) => t.from === state);
}

/** What this actor is allowed to do right now. Drives the buttons an app shows. */
export function allowedEvents(state: OrderState, actor?: Actor): Transition[] {
  return transitionsFrom(state).filter((t) => !actor || t.actors.includes(actor));
}

export function can(state: OrderState, event: string, actor?: Actor): boolean {
  return allowedEvents(state, actor).some((t) => t.event === event);
}

/**
 * Move the order. Throws rather than returning a wrong state, because a silent no op here is
 * exactly how an order gets stuck, which is the thing this file exists to prevent.
 */
export function apply(
  state: OrderState,
  event: string,
  opts: { actor: Actor; fault?: Fault; at?: string },
): OrderMove {
  const { actor } = opts;
  if (isTerminal(state)) {
    throw new TransitionError(`Order is ${state} and finished, ${event} cannot be applied`);
  }
  const match = transitionsFrom(state).find((t) => t.event === event);
  if (!match) {
    const open = transitionsFrom(state).map((t) => t.event).join(', ');
    throw new TransitionError(`${event} is not possible from ${state}. Possible: ${open}`);
  }
  if (!match.actors.includes(actor)) {
    throw new TransitionError(`${actor} may not do ${event} from ${state}. Allowed: ${match.actors.join(', ')}`);
  }
  if (match.faultRequired && (opts.fault === undefined || opts.fault === null)) {
    throw new TransitionError(
      `${event} needs somebody to carry the cost. Pass a fault of merchant, customer, sprint, rider or none.`,
    );
  }
  return {
    state: match.to,
    fault: match.faultRequired ? (opts.fault as Fault) : 'none',
    event,
    actor,
    at: opts.at ?? new Date().toISOString(),
    says: match.says,
  };
}

/** Guarantee 1. Non terminal states with no way out. Must always be empty. */
export function deadEnds(): OrderState[] {
  return (Object.keys(STATES) as OrderState[]).filter(
    (s) => !STATES[s].terminal && transitionsFrom(s).length === 0,
  );
}

/** Guarantee 2. States nothing can ever reach from 'placed'. Must always be empty. */
export function unreachable(): OrderState[] {
  const seen = new Set<OrderState>(['placed']);
  const queue: OrderState[] = ['placed'];
  while (queue.length) {
    const s = queue.shift() as OrderState;
    for (const t of transitionsFrom(s)) {
      if (!seen.has(t.to)) {
        seen.add(t.to);
        queue.push(t.to);
      }
    }
  }
  return (Object.keys(STATES) as OrderState[]).filter((s) => !seen.has(s));
}

/** Guarantee 3. Non terminal states with no dwell limit. Must always be empty. */
export function untimed(): OrderState[] {
  return (Object.keys(STATES) as OrderState[]).filter(
    (s) => !STATES[s].terminal && STATES[s].stuckAfterMinutes === null,
  );
}

/** Can this order still reach a terminal state from here. Must be true everywhere. */
export function canReachEnd(from: OrderState): boolean {
  const seen = new Set<OrderState>([from]);
  const queue: OrderState[] = [from];
  while (queue.length) {
    const s = queue.shift() as OrderState;
    if (STATES[s].terminal) return true;
    for (const t of transitionsFrom(s)) {
      if (!seen.has(t.to)) {
        seen.add(t.to);
        queue.push(t.to);
      }
    }
  }
  return false;
}
