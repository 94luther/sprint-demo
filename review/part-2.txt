# Sprint delivery engine, part 2 of 6

A customer facing delivery platform for Gaborone, Botswana. One app, many kinds of
shop, the way Checkers Sixty60 works: a shop has a KIND and each kind carries its
own rules. A pharmacy needs a pharmacist, a bottle store needs a licence and
trading hours, a pet shop needs neither.

TypeScript on NestJS. 271 tests passing, tsc clean.
Public copy: https://github.com/94luther/sprint-alpha-review

**This is part 2 of 6.** The engine is split so that nothing gets silently
cut. Review only what is in THIS file. If something here clearly depends on code
you cannot see, say so rather than guessing at it.

## What I want from you

Attack it. I am not looking for encouragement, I am looking for what is wrong.
In the order of what would cost me most:

1. **Money.** Can any path take a payment twice, take the wrong amount, pay a
   merchant what they are not owed, or lose a thebe to rounding? Money is whole
   integers everywhere on purpose. Tell me where that breaks.
2. **The two money models.** settlement.ts pays a merchant one hundred percent of
   the goods and gives the platform only the delivery fee. A separate ledger
   splits the same order 75 / 18 / 7. They disagree by a quarter of every basket.
   Only the first pays anybody today. Which should win, and what breaks either way?
3. **The regulator gate.** Pharmacy is blocked in code until the medicines
   regulator answers in writing. Can that be got around by seed data, by a caller,
   or by a screen? One test says it cannot. Is the test wrong?
4. **Credit and limits.** corporate.ts lets a company order on account. Can an
   account be pushed past its limit by concurrent orders, by refunds, or by a race?
5. **Anything a passing test is defending that should not exist.** A single note
   cash rule capped every order at 200 pula for weeks while thirteen tests passed
   over it.

Do not tell me the code is clean. Tell me the failure, the input that causes it,
and what it costs.

## Context that is not in the code

- No merchant has signed anything. Every shop name and price is invented.
- No payment rail is switched on. Cash and on account are the only live ones, and
  every other rail refuses by name rather than pretending to work.
- This is one person's project. There is no team and no production deployment.
- Money is thebe as whole integers. One hundred thebe is one pula.

## The 11 files in THIS part

**When you answer, tell me how many of these you actually read.**

1. `api/src/dispatch/dispatch.service.ts`
2. `api/src/main.ts`
3. `api/src/ops/ops.controller.ts`
4. `api/src/ops/ops.module.ts`
5. `api/src/ops/ops.service.ts`
6. `api/src/orders/address_passport.test.ts`
7. `api/src/orders/address_passport.ts`
8. `api/src/orders/cash.test.ts`
9. `api/src/orders/cash.ts`
10. `api/src/orders/commission.test.ts`
11. `api/src/orders/commission.ts`


---

## api/src/dispatch/dispatch.service.ts

```typescript
import { Injectable } from '@nestjs/common';
import * as h3 from 'h3-js';
import { CouriersRepo } from '../data-store/repositories/couriers.repo';
import { MerchantsRepo } from '../data-store/repositories/merchants.repo';
import { OrdersRepo } from '../data-store/repositories/orders.repo';
import { StoreService } from '../data-store/store.service';
import { TrackingGateway } from '../tracking/tracking.gateway';
import { DispatchScore, OrderRecord } from '../data-store/interfaces';

const H3_RES = 9;

// Real h3-js backed nearest-courier scoring. Lower score wins.
// score = 0.5*eta_min + 1.0*active_load + 0.2*(5 - rating) - 1.5*fairness_boost
@Injectable()
export class DispatchService {
  constructor(
    private readonly couriersRepo: CouriersRepo,
    private readonly merchantsRepo: MerchantsRepo,
    private readonly ordersRepo: OrdersRepo,
    private readonly store: StoreService,
    private readonly tracking: TrackingGateway,
  ) {}

  // Finds and scores couriers for an order, assigns the winner, emits
  // dispatch_scored, and returns the score list (order 0 is the winner).
  assign(order: OrderRecord): DispatchScore[] {
    const merchant = this.merchantsRepo.findById(order.merchant_id);
    const allCouriers = this.couriersRepo.listAll();

    const pickupCell = merchant
      ? h3.latLngToCell(merchant.lat, merchant.lng, H3_RES)
      : null;
    const ringCells = pickupCell ? new Set(h3.gridDisk(pickupCell, 3)) : null;

    const available = allCouriers.filter((c) => c.status !== 'offered' && c.status !== 'busy');
    let candidates = available;
    if (pickupCell && ringCells) {
      const inRing = available.filter((c) =>
        ringCells.has(h3.latLngToCell(c.lat, c.lng, H3_RES)),
      );
      if (inRing.length > 0) candidates = inRing;
    }
    // Safety net for the demo: never leave an order unassignable just
    // because every courier happens to be outside the 3 ring search.
    if (candidates.length === 0) candidates = allCouriers;

    const median = this.couriersRepo.medianEarningsToday();

    const scores: DispatchScore[] = candidates.map((c) => {
      const courierCell = h3.latLngToCell(c.lat, c.lng, H3_RES);
      let hexDistance = 4; // fallback ring distance if h3 cannot compute one
      if (pickupCell) {
        try {
          const d = h3.gridDistance(pickupCell, courierCell);
          if (d >= 0) hexDistance = d;
        } catch {
          // pentagon distortion or non-contiguous grid, keep the fallback
        }
      }
      const eta_min = Math.round((2 + hexDistance * 1.5) * 10) / 10;
      const active_load = this.ordersRepo.listActiveForCourier(c.id).length;
      const rating_gap = Math.round((5 - c.rating) * 10) / 10;
      const fairness_boost = c.earnings_today_bwp < median ? 1 : 0;
      const score =
        0.5 * eta_min + 1.0 * active_load + 0.2 * rating_gap - 1.5 * fairness_boost;

      return {
        courier_id: c.id,
        courier_name: c.name,
        score: Math.round(score * 1000) / 1000,
        components: { eta_min, active_load, rating_gap, fairness_boost },
      };
    });

    scores.sort((a, b) => a.score - b.score);

    const winner = scores[0];
    if (winner) {
      this.ordersRepo.update(order.id, {
        courier_id: winner.courier_id,
        eta_min: Math.round(winner.components.eta_min),
      });
      this.couriersRepo.update(winner.courier_id, { status: 'offered' });
    }

    this.store.state.last_dispatch = { order_id: order.id, scores };
    this.store.persist();
    this.tracking.emitDispatchScored(order.id, scores);
    return scores;
  }
}
```

---

## api/src/main.ts

```typescript
// Load .env before anything else is required, so every module that reads
// process.env at import time (the tracking gateway's CORS origin, the aes
// helper's key, JWT secret) sees the real values. A plain require() runs
// exactly where it is written; an `import` above it would not.
require('dotenv').config();

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { cors: false });

  const webOrigin = process.env.WEB_ORIGIN || 'http://localhost:5173';
  app.enableCors({
    origin: webOrigin,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    credentials: true,
  });

  app.useWebSocketAdapter(new IoAdapter(app));

  const httpAdapter = app.getHttpAdapter().getInstance();
  if (typeof httpAdapter.disable === 'function') {
    httpAdapter.disable('x-powered-by');
  }

  app.use((req: any, res: any, next: any) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Sprint alpha API is up on http://localhost:${port}, socket namespace /rt, web origin ${webOrigin}.`);
}

bootstrap();
```

---

## api/src/ops/ops.controller.ts

```typescript
import { Controller, ForbiddenException, Get, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { OpsService } from './ops.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';

@Controller('ops')
export class OpsController {
  constructor(private readonly opsService: OpsService) {}

  // Live order and courier positions, earnings, and dispatch scoring
  // internals are ops-only, not just anything a valid token can see.
  @Get('state')
  @UseGuards(JwtAuthGuard)
  getState(@Req() req: Request) {
    const user = (req as any).user as { role: string };
    if (user.role !== 'ops') {
      throw new ForbiddenException('This view is for ops staff only.');
    }
    return this.opsService.getState();
  }
}
```

---

## api/src/ops/ops.module.ts

```typescript
import { Module } from '@nestjs/common';
import { OpsController } from './ops.controller';
import { OpsService } from './ops.service';

@Module({
  controllers: [OpsController],
  providers: [OpsService],
})
export class OpsModule {}
```

---

## api/src/ops/ops.service.ts

```typescript
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
```

---

## api/src/orders/address_passport.test.ts

```typescript
/**
 * Brick 16's proof. Run with:
 *   npm --prefix api run test:orders
 *
 * The tests that matter most are the last three. They prove the rider is never handed anything
 * beyond what finds the door, and that an identity number cannot be written into an address.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  create,
  confirmAtDoor,
  correctAtDoor,
  markNotFound,
  repair,
  chooseFor,
  needsAttention,
  isUsable,
  forRider,
  summary,
  isExpired,
  rejectIdentityNumbers,
  PassportError,
  DOUBT_AFTER_FAILURES,
  AddressPassport,
} from './address_passport';

const base = (over: Partial<Parameters<typeof create>[0]> = {}) =>
  create({
    id: 'p1',
    customer_id: 'c1',
    label: 'Home',
    plot: 'Plot 2147, Block 8',
    landmark: 'Blue gate opposite ABC Hardware',
    access: 'Ask for the gate to be opened',
    at: '2026-09-01T08:00:00.000Z',
    ...over,
  });

test('a new address is not trusted until somebody has been there', () => {
  const p = base();
  assert.equal(p.confidence, 'typed');
  assert.equal(p.confirmed_by, null);
  assert.equal(forRider(p).trusted, false);
  assert.match(forRider(p).says, /confirm it at the door/);
});

test('an address needs at least a plot or a landmark', () => {
  assert.throws(() => base({ plot: '   ', landmark: '' }), PassportError);
  assert.doesNotThrow(() => base({ plot: '', landmark: 'The green roof past the school' }));
});

test('the rider at the door is the only one who can make an address trusted', () => {
  const p = confirmAtDoor(base(), 'courier_7', '2026-09-02T10:00:00.000Z');
  assert.equal(p.confidence, 'rider_confirmed');
  assert.equal(p.confirmed_by, 'courier_7');
  assert.equal(p.times_used, 1);
  assert.equal(forRider(p).trusted, true);
  assert.throws(() => confirmAtDoor(base(), ''), /name the rider/);
});

test('a rider correcting the address counts as confirming it', () => {
  const p = correctAtDoor(base(), 'courier_7', { landmark: 'Red gate, the hardware shop moved' });
  assert.equal(p.landmark, 'Red gate, the hardware shop moved');
  assert.equal(p.confidence, 'rider_confirmed');
  assert.equal(p.confirmed_by, 'courier_7');
});

test('a correction may not empty the address', () => {
  assert.throws(() => correctAtDoor(base(), 'courier_7', { plot: '', landmark: '' }), /no plot and no landmark/);
});

test('one failure is bad luck, two means the address stops being used', () => {
  let p = confirmAtDoor(base(), 'courier_7');
  p = markNotFound(p);
  assert.equal(p.failed_finds, 1);
  assert.equal(isUsable(p), true, 'one miss should not condemn an address');
  p = markNotFound(p);
  assert.equal(p.failed_finds, DOUBT_AFTER_FAILURES);
  assert.equal(p.confidence, 'doubted');
  assert.equal(isUsable(p), false);
  assert.equal(p.confirmed_by, null, 'an old confirmation does not survive being unfindable');
  assert.equal(needsAttention(p), true);
});

test('a doubted address only comes back when something actually changed', () => {
  let p = markNotFound(markNotFound(base()));
  assert.throws(() => repair(p, { plot: 'Plot 2147, Block 8' }), /Nothing was changed/);
  p = repair(p, { plot: 'Plot 2174, Block 8' });
  assert.equal(p.confidence, 'typed');
  assert.equal(p.failed_finds, 0);
  assert.equal(isUsable(p), true);
});

test('a confirmed address beats a typed one when the app picks for a customer', () => {
  const typed = base({ id: 'a' });
  const confirmed = confirmAtDoor(base({ id: 'b', label: 'Office' }), 'courier_7', '2026-09-03T09:00:00.000Z');
  const chosen = chooseFor('c1', [typed, confirmed]);
  assert.equal(chosen?.id, 'b');
});

test('a doubted address is never offered silently', () => {
  const doubted = markNotFound(markNotFound(confirmAtDoor(base({ id: 'a' }), 'c7')));
  const typed = base({ id: 'b' });
  assert.equal(chooseFor('c1', [doubted, typed])?.id, 'b');
  assert.equal(chooseFor('c1', [doubted])?.id, undefined);
});

test('one customer never sees another customer address', () => {
  const mine = base({ id: 'a', customer_id: 'c1' });
  const theirs = confirmAtDoor(base({ id: 'b', customer_id: 'c2' }), 'c7');
  assert.equal(chooseFor('c1', [mine, theirs])?.id, 'a');
  assert.equal(chooseFor('c3', [mine, theirs]), null);
});

test('the most recently used confirmed address wins', () => {
  const older = confirmAtDoor(base({ id: 'a' }), 'c7', '2026-09-01T09:00:00.000Z');
  const newer = confirmAtDoor(base({ id: 'b' }), 'c8', '2026-09-05T09:00:00.000Z');
  assert.equal(chooseFor('c1', [older, newer])?.id, 'b');
});

test('an address nobody has used in two years is dropped', () => {
  const p = base({ at: '2024-01-01T00:00:00.000Z' });
  assert.equal(isExpired(p, '2026-09-12T00:00:00.000Z'), true);
  const fresh = confirmAtDoor(base(), 'c7', '2026-08-01T00:00:00.000Z');
  assert.equal(isExpired(fresh, '2026-09-12T00:00:00.000Z'), false);
});

test('the rider is handed only what finds the door', () => {
  const p = confirmAtDoor(base(), 'courier_7');
  const seen = forRider(p);
  assert.deepEqual(Object.keys(seen).sort(), ['access', 'landmark', 'plot', 'says', 'trusted']);
  const asText = JSON.stringify(seen);
  for (const leaked of ['customer_id', 'c1', 'confirmed_by', 'times_used', 'failed_finds', 'label']) {
    assert.equal(asText.includes(leaked), false, `the rider view leaks ${leaked}`);
  }
});

test('an identity number cannot be written into an address', () => {
  assert.throws(() => base({ access: 'Ask for Omang 123456789' }), /identity number/);
  assert.throws(() => base({ access: 'ID 12345 6789 at the gate' }), /identity number/);
  assert.throws(() => base({ landmark: 'Gate code 987654321' }), /identity number/);
  assert.throws(
    () => correctAtDoor(base(), 'c7', { access: 'his omang is 456123789' }),
    /identity number/,
  );
  assert.doesNotThrow(() => base({ access: 'Gate code 4417, ring twice' }));
  assert.doesNotThrow(() => base({ plot: 'Plot 123456789' }), 'a plot number is not an access note');
});

test('rejectIdentityNumbers names the field so the message is useful', () => {
  assert.throws(() => rejectIdentityNumbers('112233445', 'The access note'), /The access note/);
});

test('the summary reads like a person wrote it', () => {
  const p: AddressPassport = confirmAtDoor(base(), 'courier_7');
  assert.equal(summary(p), 'Home: Plot 2147, Block 8, Blue gate opposite ABC Hardware (confirmed)');
  assert.equal(summary(base()).includes('not yet confirmed'), true);
  for (const s of [summary(p), forRider(p).says]) {
    assert.equal(s.includes(' - '), false, 'no dashes in text a person reads');
  }
});
```

---

## api/src/orders/address_passport.ts

```typescript
/**
 * Brick 16. The Address Passport.
 *
 * Gaborone is not laid out on a street grid that a map can follow to a door. People navigate by
 * plot number, by block, and by what is visible from the road. Both council seats, independently,
 * named address capture as the thing that decides whether deliveries work here.
 *
 * Today the plot, landmark and access note live in the customer's browser and nowhere else. They
 * are lost when they change phone, they are invisible to the rider, and nobody ever finds out
 * whether they were any good. This file makes an address something that gets BETTER each time
 * somebody goes there.
 *
 * The idea in one line: the customer types an address, the rider who actually finds the door
 * confirms or corrects it, and from then on it is trusted.
 *
 * Two rules come from the data protection assessment and are enforced here rather than trusted:
 *   * The rider is shown only what is needed to find the door. Never the order contents, never
 *     a medicine name, never a note about the customer.
 *   * No identity number may be written into an access note. A nine digit run is refused.
 */

export type Confidence =
  /** The customer typed it. Nobody has been there yet. */
  | 'typed'
  /** A rider found the door using this and said so, standing at it. */
  | 'rider_confirmed'
  /** Riders have failed to find it more than once. It must be fixed before it is used again. */
  | 'doubted';

export interface AddressPassport {
  id: string;
  customer_id: string;
  /** What the customer calls it. Home, the shop, my mother's place. */
  label: string;
  /** Plot and block, as people here actually say it. */
  plot: string;
  /** What you can see from the road. The thing that actually finds the door. */
  landmark: string;
  /** Gate code, which gate, dogs, ask for whom. Never an identity number. */
  access: string;
  confidence: Confidence;
  confirmed_by: string | null;
  confirmed_at: string | null;
  times_used: number;
  last_used_at: string | null;
  failed_finds: number;
  created_at: string;
  updated_at: string;
}

export class PassportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PassportError';
  }
}

/** Two failures is the point at which an address stops being trusted. */
export const DOUBT_AFTER_FAILURES = 2;

/** A passport nobody has used in this long is dropped, per the retention table in the DPIA. */
export const RETENTION_DAYS = 730;

// Named for what it DETECTS, not what it stores. Nothing here ever holds an identity number.
const LOOKS_LIKE_AN_ID = /\d{9,}/;

/**
 * An access note is free text, which is exactly where an identity number ends up when a rider is
 * in a hurry. Refuse it at the door rather than discovering it in a breach.
 */
export function rejectIdentityNumbers(text: string, field: string): void {
  if (LOOKS_LIKE_AN_ID.test(text.replace(/[\s-]/g, ''))) {
    throw new PassportError(
      `${field} looks like it contains an identity number. Addresses never need one.`,
    );
  }
}

function clean(s: string): string {
  return (s ?? '').trim().replace(/\s+/g, ' ');
}

export function create(input: {
  id: string;
  customer_id: string;
  label: string;
  plot: string;
  landmark: string;
  access?: string;
  at?: string;
}): AddressPassport {
  const plot = clean(input.plot);
  const landmark = clean(input.landmark);
  const access = clean(input.access ?? '');
  if (!plot && !landmark) {
    throw new PassportError('An address needs at least a plot or a landmark. Neither was given.');
  }
  rejectIdentityNumbers(access, 'The access note');
  rejectIdentityNumbers(landmark, 'The landmark');
  const at = input.at ?? new Date().toISOString();
  return {
    id: input.id,
    customer_id: input.customer_id,
    label: clean(input.label) || 'Home',
    plot,
    landmark,
    access,
    confidence: 'typed',
    confirmed_by: null,
    confirmed_at: null,
    times_used: 0,
    last_used_at: null,
    failed_finds: 0,
    created_at: at,
    updated_at: at,
  };
}

/**
 * The rider is at the door and it was right. This is the only way a passport becomes trusted,
 * and it can only be done by somebody who was actually there.
 */
export function confirmAtDoor(p: AddressPassport, courierId: string, at?: string): AddressPassport {
  if (!courierId) throw new PassportError('A confirmation must name the rider who made it.');
  const now = at ?? new Date().toISOString();
  return {
    ...p,
    confidence: 'rider_confirmed',
    confirmed_by: courierId,
    confirmed_at: now,
    failed_finds: 0,
    times_used: p.times_used + 1,
    last_used_at: now,
    updated_at: now,
  };
}

/**
 * The rider found the door, but not with what was written. They fix it standing there, which is
 * the only moment anybody knows the truth, and the correction counts as a confirmation.
 */
export function correctAtDoor(
  p: AddressPassport,
  courierId: string,
  fix: { plot?: string; landmark?: string; access?: string },
  at?: string,
): AddressPassport {
  if (!courierId) throw new PassportError('A correction must name the rider who made it.');
  const plot = fix.plot === undefined ? p.plot : clean(fix.plot);
  const landmark = fix.landmark === undefined ? p.landmark : clean(fix.landmark);
  const access = fix.access === undefined ? p.access : clean(fix.access);
  if (!plot && !landmark) {
    throw new PassportError('A correction cannot leave the address with no plot and no landmark.');
  }
  rejectIdentityNumbers(access, 'The access note');
  rejectIdentityNumbers(landmark, 'The landmark');
  const now = at ?? new Date().toISOString();
  return {
    ...p,
    plot,
    landmark,
    access,
    confidence: 'rider_confirmed',
    confirmed_by: courierId,
    confirmed_at: now,
    failed_finds: 0,
    times_used: p.times_used + 1,
    last_used_at: now,
    updated_at: now,
  };
}

/**
 * The rider could not find it. Once is bad luck. Twice means the address is wrong and the
 * customer has to fix it before anybody is sent there again.
 */
export function markNotFound(p: AddressPassport, at?: string): AddressPassport {
  const now = at ?? new Date().toISOString();
  const failed = p.failed_finds + 1;
  return {
    ...p,
    failed_finds: failed,
    confidence: failed >= DOUBT_AFTER_FAILURES ? 'doubted' : p.confidence,
    confirmed_by: failed >= DOUBT_AFTER_FAILURES ? null : p.confirmed_by,
    confirmed_at: failed >= DOUBT_AFTER_FAILURES ? null : p.confirmed_at,
    updated_at: now,
  };
}

/** A doubted address may only come back when a person has actually changed something. */
export function repair(
  p: AddressPassport,
  fix: { plot?: string; landmark?: string; access?: string },
  at?: string,
): AddressPassport {
  const plot = fix.plot === undefined ? p.plot : clean(fix.plot);
  const landmark = fix.landmark === undefined ? p.landmark : clean(fix.landmark);
  const access = fix.access === undefined ? p.access : clean(fix.access);
  if (plot === p.plot && landmark === p.landmark && access === p.access) {
    throw new PassportError('Nothing was changed, so this address is still the one nobody could find.');
  }
  rejectIdentityNumbers(access, 'The access note');
  rejectIdentityNumbers(landmark, 'The landmark');
  const now = at ?? new Date().toISOString();
  return { ...p, plot, landmark, access, confidence: 'typed', failed_finds: 0, updated_at: now };
}

export function isUsable(p: AddressPassport): boolean {
  return p.confidence !== 'doubted';
}

/**
 * Which address to put in front of a customer starting an order. A rider confirmed address that
 * was used recently beats a typed one every time, and a doubted one is never offered silently.
 */
export function chooseFor(customerId: string, all: AddressPassport[]): AddressPassport | null {
  const mine = all.filter((p) => p.customer_id === customerId && isUsable(p));
  if (!mine.length) return null;
  const rank = (p: AddressPassport) => (p.confidence === 'rider_confirmed' ? 1 : 0);
  const when = (p: AddressPassport) => (p.last_used_at ? Date.parse(p.last_used_at) : 0);
  return [...mine].sort((a, b) => rank(b) - rank(a) || when(b) - when(a) || b.times_used - a.times_used)[0];
}

/** Should the app ask the customer to check this before the order goes out. */
export function needsAttention(p: AddressPassport): boolean {
  return p.confidence === 'doubted' || (p.confidence === 'typed' && p.failed_finds > 0);
}

/**
 * Exactly what the rider's phone is given. Nothing else. The order contents, the customer's other
 * addresses and anything clinical stay out of this object by construction, not by discipline.
 */
export function forRider(p: AddressPassport): {
  plot: string;
  landmark: string;
  access: string;
  trusted: boolean;
  says: string;
} {
  return {
    plot: p.plot,
    landmark: p.landmark,
    access: p.access,
    trusted: p.confidence === 'rider_confirmed',
    says:
      p.confidence === 'rider_confirmed'
        ? 'A rider has been here before and confirmed this'
        : p.confidence === 'doubted'
          ? 'This address has not been found before, call ahead'
          : 'Nobody has been here yet, confirm it at the door',
  };
}

/** One line for the ops board and the customer's list. */
export function summary(p: AddressPassport): string {
  const bits = [p.plot, p.landmark].filter(Boolean).join(', ');
  const mark = p.confidence === 'rider_confirmed' ? 'confirmed' : p.confidence === 'doubted' ? 'not found before' : 'not yet confirmed';
  return `${p.label}: ${bits} (${mark})`;
}

/** Retention, from the data protection assessment. */
export function isExpired(p: AddressPassport, nowISO?: string): boolean {
  const last = p.last_used_at ?? p.created_at;
  const now = nowISO ? Date.parse(nowISO) : Date.now();
  return now - Date.parse(last) > RETENTION_DAYS * 86_400_000;
}
```

---

## api/src/orders/cash.test.ts

```typescript
/**
 * Brick 18's cash half. Run with:
 *   npm --prefix api run test:orders
 *
 * The reconciliation tests are the ones that matter. Until that number exists nobody can say what
 * cash costs Sprint, and the director question about what leaks unbilled has no answer.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cashAllowed,
  changeFor,
  floatFor,
  reconcile,
  needsCashPhoto,
  pula,
  CashError,
  CASH_CAP_THEBE,
  FLOAT_SIGNOFF_THEBE,
  WRITE_OFF_THEBE,
  notesFor,
  canBeHandedOver,
  tendersFor,
  saysNotes,
  NOTES,
} from './cash';

const P = (n: number) => n * 100; // pula to thebe

test('money is counted in whole thebe, never in a decimal that can drift', () => {
  assert.equal(pula(8750), 'P87.50');
  assert.throws(() => cashAllowed(87.5), /whole number of thebe/);
  assert.throws(() => reconcile(0, [], 12.5), /whole number of thebe/);
});

test('a big order cannot be paid in cash, because a rider carrying that much is a target', () => {
  assert.equal(cashAllowed(P(500)).allowed, true);
  assert.equal(cashAllowed(CASH_CAP_THEBE).allowed, true, 'the cap itself is still allowed');
  const over = cashAllowed(CASH_CAP_THEBE + 1);
  assert.equal(over.allowed, false);
  assert.match(over.says, /cannot be paid in cash/);
  assert.throws(() => changeFor(CASH_CAP_THEBE + 1, P(100)), CashError);
});

test('the rider is told exactly what change to bring', () => {
  const c = changeFor(P(87), P(100));
  assert.equal(c.change, P(13));
  assert.match(c.says, /bring P13.00 change/);
  assert.equal(changeFor(P(100), P(100)).change, 0);
  assert.match(changeFor(P(100), P(100)).says, /No change needed/);
});

test('a note that does not cover the order is refused before the rider leaves', () => {
  assert.throws(() => changeFor(P(87), P(50)), /does not cover/);
  /* Still refused, with the wording the contract now uses: no combination of
     Botswana notes makes P75, so there is no sense pretending at the door. */
  assert.throws(() => changeFor(P(87), P(75)), /cannot hand|not an amount anyone can hand over/,
    'no set of notes makes P75');
  /* Changed 15 Sep 2026 with the contract. This used to assert that P500 was
     refused because Botswana has no P500 note. That is true about notes and wrong
     about tenders: a customer hands over two P200s and a P100. Refusing it capped
     every cash order at P200 and made cash useless for a normal basket. */
  assert.equal(changeFor(P(87), P(500)).change, P(413));
  assert.equal(changeFor(P(87), P(500)).handingOver, '2 x P200.00 and a P100.00');
});

test('the float is worked out from the orders actually on the run, not from habit', () => {
  const orders = [
    { order_id: 'o1', total: P(87), paying_with: P(100) },
    { order_id: 'o2', total: P(136), paying_with: P(200) },
    { order_id: 'o3', total: P(150), paying_with: P(200) },
  ];
  const f = floatFor(orders);
  assert.equal(f.float, P(13) + P(64) + P(50));
  assert.deepEqual(f.per_order.map((p) => p.order_id), ['o1', 'o2', 'o3']);
});

test('a big float needs a supervisor to sign for it', () => {
  const small = floatFor([{ order_id: 'o1', total: P(87), paying_with: P(100) }]);
  assert.equal(small.needs_signoff, false);
  const big = floatFor([
    { order_id: 'o1', total: P(10), paying_with: P(200) },
    { order_id: 'o2', total: P(10), paying_with: P(200) },
    { order_id: 'o3', total: P(10), paying_with: P(200) },
  ]);
  assert.ok(big.float > FLOAT_SIGNOFF_THEBE);
  assert.equal(big.needs_signoff, true);
  assert.match(big.says, /supervisor/);
});

test('a shift that balances says so plainly', () => {
  const orders = [
    { order_id: 'o1', total: P(87), paying_with: P(100) },
    { order_id: 'o2', total: P(136), paying_with: P(200) },
  ];
  const floatOut = floatFor(orders).float;
  // Everything collected, correct change given out, nothing lost.
  const expected = floatOut + P(300) - (P(13) + P(64));
  const r = reconcile(floatOut, orders, expected);
  assert.equal(r.difference, 0);
  assert.equal(r.says, 'Balanced exactly');
});

test('a small difference is written off rather than argued over', () => {
  const orders = [{ order_id: 'o1', total: P(87), paying_with: P(100) }];
  const floatOut = floatFor(orders).float;
  const expected = floatOut + P(100) - P(13);
  const r = reconcile(floatOut, orders, expected - WRITE_OFF_THEBE);
  assert.equal(r.within_write_off, true);
  assert.equal(r.short, true);
  assert.match(r.says, /inside the write off, closed/);
});

test('a real shortfall is named, not absorbed', () => {
  const orders = [{ order_id: 'o1', total: P(87), paying_with: P(100) }];
  const floatOut = floatFor(orders).float;
  const expected = floatOut + P(100) - P(13);
  const r = reconcile(floatOut, orders, expected - P(50));
  assert.equal(r.within_write_off, false);
  assert.equal(r.difference, -P(50));
  assert.match(r.says, /SHORT/);
  assert.match(r.says, /needs a person to look at it/);
});

test('too much money is a problem too, not a bonus', () => {
  const orders = [{ order_id: 'o1', total: P(87), paying_with: P(100) }];
  const floatOut = floatFor(orders).float;
  const expected = floatOut + P(100) - P(13);
  const r = reconcile(floatOut, orders, expected + P(20));
  assert.equal(r.short, false);
  assert.match(r.says, /OVER/);
  assert.match(r.says, /needs a person/);
});

test('the expected figure is arithmetic anyone can check by hand', () => {
  const orders = [{ order_id: 'o1', total: P(87), paying_with: P(100) }];
  const r = reconcile(P(13), orders, 0);
  // float out P13, collected P100, change given P13, so P100 should be in the bag
  assert.equal(r.expected, P(13) + P(100) - P(13));
  assert.equal(r.expected, P(100));
});

test('a cash handover over two hundred pula needs a photograph', () => {
  assert.equal(needsCashPhoto(P(199)), false);
  assert.equal(needsCashPhoto(P(200)), true);
  assert.equal(needsCashPhoto(P(200)), true);
});

test('every line a person reads is plain and has no dashes', () => {
  const lines = [
    cashAllowed(P(50)).says,
    cashAllowed(P(2000)).says,
    changeFor(P(87), P(100)).says,
    floatFor([{ order_id: 'o1', total: P(87), paying_with: P(100) }]).says,
    reconcile(P(13), [{ order_id: 'o1', total: P(87), paying_with: P(100) }], P(100)).says,
  ];
  for (const l of lines) {
    assert.ok(l.length > 8, 'a message should say something');
    assert.equal(l.includes(' - '), false, `dash in: ${l}`);
  }
});

/* ---------------------------------------------------------------------------
   People hand over more than one note. Added 15 September 2026 after driving
   the checkout turned up a P223 hardware basket that could not be paid in cash
   at all: the engine offered P200, the largest note in Botswana, then refused
   it for not covering the total. Every cash order above P200 was unpayable.
   --------------------------------------------------------------------------- */

test('THE CEILING: an order over P200 can now be paid, because people hand over more than one note', () => {
  const c = changeFor(P(223), P(250));
  assert.equal(c.change, P(27));
  assert.equal(c.handingOver, 'a P200.00 and a P50.00');
});

test('the notes a person actually hands over are named, biggest first', () => {
  assert.deepEqual(notesFor(P(250)), [P(200), P(50)]);
  assert.deepEqual(notesFor(P(380)), [P(200), P(100), P(50), P(20), P(10)]);
  assert.deepEqual(notesFor(P(10)), [P(10)]);
  assert.deepEqual(notesFor(0), []);
});

test('an amount no set of notes can make is still refused, before the rider leaves', () => {
  assert.equal(notesFor(P(75)), null, 'nothing makes P75');
  assert.equal(notesFor(P(5)), null, 'the smallest note is P10');
  assert.equal(canBeHandedOver(P(75)), false);
  assert.equal(canBeHandedOver(P(250)), true);
});

test('the tenders offered always cover the total, which is what the old list failed to do', () => {
  for (const total of [P(9), P(65), P(189), P(223), P(407), P(950)]) {
    const offers = tendersFor(total);
    assert.ok(offers.length > 0, 'nothing offered for ' + pula(total));
    for (const o of offers) {
      assert.ok(o >= total, pula(o) + ' does not cover ' + pula(total));
      assert.ok(canBeHandedOver(o), pula(o) + ' cannot be handed over');
      assert.doesNotThrow(() => changeFor(total, o));
    }
  }
});

test('the least a customer can hand over is offered first, so change stays small', () => {
  assert.equal(tendersFor(P(223))[0], P(230));
  assert.equal(tendersFor(P(189))[0], P(190));
});

test('the P1000 cap is untouched: it is a security rule, not arithmetic', () => {
  assert.deepEqual(tendersFor(CASH_CAP_THEBE + 1), [], 'over the cap nothing is offered');
  assert.throws(() => changeFor(CASH_CAP_THEBE + 1, P(1000)), CashError);
  for (const o of tendersFor(P(950))) assert.ok(o <= CASH_CAP_THEBE);
});

test('there is still no P500 note, and P500 is still payable', () => {
  assert.equal(NOTES.includes(P(500) as never), false);
  assert.equal(saysNotes(P(500)), '2 x P200.00 and a P100.00');
});
```

---

## api/src/orders/cash.ts

```typescript
/**
 * Brick 18, the cash half. CashSure.
 *
 * Cash is most of this market and it is where the money leaks. The industry figure for cash
 * reconciliation loss is one and a half to three percent of revenue, and Sprint has never measured
 * its own. The director question "what is leaking unbilled" has no answer today, and it cannot have
 * one until every cash order is counted against what the rider actually carried.
 *
 * Four things make that possible, and none of them needs a payment provider to answer first:
 *
 *   1. A CAP. Above a certain order value, cash is simply not offered. A rider carrying eight
 *      hundred pula of other people's change is a target, and a loss nobody can prove.
 *   2. THE NOTE THE CUSTOMER WILL PAY WITH, asked at checkout, so the rider leaves with the right
 *      change instead of standing at a gate unable to complete the sale.
 *   3. A FLOAT worked out from the orders actually assigned, not a habit.
 *   4. A COUNT at the end of the shift, against what the orders say should be there, with the
 *      difference named rather than absorbed.
 *
 * Every amount here is in thebe, the smallest unit, because money held in a decimal is money that
 * quietly disappears in rounding. One pula is 100 thebe.
 */

/**
 * Botswana notes in circulation, in thebe, biggest first. P200, P100, P50, P20, P10.
 * There is no P500 note, which is worth knowing before somebody builds a screen offering one.
 * Coins are ignored: nobody pays a courier in coins.
 */
export const NOTES = [20000, 10000, 5000, 2000, 1000] as const;
export const THEBE = 100;

/** Above this, cash is not offered. A rider should never carry more change than this implies. */
export const CASH_CAP_THEBE = 100000; // P1000

/** A shift float above this needs a supervisor to hand it out and sign for it. */
export const FLOAT_SIGNOFF_THEBE = 50000; // P500

/** Under this, a shortfall at count up is written off rather than argued. Finance may change it. */
export const WRITE_OFF_THEBE = 500; // P5

export class CashError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CashError';
  }
}

export function pula(thebe: number): string {
  return `P${(thebe / THEBE).toFixed(2)}`;
}

/** May this order be paid in cash at all. */
export function cashAllowed(totalThebe: number): { allowed: boolean; says: string } {
  if (!Number.isInteger(totalThebe) || totalThebe <= 0) {
    throw new CashError('An order total must be a whole number of thebe before cash can be offered.');
  }
  if (totalThebe > CASH_CAP_THEBE) {
    return {
      allowed: false,
      says: `Orders over ${pula(CASH_CAP_THEBE)} cannot be paid in cash. Please choose another way to pay.`,
    };
  }
  return { allowed: true, says: 'You can pay the rider in cash' };
}

/** The notes a customer could sensibly hand over for this total, biggest first. */
export function payableWith(totalThebe: number): number[] {
  return NOTES.filter((n) => n >= totalThebe || n >= smallestCovering(totalThebe));
}

function smallestCovering(totalThebe: number): number {
  const fits = NOTES.filter((n) => n >= totalThebe);
  return fits.length ? Math.min(...fits) : Math.max(...NOTES);
}

/**
 * What the rider must carry for this order. Asked at checkout, because a rider who arrives without
 * change either loses the sale or rounds it in somebody's favour, and both are a leak.
 */
/**
 * The notes a customer would actually hand over to make exactly this amount,
 * biggest first. Null when no combination of Botswana notes makes it.
 *
 * Every note is a multiple of P10 and P10 itself is a note, so an amount is
 * payable exactly when it is a whole number of P10 and at least P10. Greedy is
 * correct here: 200, 100, 50, 20, 10 is a canonical set, so taking the biggest
 * note that fits never paints you into a corner.
 */
export function notesFor(amountThebe: number): number[] | null {
  if (!Number.isInteger(amountThebe) || amountThebe < 0) return null;
  if (amountThebe === 0) return [];
  const smallest = Math.min(...NOTES);
  if (amountThebe % smallest !== 0) return null;
  const out: number[] = [];
  let left = amountThebe;
  for (const n of [...NOTES].sort((a, b) => b - a)) {
    while (left >= n) {
      out.push(n);
      left -= n;
    }
  }
  return left === 0 ? out : null;
}

/** Can a person physically hand this over? */
export function canBeHandedOver(amountThebe: number): boolean {
  return notesFor(amountThebe) !== null;
}

/** 'two P200s and a P100', for a screen or a rider to read. */
export function saysNotes(amountThebe: number): string {
  const ns = notesFor(amountThebe);
  if (!ns || ns.length === 0) return 'nothing';
  const counted = new Map<number, number>();
  for (const n of ns) counted.set(n, (counted.get(n) ?? 0) + 1);
  const parts = [...counted.entries()].map(([note, times]) =>
    times === 1 ? 'a ' + pula(note) : times + ' x ' + pula(note),
  );
  if (parts.length === 1) return parts[0];
  return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
}

/**
 * Three amounts a customer might realistically hand over for this total: the
 * least they can assemble that covers it, and two rounder amounts above it.
 * This replaces the old single note list, which could not cover anything over
 * P200 and so made cash unusable for a normal hardware or grocery basket.
 */
export function tendersFor(totalThebe: number): number[] {
  const check = cashAllowed(totalThebe);
  if (!check.allowed) return [];
  const smallest = Math.min(...NOTES);
  const least = Math.ceil(totalThebe / smallest) * smallest;
  const out = new Set<number>();
  if (canBeHandedOver(least)) out.add(least);
  for (const step of [5000, 10000, 20000]) {
    const rounded = Math.ceil(totalThebe / step) * step;
    if (rounded !== least && canBeHandedOver(rounded) && rounded <= CASH_CAP_THEBE) {
      out.add(rounded);
    }
  }
  return [...out].sort((a, b) => a - b).slice(0, 3);
}

export function changeFor(totalThebe: number, payingWithThebe: number): {
  change: number;
  says: string;
  riderNeeds: number;
  /** what the customer physically hands the rider, for the screen and the run sheet */
  handingOver: string;
} {
  const check = cashAllowed(totalThebe);
  if (!check.allowed) throw new CashError(check.says);
  /* Anything a customer can actually assemble from notes. It used to be a single
     note, which capped every cash order at P200 and made cash useless for a normal
     basket. P500 is fine, handed over as two P200s and a P100. P75 is not, because
     no combination of Botswana notes makes it. */
  if (!canBeHandedOver(payingWithThebe)) {
    throw new CashError(
      `${pula(payingWithThebe)} is not an amount anyone can hand over. The smallest note is ${pula(Math.min(...NOTES))}.`,
    );
  }
  if (payingWithThebe < totalThebe) {
    throw new CashError(
      `${pula(payingWithThebe)} does not cover ${pula(totalThebe)}. Hand over more.`,
    );
  }
  const change = payingWithThebe - totalThebe;
  return {
    change,
    riderNeeds: change,
    says: change === 0
      ? 'No change needed, the customer has it exactly'
      : `Your rider will bring ${pula(change)} change`,
    handingOver: saysNotes(payingWithThebe),
  };
}

export interface CashOrder {
  order_id: string;
  total: number;
  paying_with: number;
}

/** What a rider must leave the branch with, given the cash orders actually on their run. */
export function floatFor(orders: CashOrder[]): {
  float: number;
  needs_signoff: boolean;
  says: string;
  per_order: Array<{ order_id: string; change: number }>;
} {
  const per_order = orders.map((o) => ({
    order_id: o.order_id,
    change: changeFor(o.total, o.paying_with).change,
  }));
  const float = per_order.reduce((a, b) => a + b.change, 0);
  const needs_signoff = float > FLOAT_SIGNOFF_THEBE;
  return {
    float,
    needs_signoff,
    per_order,
    says: needs_signoff
      ? `${pula(float)} float, which needs a supervisor to hand it over and sign`
      : `${pula(float)} float for ${orders.length} cash order${orders.length === 1 ? '' : 's'}`,
  };
}

export interface Reconciliation {
  expected: number;
  counted: number;
  difference: number;
  /** Positive means the rider has more than they should, negative means short. */
  short: boolean;
  within_write_off: boolean;
  says: string;
}

/**
 * End of shift. What the orders say should be in the bag, against what is actually in it.
 * This is the number that has never been measured, and the only way the leak becomes visible.
 */
export function reconcile(
  floatOut: number,
  orders: CashOrder[],
  countedIn: number,
): Reconciliation {
  if (!Number.isInteger(countedIn) || countedIn < 0) {
    throw new CashError('The counted amount must be a whole number of thebe. Count it again.');
  }
  const collected = orders.reduce((a, o) => a + o.paying_with, 0);
  const givenOut = orders.reduce((a, o) => a + changeFor(o.total, o.paying_with).change, 0);
  const expected = floatOut + collected - givenOut;
  const difference = countedIn - expected;
  const within = Math.abs(difference) <= WRITE_OFF_THEBE;
  return {
    expected,
    counted: countedIn,
    difference,
    short: difference < 0,
    within_write_off: within,
    says:
      difference === 0
        ? 'Balanced exactly'
        : within
          ? `${pula(Math.abs(difference))} ${difference < 0 ? 'short' : 'over'}, inside the write off, closed`
          : `${pula(Math.abs(difference))} ${difference < 0 ? 'SHORT' : 'OVER'}, this one needs a person to look at it`,
  };
}

/** The photograph rule, so a disputed cash handover has something behind it. */
export function needsCashPhoto(totalThebe: number): boolean {
  return totalThebe >= 20000; // P200 and up
}
```

---

## api/src/orders/commission.test.ts

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BP,
  SANITY_CAP_BP,
  CommissionError,
  checkTerms,
  pct,
  commissionOn,
  merchantNets,
  whatRatesWouldEarn,
  whichEarnsMore,
  type MerchantTerms,
} from './commission';

const terms = (over: Partial<MerchantTerms> = {}): MerchantTerms => ({
  merchant_id: 'M1',
  merchant_name: 'Broadhurst Hardware',
  commission_bp: 1500,
  agreed: false,
  agreed_on: null,
  source: '',
  ...over,
});

const signed = (over: Partial<MerchantTerms> = {}) =>
  terms({ agreed: true, agreed_on: '2026-09-15', source: 'Signed schedule 2 of the merchant agreement', ...over });

/* ------------- the safety that matters most ------------- */

test('A RATE THAT IS NOT AGREED EARNS NOTHING, however real it looks', () => {
  const v = commissionOn(100000, terms({ commission_bp: 2000 }));
  assert.equal(v.thebe, 0);
  assert.equal(v.earned, false);
  assert.match(v.says, /proposed/);
  assert.match(v.says, /not agreed/);
});

test('a merchant with no terms on file is charged nothing, never a default', () => {
  const v = commissionOn(100000, null);
  assert.equal(v.thebe, 0);
  assert.equal(v.earned, false);
  assert.match(v.says, /No terms on file/);
});

test('a rate cannot be agreed without saying where the number came from', () => {
  assert.throws(() => checkTerms(terms({ agreed: true, agreed_on: '2026-09-15', source: '   ' })),
    /where it came from/);
});

test('an agreed rate must carry the day it was agreed', () => {
  assert.throws(() => checkTerms(terms({ agreed: true, agreed_on: null, source: 'the deal' })),
    /needs the day/);
});

/* ------------- money is integers, never a float ------------- */

test('a rate is whole basis points, so fifteen percent is 1500 and never 0.15', () => {
  assert.throws(() => checkTerms(terms({ commission_bp: 0.15 })), /whole basis points/);
  assert.throws(() => checkTerms(terms({ commission_bp: 15.5 })), CommissionError);
});

test('commission comes out as whole thebe on an awkward basket', () => {
  const v = commissionOn(6533, signed({ commission_bp: 1750 }));
  assert.ok(Number.isInteger(v.thebe), 'a fraction of a thebe came out');
  assert.equal(v.thebe, Math.round((6533 * 1750) / BP));
});

test('a rate below nothing or above the whole basket is refused', () => {
  assert.throws(() => checkTerms(terms({ commission_bp: -1 })), /less than nothing/);
  assert.throws(() => checkTerms(terms({ commission_bp: BP + 1 })), /more than the whole basket/);
});

/* ------------- the fat finger guard ------------- */

test('a rate above the sanity cap is refused, because it is probably a typo', () => {
  assert.throws(() => checkTerms(terms({ commission_bp: 5000 })), /sanity cap/);
  assert.equal(SANITY_CAP_BP, 3500);
});

test('but a rate above the cap can be set deliberately, if that really is the deal', () => {
  assert.doesNotThrow(() => checkTerms(terms({ commission_bp: 5000, allowAboveCap: true })));
});

/* ------------- what it actually earns ------------- */

test('an agreed rate takes its share of the goods and says so plainly', () => {
  const v = commissionOn(20000, signed({ commission_bp: 1500 }));
  assert.equal(v.thebe, 3000, 'P30 of a P200 basket');
  assert.equal(v.earned, true);
  assert.match(v.says, /15 percent/);
  assert.match(v.says, /2026-09-15/);
});

test('the merchant keeps the rest, and the two always sum to the goods', () => {
  for (const goods of [1, 999, 20000, 500000]) {
    const t = signed({ commission_bp: 1750 });
    assert.equal(merchantNets(goods, t) + commissionOn(goods, t).thebe, goods);
  }
});

test('commission is charged on the goods only, never on the delivery fee', () => {
  // the fee is not passed in at all, which is the guarantee
  const v = commissionOn(20000, signed({ commission_bp: 2000 }));
  assert.equal(v.thebe, 4000, 'P40 of the P200 goods, and nothing of the P25 fee');
});

test('a rate reads as a person would say it', () => {
  assert.equal(pct(1500), '15 percent');
  assert.equal(pct(1750), '17.50 percent');
  assert.equal(pct(0), '0 percent');
});

/* ------------- the negotiation ------------- */

test('a month of baskets is priced at every rate on the table, for the actual conversation', () => {
  const options = whatRatesWouldEarn(5000000, [1000, 1500, 2000]); // P50,000 of goods
  assert.equal(options.length, 3);
  assert.deepEqual(options.map((o) => o.label), ['10 percent', '15 percent', '20 percent']);
  assert.equal(options[0].sprint_earns_thebe, 500000); // P5,000
  assert.equal(options[1].sprint_earns_thebe, 750000); // P7,500
  assert.equal(options[2].sprint_earns_thebe, 1000000); // P10,000
  for (const o of options) {
    assert.equal(o.sprint_earns_thebe + o.merchant_keeps_thebe, 5000000);
  }
});

test('the options always come back lowest rate first, whatever order they are given in', () => {
  const options = whatRatesWouldEarn(100000, [2500, 500, 1500]);
  assert.deepEqual(options.map((o) => o.bp), [500, 1500, 2500]);
});

test('THE QUESTION NOBODY COULD ANSWER: is the rate or the volume the thing to argue about', () => {
  // A supermarket: P50,000 of goods a month, 200 drops at P25
  const big = whichEarnsMore(5000000, 500000, signed({ commission_bp: 1500 }));
  assert.equal(big.bigger, 'commission');
  assert.equal(big.commission, 750000);
  assert.match(big.says, /rate is the thing to negotiate/);

  // A small shop: P4,000 of goods a month, 60 drops at P25
  const small = whichEarnsMore(400000, 150000, signed({ commission_bp: 1500 }));
  assert.equal(small.bigger, 'fees');
  assert.match(small.says, /volume matters more than the rate/);
});

test('while a rate is unagreed, the comparison honestly shows nothing earned', () => {
  const v = whichEarnsMore(5000000, 500000, terms({ commission_bp: 1500 }));
  assert.equal(v.commission, 0);
  assert.equal(v.bigger, 'fees');
});
```

---

## api/src/orders/commission.ts

```typescript
/**
 * Commission: what Sprint earns on the basket, not just on the drop.
 *
 * Asked for by Luther on 15 September 2026, after checking the settlement rules
 * turned up that there was no commission anywhere in the engine at all. Sprint's
 * whole upside was a flat delivery fee, so a merchant sending P50,000 a month paid
 * exactly the same as one sending P5,000 at the same order count. Wanzy and
 * Sixty60 both earn on the basket. It is the number a supermarket deal turns on,
 * and there was no field for it.
 *
 * Three mistakes this codebase has already made are deliberately designed out:
 *
 *   - INVENTED NUMBERS THAT HARDEN INTO POLICY. The 75 and 18 percent split in
 *     ledger.repo.ts was nobody's decision. So a rate here is worth nothing until
 *     `agreed` is true, and an unagreed rate earns ZERO rather than a guess.
 *   - A RATE WITH NO PROVENANCE. Every set of terms must say where the number came
 *     from, in writing, or it cannot be agreed.
 *   - MONEY AS A FLOAT. Rates are basis points as whole integers. 1500 is fifteen
 *     percent. There is no 0.15 anywhere in this file.
 *
 * And one thing is left deliberately undone: no rate is set for any merchant here.
 * Nobody has signed anything. The rates in a negotiation belong to Luther and
 * Barbara, and this file's job is to hold them correctly once they exist.
 */

export class CommissionError extends Error {}

/** 10,000 basis points is one hundred percent. 1500 is fifteen. */
export const BP = 10000;

/**
 * A rate this high is almost certainly a typo, not a deal. The cap is a guard
 * against a fat finger, not a commercial opinion: an override is possible, it
 * just has to be deliberate.
 */
export const SANITY_CAP_BP = 3500;

export interface MerchantTerms {
  merchant_id: string;
  merchant_name: string;
  /** basis points of the GOODS, never of the delivery fee */
  commission_bp: number;
  /** true only when the merchant has signed and Barbara has countersigned */
  agreed: boolean;
  /** the day it was agreed, or null while it is still a proposal */
  agreed_on: string | null;
  /** where the number came from. A rate with no source cannot be agreed. */
  source: string;
  /** set deliberately when a rate above the sanity cap is genuinely the deal */
  allowAboveCap?: boolean;
}

export function checkTerms(t: MerchantTerms): void {
  if (!Number.isInteger(t.commission_bp)) {
    throw new CommissionError('A commission rate is whole basis points. 1500 is fifteen percent.');
  }
  if (t.commission_bp < 0) throw new CommissionError('A commission rate cannot be less than nothing.');
  if (t.commission_bp > BP) throw new CommissionError('A commission rate cannot be more than the whole basket.');
  if (t.commission_bp > SANITY_CAP_BP && !t.allowAboveCap) {
    throw new CommissionError(
      `${pct(t.commission_bp)} is above the ${pct(SANITY_CAP_BP)} sanity cap. If that really is the deal, say so deliberately.`,
    );
  }
  if (t.agreed && !t.source.trim()) {
    throw new CommissionError('A rate cannot be agreed without saying where it came from.');
  }
  if (t.agreed && !t.agreed_on) {
    throw new CommissionError('An agreed rate needs the day it was agreed.');
  }
}

export function pct(bp: number): string {
  const whole = Math.floor(bp / 100);
  const rest = bp % 100;
  return rest === 0 ? `${whole} percent` : `${whole}.${String(rest).padStart(2, '0')} percent`;
}

export interface CommissionVerdict {
  /** thebe Sprint earns on these goods. Zero whenever the rate is not agreed. */
  thebe: number;
  earned: boolean;
  says: string;
}

/**
 * What Sprint earns on the goods of one order.
 *
 * An unagreed rate earns nothing. That is the whole safety of this file: a rate
 * typed in during a negotiation cannot start taking money from a merchant because
 * somebody forgot it was only a proposal.
 */
export function commissionOn(goodsThebe: number, terms: MerchantTerms | null): CommissionVerdict {
  if (!terms) {
    return { thebe: 0, earned: false, says: 'No terms on file for this merchant, so nothing is taken.' };
  }
  checkTerms(terms);
  if (!Number.isInteger(goodsThebe) || goodsThebe < 0) {
    throw new CommissionError('Goods are whole thebe, and cannot be less than nothing.');
  }
  if (!terms.agreed) {
    return {
      thebe: 0,
      earned: false,
      says: `${pct(terms.commission_bp)} is proposed for ${terms.merchant_name} and not agreed, so nothing is taken.`,
    };
  }
  const thebe = Math.round((goodsThebe * terms.commission_bp) / BP);
  return {
    thebe,
    earned: true,
    says: `${pct(terms.commission_bp)} of the goods, agreed ${terms.agreed_on}`,
  };
}

/** What the merchant is left with after Sprint's share of the goods. */
export function merchantNets(goodsThebe: number, terms: MerchantTerms | null): number {
  return goodsThebe - commissionOn(goodsThebe, terms).thebe;
}

/* ------------------------------------------------------------------ the deal */

export interface RateOption {
  bp: number;
  label: string;
  sprint_earns_thebe: number;
  merchant_keeps_thebe: number;
}

/**
 * What a month of this merchant's baskets would earn at each rate being
 * discussed, so a negotiation is done against arithmetic instead of a feeling.
 *
 * The delivery fees are passed in separately and deliberately: they are earned
 * whatever the commission is, and adding them to the commission column is how a
 * rate ends up looking better than it is.
 */
export function whatRatesWouldEarn(
  monthlyGoodsThebe: number,
  rates: number[] = [500, 1000, 1500, 2000, 2500],
): RateOption[] {
  if (!Number.isInteger(monthlyGoodsThebe) || monthlyGoodsThebe < 0) {
    throw new CommissionError('A month of goods is whole thebe, and cannot be less than nothing.');
  }
  return rates
    .filter((bp) => Number.isInteger(bp) && bp >= 0 && bp <= BP)
    .sort((a, b) => a - b)
    .map((bp) => {
      const earns = Math.round((monthlyGoodsThebe * bp) / BP);
      return {
        bp,
        label: pct(bp),
        sprint_earns_thebe: earns,
        merchant_keeps_thebe: monthlyGoodsThebe - earns,
      };
    });
}

/**
 * The question nobody could answer before this file existed: at this merchant's
 * volume, is the commission or the delivery fee the bigger line? If the fee wins,
 * the rate is too low to be worth arguing about and the conversation should be
 * about volume instead.
 */
export function whichEarnsMore(
  monthlyGoodsThebe: number,
  monthlyDeliveryFeesThebe: number,
  terms: MerchantTerms | null,
): { commission: number; fees: number; bigger: 'commission' | 'fees' | 'level'; says: string } {
  const commission = commissionOn(monthlyGoodsThebe, terms).thebe;
  const fees = monthlyDeliveryFeesThebe;
  const bigger = commission === fees ? 'level' : commission > fees ? 'commission' : 'fees';
  return {
    commission,
    fees,
    bigger,
    says:
      bigger === 'fees'
        ? 'The delivery fees earn more than the commission here, so volume matters more than the rate.'
        : bigger === 'commission'
          ? 'The commission earns more than the delivery fees here, so the rate is the thing to negotiate.'
          : 'The commission and the delivery fees earn the same here.',
  };
}
```
