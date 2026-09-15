# Sprint delivery engine, review pack: the whole engine

A customer facing delivery platform for Gaborone, Botswana. One app, many kinds of
shop, the way Checkers Sixty60 works: a shop has a KIND and each kind carries its
own rules. A pharmacy needs a pharmacist, a bottle store needs a licence and
trading hours, a pet shop needs neither.

TypeScript on NestJS. 271 tests passing, tsc clean.
Public copy: https://github.com/94luther/sprint-alpha-review

**This pack holds 73 files, which is 100 percent of the engine's code.** It is every TypeScript file in the engine, source and tests.

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
   over it. Two tests had to change with the contract the day this was written.

Do not tell me the code is clean. Tell me the failure, the input that causes it,
and what it costs.

## Context that is not in the code

- No merchant has signed anything. Every shop name and price is invented.
- No payment rail is switched on. Cash and on account are the only live ones, and
  every other rail refuses by name rather than pretending to work.
- This is one person's project. There is no team and no production deployment.
- Money is thebe as whole integers. One hundred thebe is one pula.


---

## api/src/app.module.ts

```typescript
import { Module } from '@nestjs/common';
import { DataStoreModule } from './data-store/data-store.module';
import { AuthModule } from './auth/auth.module';
import { CatalogModule } from './catalog/catalog.module';
import { OrdersModule } from './orders/orders.module';
import { DispatchModule } from './dispatch/dispatch.module';
import { TrackingModule } from './tracking/tracking.module';
import { OpsModule } from './ops/ops.module';
import { SimulatorModule } from './simulator/simulator.module';

@Module({
  imports: [
    DataStoreModule,
    AuthModule,
    CatalogModule,
    OrdersModule,
    DispatchModule,
    TrackingModule,
    OpsModule,
    SimulatorModule,
  ],
})
export class AppModule {}
```

---

## api/src/auth/auth.controller.ts

```typescript
import { Body, Controller, HttpCode, HttpException, HttpStatus, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto';
import { RateLimiter } from '../common/rate-limit';

// 5 attempts per minute per ip, kept simple and in memory since this is a
// single process alpha. Protects the demo logins from a brute force loop.
const loginLimiter = new RateLimiter(5, 60_000);

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() body: LoginDto, @Req() req: Request) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (!loginLimiter.check(ip)) {
      throw new HttpException(
        { message: 'Too many login attempts, please wait a minute and try again.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return this.authService.login(body);
  }
}
```

---

## api/src/auth/auth.module.ts

```typescript
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
```

---

## api/src/auth/auth.service.test.ts

```typescript
/**
 * Brick 22, the argon2id swap. Proves the login actually works after it, not just that it
 * compiles. Run with:
 *   npm --prefix api run test:auth
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashSync, Algorithm } from '@node-rs/argon2';
import { AuthService } from './auth.service';
import { buildSeed } from '../data-store/seed';

// Test only values. The real ones live in .env and are never in source control. The code
// refusing to run without them is correct behaviour, so the test supplies its own rather
// than the code being loosened to allow a missing key.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-not-used-anywhere-real';
process.env.DEMO_MASTER_KEY =
  process.env.DEMO_MASTER_KEY || '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

function serviceFor(user: any) {
  const repo: any = { findByPhone: (phone: string) => (user && user.phone === phone ? user : null) };
  return new AuthService(repo);
}

const USER = {
  id: 'u1',
  name: 'Neo',
  role: 'customer',
  phone: '71111111',
  pin_hash: hashSync('1234', { algorithm: Algorithm.Argon2id }),
};

test('a correct pin signs in', async () => {
  const res = await serviceFor(USER).login({ phone: '71111111', pin: '1234' } as any);
  assert.equal(res.role, 'customer');
  assert.equal(res.name, 'Neo');
  assert.ok(res.token.split('.').length === 3, 'a token should come back');
});

test('a wrong pin does not', async () => {
  await assert.rejects(
    () => serviceFor(USER).login({ phone: '71111111', pin: '9999' } as any),
    /do not match/,
  );
});

test('an unknown phone gives the same answer as a wrong pin', async () => {
  await assert.rejects(
    () => serviceFor(USER).login({ phone: '79999999', pin: '1234' } as any),
    /do not match/,
  );
});

test('a missing phone or pin is refused before anything else happens', async () => {
  await assert.rejects(() => serviceFor(USER).login({ phone: '', pin: '1234' } as any), /both needed/);
  await assert.rejects(() => serviceFor(USER).login({ phone: '71111111', pin: '' } as any), /both needed/);
});

test('an unknown phone still costs real work, so numbers cannot be found by timing', async () => {
  const svc = serviceFor(USER);
  const time = async (phone: string) => {
    const t0 = process.hrtime.bigint();
    await svc.login({ phone, pin: '1234' } as any).catch(() => {});
    return Number(process.hrtime.bigint() - t0) / 1e6;
  };
  await time('71111111');
  const known = await time('71111111');
  const unknown = await time('79999999');
  assert.ok(unknown > known * 0.3,
    `an unknown phone returned in ${unknown.toFixed(1)}ms against ${known.toFixed(1)}ms for a known one, which leaks which numbers exist`);
});

test('the seeded accounts are argon2id, not the old format', () => {
  const seed: any = buildSeed();
  assert.ok(seed.users.length > 0, 'the seed should create users');
  for (const u of seed.users) {
    assert.ok(u.pin_hash.startsWith('$argon2id$'), `${u.name} still has a ${u.pin_hash.slice(0, 4)} hash`);
    assert.equal(u.pin_hash.startsWith('$2'), false, 'that is a bcrypt hash');
  }
});

test('a seeded account can actually sign in', async () => {
  const seed: any = buildSeed();
  const neo = seed.users.find((u: any) => u.name === 'Neo');
  assert.ok(neo, 'the demo account should exist');
  const repo: any = { findByPhone: () => neo };
  const res = await new AuthService(repo).login({ phone: '71111111', pin: '1234' } as any);
  assert.equal(res.name, 'Neo');
});

test('an old bcrypt hash no longer opens the door', async () => {
  const legacy = { ...USER, pin_hash: '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy' };
  await assert.rejects(
    () => serviceFor(legacy).login({ phone: '71111111', pin: 'password' } as any),
    /do not match/,
    'a bcrypt hash must fail closed, never throw an unhandled error',
  );
});

test('argon2id is used with memory and iterations, not the bare defaults of a weaker algorithm', () => {
  const h = hashSync('1234', { algorithm: Algorithm.Argon2id });
  assert.match(h, /^\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$/);
  const m = Number(h.match(/m=(\d+)/)![1]);
  const t = Number(h.match(/t=(\d+)/)![1]);
  assert.ok(m >= 19456, `memory cost ${m} is below the recommended 19456 KiB`);
  assert.ok(t >= 2, `iterations ${t} is below the recommended 2`);
});
```

---

## api/src/auth/auth.service.ts

```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { verify, Algorithm } from '@node-rs/argon2';
import * as jwt from 'jsonwebtoken';
import { UsersRepo } from '../data-store/repositories/users.repo';
import { LoginDto, LoginResponse } from './dto';

// Verified against this when the phone is not known, so an unknown number costs the same
// time as a wrong pin. Never matches any real pin.
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c3ByaW50ZHVtbXlzYWx0$3S3lRXKMr3xqFhVQ6mB8Bx6gJ4kYQm5nCqXQ2dZ0Ypo';

// Pins are hashed with argon2id, which is what the blueprint specifies and what the
// security audit at docs/SECURITY_AUDIT.md required before a member of the public ever
// sets a password. Swapped from bcryptjs on 13 September 2026.
//
// This was a clean cut rather than a migration, because the only hashes that existed were
// seeded demo accounts. A real system with live passwords would keep reading the old format
// at login, re hash to argon2id on a correct pin, and only then drop the old library. If
// this code is ever pointed at a database that predates the swap, put that path back first.
//
// Verification is asynchronous on purpose. argon2id is deliberately slow and memory hungry,
// which is the point of it, and doing that synchronously would block every other request on
// the server for the duration of one login.
@Injectable()
export class AuthService {
  constructor(private readonly usersRepo: UsersRepo) {}

  async login(dto: LoginDto): Promise<LoginResponse> {
    if (!dto || !dto.phone || !dto.pin) {
      throw new UnauthorizedException('Phone and pin are both needed to sign in.');
    }
    const user = this.usersRepo.findByPhone(dto.phone.trim());
    // The same message and roughly the same work whether the phone is unknown or the pin is
    // wrong, so a caller cannot learn which numbers are registered by timing the answer.
    const stored = user?.pin_hash ?? DUMMY_HASH;
    let ok = false;
    try {
      ok = await verify(stored, dto.pin, { algorithm: Algorithm.Argon2id });
    } catch {
      ok = false;
    }
    if (!user || !ok) {
      throw new UnauthorizedException('That phone and pin do not match, please try again.');
    }
    const secret = process.env.JWT_SECRET as string;
    const token = jwt.sign({ sub: user.id, role: user.role, name: user.name }, secret, {
      algorithm: 'HS256',
      expiresIn: '12h',
    });
    return { token, role: user.role, name: user.name };
  }
}
```

---

## api/src/auth/dto.ts

```typescript
export interface LoginDto {
  phone: string;
  pin: string;
}

export interface LoginResponse {
  token: string;
  role: string;
  name: string;
}
```

---

## api/src/catalog/catalog.controller.ts

```typescript
import { Controller, Get } from '@nestjs/common';
import { CatalogService } from './catalog.service';

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get()
  getCatalog() {
    return this.catalogService.getCatalog();
  }
}
```

---

## api/src/catalog/catalog.module.ts

```typescript
import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

@Module({
  controllers: [CatalogController],
  providers: [CatalogService],
})
export class CatalogModule {}
```

---

## api/src/catalog/catalog.service.ts

```typescript
import { Injectable } from '@nestjs/common';
import { MerchantsRepo } from '../data-store/repositories/merchants.repo';
import { groupByVertical } from './verticals';

@Injectable()
export class CatalogService {
  constructor(private readonly merchantsRepo: MerchantsRepo) {}

  getCatalog() {
    const merchants = this.merchantsRepo.listAll().map((m) => ({
      id: m.id,
      name: m.name,
      type: m.type,
      age_restricted: m.age_restricted,
      heroImage: m.heroImage,
      rating: m.rating,
      ratingCount: m.ratingCount,
      etaMinLow: m.etaMinLow,
      etaMinHigh: m.etaMinHigh,
      deliveryFee: m.deliveryFee,
      promo: m.promo,
      status: m.status,
      items: m.items.map((i) => ({
        id: i.id,
        name: i.name,
        price_bwp: i.price_bwp,
        photo: i.photo,
        description: i.description,
      })),
    }));

    /* One app, many kinds of shop. `merchants` stays exactly as it was so nothing
       already reading this endpoint breaks; `sections` is the Sixty60 view the home
       page draws. `blocked` is deliberately returned rather than hidden: a vertical
       that law keeps off the page should be visible to whoever is running the
       business, just never to the customer. */
    const { sections, unplaced, blocked } = groupByVertical(merchants);
    return { merchants, sections, unplaced, blocked };
  }
}
```

---

## api/src/catalog/verticals.test.ts

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VERTICALS,
  allVerticals,
  isVertical,
  rulesFor,
  gatesFor,
  mayList,
  groupByVertical,
  type Vertical,
} from './verticals';

const shop = (id: string, type: string) => ({ id, type, name: id });

test('every vertical has a label and a place on the page', () => {
  for (const v of allVerticals()) {
    const r = rulesFor(v);
    assert.ok(r.label.length > 0, `${v} has no label`);
    assert.ok(r.order > 0, `${v} has no order`);
  }
});

test('the home page order is stable and has no ties', () => {
  const orders = allVerticals().map((v) => VERTICALS[v].order);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b));
  assert.equal(new Set(orders).size, orders.length, 'two verticals share a position');
});

test('restaurants lead the page, because that is what exists today', () => {
  assert.equal(allVerticals()[0], 'food');
});

test('an unknown type is not a vertical', () => {
  assert.equal(isVertical('food'), true);
  assert.equal(isVertical('vape'), false);
  assert.equal(isVertical(''), false);
});

/* ---- the cheap verticals: the whole point of phase one ---- */

test('pet, hardware and baby carry no gates at all', () => {
  for (const v of ['pet', 'hardware', 'baby'] as Vertical[]) {
    assert.deepEqual(gatesFor(v), [], `${v} should need nothing`);
    assert.equal(mayList(v).listable, true, `${v} should be listable`);
  }
});

test('groceries need a cold box but no licence and no identity check', () => {
  const r = rulesFor('grocery');
  assert.equal(r.coldChain, true);
  assert.equal(r.licenceRequired, false);
  assert.equal(r.ageRestricted, false);
  assert.deepEqual(gatesFor('grocery'), ['cold box where flagged']);
});

/* ---- the regulated ones ---- */

test('liquor carries identity, a licence and trading hours', () => {
  const g = gatesFor('liquor');
  assert.ok(g.includes('identity checked at the door'));
  assert.ok(g.includes('merchant licence on file'));
  assert.ok(g.includes('handover inside licensed hours'));
  assert.equal(g.includes('pharmacist dispensed and sealed'), false);
});

test('liquor IS listable: its gates are built, only the merchant paperwork is theirs', () => {
  assert.equal(mayList('liquor').listable, true);
  assert.equal(mayList('liquor').reason, null);
});

test('pharmacy is BLOCKED IN CODE until BoMRA answers, and says so by name', () => {
  const verdict = mayList('pharmacy');
  assert.equal(verdict.listable, false);
  assert.match(String(verdict.reason), /BoMRA/);
  assert.match(String(verdict.reason), /brick 8/);
});

test('pharmacy carries every gate it will need the day it is unblocked', () => {
  const g = gatesFor('pharmacy');
  assert.ok(g.includes('pharmacist dispensed and sealed'));
  assert.ok(g.includes('identity checked at the door'));
  assert.ok(g.includes('cold box where flagged'));
});

/* ---- grouping: what the home page actually draws ---- */

test('shops are grouped into rows in page order, not in the order they were added', () => {
  const { sections } = groupByVertical([
    shop('paws', 'pet'),
    shop('kgalagadi', 'food'),
    shop('builders', 'hardware'),
    shop('choppies', 'grocery'),
  ]);
  assert.deepEqual(
    sections.map((s) => s.vertical),
    ['food', 'grocery', 'pet', 'hardware'],
  );
});

test('a row with no shop in it is never drawn, so no empty shelves', () => {
  const { sections } = groupByVertical([shop('kgalagadi', 'food')]);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].vertical, 'food');
});

test('seed data CANNOT put a pharmacy in front of a customer', () => {
  const { sections, blocked } = groupByVertical([
    shop('kgalagadi', 'food'),
    shop('medirite', 'pharmacy'),
  ]);
  assert.deepEqual(sections.map((s) => s.vertical), ['food']);
  assert.deepEqual(blocked, ['pharmacy']);
});

test('a shop of an unknown kind is reported, never silently hidden', () => {
  const { sections, unplaced } = groupByVertical([
    shop('kgalagadi', 'food'),
    shop('vapeshop', 'vape'),
  ]);
  assert.equal(sections.length, 1);
  assert.deepEqual(unplaced.map((m) => m.id), ['vapeshop']);
});

test('each row carries its own gates, so a screen cannot forget them', () => {
  const { sections } = groupByVertical([shop('tops', 'liquor')]);
  assert.ok(sections[0].gates.includes('identity checked at the door'));
});

test('grouping keeps every listable shop: nothing is lost on the way to the page', () => {
  const input = [
    shop('a', 'food'),
    shop('b', 'food'),
    shop('c', 'grocery'),
    shop('d', 'pet'),
  ];
  const { sections, unplaced, blocked } = groupByVertical(input);
  const kept = sections.reduce((n, s) => n + s.merchants.length, 0);
  assert.equal(kept + unplaced.length, input.length);
  assert.deepEqual(blocked, []);
});
```

---

## api/src/catalog/verticals.ts

```typescript
/**
 * Verticals: one app, many kinds of shop.
 *
 * The Sixty60 move, which Luther brought back on 15 September 2026: they did not
 * build seven apps. They built one and taught it that a shop has a KIND, and that
 * each kind carries its own rules. A pharmacy needs a pharmacist. A bottle store
 * needs a licence and trading hours. A pet shop needs neither.
 *
 * The rules are written here, in one place, rather than scattered through screens,
 * because a screen can be redesigned by anybody and a rule must not be. Two of them
 * are law, not preference:
 *
 *   - PHARMACY IS BLOCKED IN CODE. Brick 8 is still open: BoMRA has not answered in
 *     writing whether a licensed courier may carry a sealed, pharmacist dispensed
 *     prescription, and nothing public was found on whether they licence online
 *     pharmacy at all. Until that letter exists this vertical cannot be listed, and
 *     removing the block requires editing this file and saying why in the commit.
 *   - LIQUOR DEFERS TO THE EXISTING ENGINE. orders/liquor.ts already holds the
 *     licence, the trading hours and a sixty day expiry warning. Nothing here
 *     re-implements any of that; this file only says that liquor HAS those gates.
 *
 * Adding a shop type is now a row in VERTICALS, not a new codebase.
 */

export type Vertical =
  | 'food'
  | 'grocery'
  | 'liquor'
  | 'pharmacy'
  | 'pet'
  | 'hardware'
  | 'baby'
  | 'parcel';

export interface VerticalRules {
  /** what a customer sees above the row of shops */
  label: string;
  /** where the row sits on the home page, lowest first */
  order: number;
  /** the rider checks identity at the door */
  ageRestricted: boolean;
  /** the merchant must have a licence on file before it may be listed */
  licenceRequired: boolean;
  /** handover only inside the merchant's licensed hours, judged on arrival */
  tradingHours: boolean;
  /** the item must be dispensed and sealed by a pharmacist before collection */
  prescription: boolean;
  /** a cold box is required where the item is flagged */
  coldChain: boolean;
  /**
   * A named external thing that must exist before this vertical may go live at
   * all. Null means nothing outside this building is in the way.
   */
  blockedBy: string | null;
}

export const VERTICALS: Record<Vertical, VerticalRules> = {
  food: {
    label: 'Restaurants',
    order: 1,
    ageRestricted: false,
    licenceRequired: false,
    tradingHours: false,
    prescription: false,
    coldChain: false,
    blockedBy: null,
  },
  grocery: {
    label: 'Groceries',
    order: 2,
    ageRestricted: false,
    licenceRequired: false,
    tradingHours: false,
    prescription: false,
    coldChain: true, // frozen and chilled baskets travel in a cold box
    blockedBy: null,
  },
  pet: {
    label: 'Pet and vet',
    order: 3,
    ageRestricted: false,
    licenceRequired: false,
    tradingHours: false,
    prescription: false,
    coldChain: false,
    blockedBy: null,
  },
  hardware: {
    label: 'Hardware and home',
    order: 4,
    ageRestricted: false,
    licenceRequired: false,
    tradingHours: false,
    prescription: false,
    coldChain: false,
    blockedBy: null,
  },
  baby: {
    label: 'Baby and kids',
    order: 5,
    ageRestricted: false,
    licenceRequired: false,
    tradingHours: false,
    prescription: false,
    coldChain: false,
    blockedBy: null,
  },
  parcel: {
    label: 'Send a parcel',
    order: 6,
    ageRestricted: false,
    licenceRequired: false,
    tradingHours: false,
    prescription: false,
    coldChain: false,
    blockedBy: null,
  },
  liquor: {
    label: 'Liquor',
    order: 7,
    ageRestricted: true,
    licenceRequired: true,
    tradingHours: true,
    prescription: false,
    coldChain: false,
    blockedBy: null, // the gates are built; a merchant licence is a merchant problem
  },
  pharmacy: {
    label: 'Pharmacy',
    order: 8,
    ageRestricted: true,
    licenceRequired: true,
    tradingHours: false,
    prescription: true,
    coldChain: true,
    blockedBy:
      "BoMRA's written answer on carrying a sealed, pharmacist dispensed prescription (brick 8)",
  },
};

/** Every vertical, in the order the home page draws them. */
export function allVerticals(): Vertical[] {
  return (Object.keys(VERTICALS) as Vertical[]).sort(
    (a, b) => VERTICALS[a].order - VERTICALS[b].order,
  );
}

export function isVertical(v: string): v is Vertical {
  return Object.prototype.hasOwnProperty.call(VERTICALS, v);
}

export function rulesFor(v: Vertical): VerticalRules {
  return VERTICALS[v];
}

/** The gates a rider or a screen must honour for this kind of shop. */
export function gatesFor(v: Vertical): string[] {
  const r = VERTICALS[v];
  const gates: string[] = [];
  if (r.ageRestricted) gates.push('identity checked at the door');
  if (r.licenceRequired) gates.push('merchant licence on file');
  if (r.tradingHours) gates.push('handover inside licensed hours');
  if (r.prescription) gates.push('pharmacist dispensed and sealed');
  if (r.coldChain) gates.push('cold box where flagged');
  return gates;
}

export interface ListingVerdict {
  listable: boolean;
  reason: string | null;
}

/**
 * May a shop of this kind appear in the app at all?
 *
 * This answers the question ABOUT THE VERTICAL, not about one merchant's paperwork.
 * A merchant missing its own liquor licence is caught later by orders/liquor.ts at
 * handover, which is where it belongs, because a licence can lapse between the
 * listing and the door.
 */
export function mayList(v: Vertical): ListingVerdict {
  const r = VERTICALS[v];
  if (r.blockedBy) return { listable: false, reason: r.blockedBy };
  return { listable: true, reason: null };
}

export interface MerchantLike {
  id: string;
  type: string;
  [k: string]: unknown;
}

export interface VerticalSection<T extends MerchantLike> {
  vertical: Vertical;
  label: string;
  gates: string[];
  merchants: T[];
}

/**
 * Group merchants into the rows the home page draws.
 *
 * Empty rows are dropped, so a vertical with no signed merchant never shows the
 * customer an empty shelf. Blocked verticals are dropped even when a merchant
 * exists, which is the point: seed data must never be able to put a pharmacy in
 * front of a customer before BoMRA has answered.
 *
 * A merchant whose type is not a known vertical is returned in `unplaced` rather
 * than silently dropped, because a shop that exists and is invisible is the worst
 * of the three outcomes and somebody has to see it.
 */
export function groupByVertical<T extends MerchantLike>(
  merchants: T[],
): { sections: VerticalSection<T>[]; unplaced: T[]; blocked: Vertical[] } {
  const unplaced: T[] = [];
  const bucket = new Map<Vertical, T[]>();

  for (const m of merchants) {
    if (!isVertical(m.type)) {
      unplaced.push(m);
      continue;
    }
    const list = bucket.get(m.type) ?? [];
    list.push(m);
    bucket.set(m.type, list);
  }

  const sections: VerticalSection<T>[] = [];
  const blocked: Vertical[] = [];

  for (const v of allVerticals()) {
    const found = bucket.get(v);
    if (!found || found.length === 0) continue;
    if (!mayList(v).listable) {
      blocked.push(v);
      continue;
    }
    sections.push({
      vertical: v,
      label: VERTICALS[v].label,
      gates: gatesFor(v),
      merchants: found,
    });
  }

  return { sections, unplaced, blocked };
}
```

---

## api/src/common/aes.ts

```typescript
import * as crypto from 'node:crypto';

// AES-256-GCM helper for encrypting personal fields (customer phone, delivery
// address) before they touch data/store.json. The key comes from
// DEMO_MASTER_KEY in .env, 64 hex characters (32 bytes).
//
// Storage format is one string: iv_hex:tag_hex:ciphertext_hex
// Keeping the iv and auth tag alongside the ciphertext is what lets us
// decrypt later; GCM needs both to verify the data was not tampered with.
//
// This is a real, working encryption path for the alpha demo. In production
// the key would live in a secrets manager (not a committed .env) and pin
// hashing is argon2id, swapped 13 Sep 2026, see auth/auth.service.ts.

const ALGO = 'aes-256-gcm';

function getKey(): Buffer {
  const hex = process.env.DEMO_MASTER_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      'DEMO_MASTER_KEY must be set in .env as 64 hex characters (32 bytes). ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  return Buffer.from(hex, 'hex');
}

export function encrypt(plainText: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`;
}

export function decrypt(stored: string): string {
  const key = getKey();
  const [ivHex, tagHex, dataHex] = stored.split(':');
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error('Malformed encrypted value, expected iv:tag:ciphertext');
  }
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]);
  return plain.toString('utf8');
}

// Deterministic, one way lookup index so we can find a user by phone number
// without ever decrypting at login time. Not a secret by itself, it only
// ever gets compared against another hash of the same shape.
export function blindIndex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}
```

---

## api/src/common/jwt-auth.guard.ts

```typescript
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';

// Reads "Authorization: Bearer <token>", verifies it with the HS256 secret
// from .env, and attaches the decoded payload to request.user. Any
// controller that needs a logged in caller applies this guard.
@Injectable()
export class JwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = header.slice('Bearer '.length).trim();
    try {
      const secret = process.env.JWT_SECRET as string;
      const payload = jwt.verify(token, secret) as any;
      req.user = { sub: payload.sub, role: payload.role, name: payload.name };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
```

---

## api/src/common/rate-limit.ts

```typescript
// Small in-memory sliding window limiter. Good enough for a single-process
// alpha demo; a real deployment would move this to Redis.
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(private readonly max: number, private readonly windowMs: number) {}

  // Returns true when the caller is still within the allowed rate.
  check(key: string): boolean {
    const now = Date.now();
    const arr = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.max) {
      this.hits.set(key, arr);
      return false;
    }
    arr.push(now);
    this.hits.set(key, arr);
    return true;
  }
}
```

---

## api/src/common/types.ts

```typescript
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
```

---

## api/src/common/waypoints.ts

```typescript
// 8 named Gaborone waypoints, all inside lat -24.60..-24.70, lng 25.85..25.95.
// Idle couriers wander between these; they are also handy anchor points for
// seeding merchant pickup locations and demo courier start positions.
export const WAYPOINTS: { name: string; lat: number; lng: number }[] = [
  { name: 'CBD', lat: -24.6282, lng: 25.9231 },
  { name: 'Main Mall', lat: -24.6539, lng: 25.9089 },
  { name: 'Broadhurst', lat: -24.6392, lng: 25.9412 },
  { name: 'Game City', lat: -24.6685, lng: 25.9107 },
  { name: 'Riverwalk', lat: -24.6743, lng: 25.9298 },
  { name: 'Extension 9', lat: -24.6198, lng: 25.8912 },
  { name: 'University of Botswana', lat: -24.6841, lng: 25.9214 },
  { name: 'Airport Junction', lat: -24.6061, lng: 25.9183 },
];

export function randomPointInGaborone(): { lat: number; lng: number } {
  const lat = -24.7 + Math.random() * (24.7 - 24.6);
  const lng = 25.85 + Math.random() * (25.95 - 25.85);
  return { lat, lng };
}
```

---

## api/src/data-store/data-store.module.ts

```typescript
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
```

---

## api/src/data-store/interfaces.ts

```typescript
import { MerchantType, OrderStatus, PaymentMethod, Role } from '../common/types';

export interface UserRecord {
  id: string;
  name: string;
  role: Role;
  phone_hash: string; // sha256 blind index, used to find the user at login
  phone_enc: string; // AES-256-GCM ciphertext, the demo talking point
  pin_hash: string; // argon2id hash
  courier_id?: string; // set when role is 'courier', links to CourierRecord
}

export interface MerchantItemRecord {
  id: string;
  name: string;
  price_bwp: number;
  photo: string; // /food/<name>.jpg, served from web/public/food
  description: string;
}

export interface MerchantRecord {
  id: string;
  name: string;
  type: MerchantType;
  age_restricted: boolean;
  items: MerchantItemRecord[];
  lat: number; // pickup point, internal only, not part of the /catalog contract
  lng: number;
  heroImage: string; // /food/<name>.jpg, served from web/public/food
  rating: number;
  ratingCount: number;
  etaMinLow: number;
  etaMinHigh: number;
  deliveryFee: number; // pula, flat per-merchant demo figure
  promo: string | null;
  status: 'open' | 'busy' | 'closed'; // live availability shown on cards and hero
}

export interface CourierRecord {
  id: string;
  name: string;
  status: 'online' | 'offered' | 'busy' | 'offline';
  lat: number;
  lng: number;
  rating: number;
  earnings_today_bwp: number;
  waypoint_target: number; // index into WAYPOINTS, used while wandering idle
  move_target?: { lat: number; lng: number } | null; // used while on an order
}

export interface OrderItemRecord {
  item_id: string;
  name: string;
  qty: number;
  price_bwp: number;
}

export interface TimelineEntry {
  status: OrderStatus;
  at: string;
}

export interface OrderRecord {
  id: string;
  customer_id: string;
  merchant_id: string;
  items: OrderItemRecord[];
  total_bwp: number;
  payment_method: PaymentMethod;
  address_enc: string; // AES-256-GCM ciphertext
  delivery_lat: number;
  delivery_lng: number;
  age_confirmed: boolean;
  status: OrderStatus;
  timeline: TimelineEntry[];
  courier_id: string | null;
  eta_min: number | null;
  idempotency_key: string;
  created_at: string;
  next_step_at: number; // epoch ms, when the simulator should advance this order
}

export interface DispatchScoreComponent {
  eta_min: number;
  active_load: number;
  rating_gap: number;
  fairness_boost: number;
}

export interface DispatchScore {
  courier_id: string;
  courier_name: string;
  score: number;
  components: DispatchScoreComponent;
}

export interface LastDispatch {
  order_id: string;
  scores: DispatchScore[];
}

export interface LedgerEntryRecord {
  id: string;
  order_id: string;
  account: string;
  type: 'debit' | 'credit';
  amount_bwp: number;
  created_at: string;
}

export interface OutboxEventRecord {
  id: string;
  event: string;
  order_id: string;
  payload: unknown;
  at: string;
}

export interface IdempotencyRecord {
  key: string; // `${user_id}:${idempotency_key}`
  order_id: string;
}

export interface StoreShape {
  users: UserRecord[];
  merchants: MerchantRecord[];
  couriers: CourierRecord[];
  orders: OrderRecord[];
  ledger_entries: LedgerEntryRecord[];
  events_outbox: OutboxEventRecord[];
  idempotency: IdempotencyRecord[];
  last_dispatch: LastDispatch | null;
}
```

---

## api/src/data-store/repo-interfaces.ts

```typescript
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
```

---

## api/src/data-store/repositories/couriers.repo.ts

```typescript
import { Injectable } from '@nestjs/common';
import { StoreService } from '../store.service';
import { CourierRecord } from '../interfaces';
import { ICouriersRepo } from '../repo-interfaces';

@Injectable()
export class CouriersRepo implements ICouriersRepo {
  constructor(private readonly store: StoreService) {}

  listAll(): CourierRecord[] {
    return this.store.state.couriers;
  }

  findById(id: string): CourierRecord | undefined {
    return this.store.state.couriers.find((c) => c.id === id);
  }

  update(id: string, patch: Partial<CourierRecord>): void {
    const courier = this.findById(id);
    if (!courier) return;
    Object.assign(courier, patch);
    this.store.markDirty();
  }

  // Fleet wide median of earnings_today_bwp, used by the dispatch fairness
  // boost so a courier who has earned less today is nudged toward more work.
  medianEarningsToday(): number {
    const values = this.listAll()
      .map((c) => c.earnings_today_bwp)
      .sort((a, b) => a - b);
    if (values.length === 0) return 0;
    const mid = Math.floor(values.length / 2);
    return values.length % 2 === 0 ? (values[mid - 1] + values[mid]) / 2 : values[mid];
  }
}
```

---

## api/src/data-store/repositories/ledger.repo.ts

```typescript
import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { StoreService } from '../store.service';
import { LedgerEntryRecord } from '../interfaces';
import { ILedgerRepo } from '../repo-interfaces';

// Writes the payout split for a delivered order as real double entry rows:
// every split (merchant_payable, courier_earnings, sprint_take) gets a debit
// against a clearing account and a matching credit against its own account,
// so the rows always balance in pairs.
/**
 * INVENTED FIGURES. NOT A COMMERCIAL AGREEMENT. Found 15 September 2026 while
 * checking the settlement rules, and named here rather than left loose in the
 * arithmetic.
 *
 * These 75 and 18 percent shares contradict the settlement engine, which is the
 * file that decides what anybody is actually paid. settlement.ts pays a merchant
 * ONE HUNDRED percent of the goods on a delivered order and keeps only the
 * delivery fee for Sprint. This repository splits the same order three ways.
 *
 * They disagree because they were written for different purposes: this one only
 * feeds the simulator, and simulator.service.ts is the only caller. Nobody is
 * paid from it. But a file called a ledger, writing double entry rows that
 * balance, is exactly the thing somebody trusts later without reading it, so the
 * numbers are marked rather than tidied away.
 *
 * Neither model can be the real one until Barbara agrees the fault model, which
 * docs/FAULT_MODEL.md still records as "Status: proposed. Not yet agreed by
 * Barbara." A test holds `agreed` at false so this cannot quietly become policy.
 */
export const SIMULATOR_SPLIT = {
  merchant: 0.75,
  courier: 0.18,
  /** Sprint takes the remainder, so the three always sum to the order exactly. */
  agreed: false,
  contradicts:
    'settlement.ts pays the merchant 100 percent of goods and gives Sprint only the delivery fee',
} as const;

@Injectable()
export class LedgerRepo implements ILedgerRepo {
  constructor(private readonly store: StoreService) {}

  writeOrderSplit(orderId: string, totalBwp: number): LedgerEntryRecord[] {
    const merchantAmt = Math.round(totalBwp * SIMULATOR_SPLIT.merchant * 100) / 100;
    const courierAmt = Math.round(totalBwp * SIMULATOR_SPLIT.courier * 100) / 100;
    // Sprint's cut takes the remainder so the three splits always sum to
    // the exact order total, rounding included.
    const sprintAmt = Math.round((totalBwp - merchantAmt - courierAmt) * 100) / 100;

    const now = new Date().toISOString();
    const rows: LedgerEntryRecord[] = [];
    const pairs: [string, number][] = [
      ['merchant_payable', merchantAmt],
      ['courier_earnings', courierAmt],
      ['sprint_take', sprintAmt],
    ];

    for (const [account, amount] of pairs) {
      rows.push({
        id: crypto.randomUUID(),
        order_id: orderId,
        account: 'cash_clearing',
        type: 'debit',
        amount_bwp: amount,
        created_at: now,
      });
      rows.push({
        id: crypto.randomUUID(),
        order_id: orderId,
        account,
        type: 'credit',
        amount_bwp: amount,
        created_at: now,
      });
    }

    this.store.state.ledger_entries.push(...rows);
    this.store.persist();
    return rows;
  }
}
```

---

## api/src/data-store/repositories/merchants.repo.ts

```typescript
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
```

---

## api/src/data-store/repositories/orders.repo.ts

```typescript
import { Injectable } from '@nestjs/common';
import { StoreService } from '../store.service';
import { OrderRecord } from '../interfaces';
import { IOrdersRepo } from '../repo-interfaces';

@Injectable()
export class OrdersRepo implements IOrdersRepo {
  constructor(private readonly store: StoreService) {}

  create(order: OrderRecord): void {
    this.store.state.orders.push(order);
    this.store.persist();
  }

  findById(id: string): OrderRecord | undefined {
    return this.store.state.orders.find((o) => o.id === id);
  }

  findByIdempotency(userId: string, key: string): OrderRecord | undefined {
    const combo = `${userId}:${key}`;
    const rec = this.store.state.idempotency.find((i) => i.key === combo);
    if (!rec) return undefined;
    return this.findById(rec.order_id);
  }

  saveIdempotency(userId: string, key: string, orderId: string): void {
    this.store.state.idempotency.push({ key: `${userId}:${key}`, order_id: orderId });
  }

  listActiveForCourier(courierId: string): OrderRecord[] {
    return this.store.state.orders.filter(
      (o) => o.courier_id === courierId && o.status !== 'delivered',
    );
  }

  listAll(): OrderRecord[] {
    return this.store.state.orders;
  }

  listDue(nowMs: number): OrderRecord[] {
    return this.store.state.orders.filter(
      (o) => o.status !== 'delivered' && o.next_step_at <= nowMs,
    );
  }

  update(id: string, patch: Partial<OrderRecord>): void {
    const order = this.findById(id);
    if (!order) return;
    Object.assign(order, patch);
    this.store.markDirty();
  }
}
```

---

## api/src/data-store/repositories/outbox.repo.ts

```typescript
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
```

---

## api/src/data-store/repositories/postgres.repo.stub.ts

```typescript
// This file is a stub on purpose. The alpha runs on a JSON file
// (data/store.json, see ../store.service.ts) so the whole demo starts with
// zero native dependencies and runs on any machine that has Node. Nothing
// here is wired up or imported by the app.
//
// When Sprint moves past alpha, each *.repo.ts in this folder gets a
// Postgres implementation of the same repo-interfaces.ts contract
// (IOrdersRepo, ICouriersRepo, ILedgerRepo, IOutboxRepo, ...), and the
// modules swap StoreService based repos for these without touching
// controllers or services.
//
// Production DDL note, per the Sprint blueprint:
//
// create table merchants (
//   id            uuid primary key default gen_random_uuid(),
//   name          text not null,
//   type          text not null check (type in ('food','grocery','vape')),
//   age_restricted boolean not null default false,
//   lat           double precision not null,
//   lng           double precision not null,
//   created_at    timestamptz not null default now()
// );
//
// create table merchant_items (
//   id            uuid primary key default gen_random_uuid(),
//   merchant_id   uuid not null references merchants(id),
//   name          text not null,
//   price_bwp     numeric(10,2) not null
// );
//
// create table orders (
//   id              uuid primary key default gen_random_uuid(),
//   customer_id     uuid not null references users(id),
//   merchant_id     uuid not null references merchants(id),
//   total_bwp       numeric(10,2) not null,
//   payment_method  text not null,
//   address_enc     text not null, -- AES-256-GCM ciphertext, iv:tag:ciphertext
//   delivery_lat    double precision not null,
//   delivery_lng    double precision not null,
//   age_confirmed   boolean not null default false,
//   status          text not null,
//   courier_id      uuid references couriers(id),
//   eta_min         integer,
//   idempotency_key text not null,
//   created_at      timestamptz not null default now(),
//   unique (customer_id, idempotency_key)
// );
//
// create table order_items (
//   id          uuid primary key default gen_random_uuid(),
//   order_id    uuid not null references orders(id),
//   item_id     text not null,
//   name        text not null,
//   qty         integer not null,
//   price_bwp   numeric(10,2) not null
// );
//
// create table couriers (
//   id                  uuid primary key default gen_random_uuid(),
//   name                text not null,
//   status              text not null default 'offline',
//   rating              numeric(2,1) not null default 5.0,
//   earnings_today_bwp  numeric(10,2) not null default 0,
//   created_at          timestamptz not null default now()
// );
//
// create table courier_locations (
//   courier_id  uuid not null references couriers(id),
//   lat         double precision not null,
//   lng         double precision not null,
//   h3_cell     text not null,
//   recorded_at timestamptz not null default now(),
//   primary key (courier_id, recorded_at)
// );
//
// create table payments (
//   id              uuid primary key default gen_random_uuid(),
//   order_id        uuid not null references orders(id),
//   method          text not null,
//   status          text not null,
//   created_at      timestamptz not null default now()
// );
//
// create table ledger_entries (
//   id          uuid primary key default gen_random_uuid(),
//   order_id    uuid not null references orders(id),
//   account     text not null,
//   type        text not null check (type in ('debit','credit')),
//   amount_bwp  numeric(10,2) not null,
//   created_at  timestamptz not null default now()
// );
//
// create table events_outbox (
//   id          uuid primary key default gen_random_uuid(),
//   event       text not null,
//   order_id    uuid not null references orders(id),
//   payload     jsonb not null,
//   created_at  timestamptz not null default now(),
//   published_at timestamptz
// );
//
// Note: pins are argon2id since 13 Sep 2026, and phone /
// address encryption keys move from a .env value to a managed secret store
// (KMS backed), rotated on a schedule.

export {};
```

---

## api/src/data-store/repositories/users.repo.ts

```typescript
import { Injectable } from '@nestjs/common';
import { StoreService } from '../store.service';
import { UserRecord } from '../interfaces';
import { IUsersRepo } from '../repo-interfaces';
import { blindIndex } from '../../common/aes';

@Injectable()
export class UsersRepo implements IUsersRepo {
  constructor(private readonly store: StoreService) {}

  findByPhone(phone: string): UserRecord | undefined {
    const hash = blindIndex(phone);
    return this.store.state.users.find((u) => u.phone_hash === hash);
  }
}
```

---

## api/src/data-store/seed.ts

```typescript
import { hashSync, Algorithm } from '@node-rs/argon2';
import * as crypto from 'node:crypto';
import { encrypt, blindIndex } from '../common/aes';
import { WAYPOINTS } from '../common/waypoints';
import { StoreShape, UserRecord, MerchantRecord, CourierRecord } from './interfaces';

// Builds the fresh demo dataset described in the Sprint alpha contract:
// 3 demo login users, 4 merchants (food, grocery, vape, pharmacy) with
// realistic Pula pricing and delivery-app grade catalog imagery, and 5 named
// couriers wandering around Gaborone. Called once, the first time the API
// boots and data/store.json does not exist yet.
export function buildSeed(): StoreShape {
  const merchants: MerchantRecord[] = [
    {
      id: 'm1',
      name: "Mama T's Kitchen",
      type: 'food',
      age_restricted: false,
      lat: WAYPOINTS[1].lat + 0.002,
      lng: WAYPOINTS[1].lng - 0.001,
      heroImage: '/food/stew.jpg',
      rating: 4.7,
      ratingCount: 320,
      etaMinLow: 25,
      etaMinHigh: 40,
      deliveryFee: 12,
      promo: '20% off, up to P30',
      status: 'open',
      items: [
        {
          id: 'm1-i1',
          name: 'Seswaa and Pap',
          price_bwp: 55,
          photo: '/food/stew.jpg',
          description: 'Slow-cooked shredded beef with a mound of soft pap.',
        },
        {
          id: 'm1-i2',
          name: 'Chicken and Rice',
          price_bwp: 45,
          photo: '/food/curryrice.jpg',
          description: 'Spiced chicken pieces over fragrant rice.',
        },
        {
          id: 'm1-i3',
          name: 'Beef Stew Plate',
          price_bwp: 50,
          photo: '/food/beans.jpg',
          description: 'Hearty beef stew plate with a side of beans.',
        },
        {
          id: 'm1-i4',
          name: 'Vegetable Relish Plate',
          price_bwp: 35,
          photo: '/food/veg.jpg',
          description: 'Fresh seasonal vegetable relish, lightly spiced.',
        },
        {
          id: 'm1-i5',
          name: 'Grilled Chicken Quarter',
          price_bwp: 40,
          photo: '/food/friedrice.jpg',
          description: 'Chargrilled quarter chicken with a side of rice.',
        },
        {
          id: 'm1-i6',
          name: 'Bogobe with Sour Milk',
          price_bwp: 30,
          photo: '/food/bread2.jpg',
          description: 'Traditional sorghum porridge with cultured sour milk.',
        },
      ],
    },
    {
      id: 'm2',
      name: 'QuickMart Broadhurst',
      type: 'grocery',
      age_restricted: false,
      lat: WAYPOINTS[2].lat - 0.003,
      lng: WAYPOINTS[2].lng + 0.002,
      heroImage: '/food/grocery.jpg',
      rating: 3.9,
      ratingCount: 41,
      etaMinLow: 30,
      etaMinHigh: 50,
      deliveryFee: 15,
      promo: null,
      status: 'busy',
      items: [
        {
          id: 'm2-i1',
          name: 'White Bread 700g',
          price_bwp: 14,
          photo: '/food/bread.jpg',
          description: 'Fresh sliced white bread loaf, 700g.',
        },
        {
          id: 'm2-i2',
          name: 'Fresh Milk 1L',
          price_bwp: 18,
          photo: '/food/milk.jpg',
          description: 'Full cream fresh milk, 1 litre.',
        },
        {
          id: 'm2-i3',
          name: 'Eggs Tray of 30',
          price_bwp: 55,
          photo: '/food/grocery.jpg',
          description: 'Tray of 30 farm fresh eggs.',
        },
        {
          id: 'm2-i4',
          name: 'White Sugar 2kg',
          price_bwp: 32,
          photo: '/food/market.jpg',
          description: 'Refined white sugar, 2kg bag.',
        },
        {
          id: 'm2-i5',
          name: 'Cooking Oil 750ml',
          price_bwp: 28,
          photo: '/food/veg.jpg',
          description: 'Pure sunflower cooking oil, 750ml.',
        },
        {
          id: 'm2-i6',
          name: 'Maize Meal 10kg',
          price_bwp: 95,
          photo: '/food/beans.jpg',
          description: 'Coarse maize meal, 10kg bag, a kitchen staple.',
        },
      ],
    },
    {
      id: 'm3',
      name: 'CloudNine Vapes',
      type: 'vape',
      age_restricted: true,
      lat: WAYPOINTS[0].lat + 0.0015,
      lng: WAYPOINTS[0].lng + 0.0025,
      heroImage: '/food/market.jpg',
      rating: 4.2,
      ratingCount: 96,
      etaMinLow: 25,
      etaMinHigh: 45,
      deliveryFee: 18,
      promo: null,
      status: 'closed',
      items: [
        {
          id: 'm3-i1',
          name: 'Disposable Vape 2500 Puffs',
          price_bwp: 180,
          photo: '/food/market.jpg',
          description: 'Disposable vape device, approximately 2500 puffs.',
        },
        {
          id: 'm3-i2',
          name: 'Disposable Vape 5000 Puffs',
          price_bwp: 250,
          photo: '/food/grocery.jpg',
          description: 'Disposable vape device, approximately 5000 puffs.',
        },
        {
          id: 'm3-i3',
          name: 'Vape Juice 30ml',
          price_bwp: 120,
          photo: '/food/veg.jpg',
          description: 'E-liquid refill bottle, 30ml.',
        },
        {
          id: 'm3-i4',
          name: 'Replacement Coils 5 Pack',
          price_bwp: 90,
          photo: '/food/bread2.jpg',
          description: 'Pack of 5 replacement coils.',
        },
        {
          id: 'm3-i5',
          name: 'Starter Kit',
          price_bwp: 350,
          photo: '/food/beans.jpg',
          description: 'Complete starter kit with device and charger.',
        },
      ],
    },
    {
      id: 'm4',
      name: 'Kgale Pharmacy',
      type: 'pharmacy',
      age_restricted: false,
      lat: WAYPOINTS[3].lat + 0.001,
      lng: WAYPOINTS[3].lng - 0.0015,
      heroImage: '/food/pharmacy.jpg',
      rating: 4.8,
      ratingCount: 142,
      etaMinLow: 15,
      etaMinHigh: 30,
      deliveryFee: 10,
      promo: 'Free delivery on your first order',
      status: 'open',
      items: [
        {
          id: 'm4-i1',
          name: 'Paracetamol 500mg',
          price_bwp: 25,
          photo: '/food/pharmacy.jpg',
          description: 'Pack of 20 paracetamol tablets, 500mg.',
        },
        {
          id: 'm4-i2',
          name: 'Ibuprofen 200mg',
          price_bwp: 30,
          photo: '/food/pharmacy.jpg',
          description: 'Pack of 20 ibuprofen tablets, 200mg.',
        },
        {
          id: 'm4-i3',
          name: 'Multivitamin Tablets 30s',
          price_bwp: 65,
          photo: '/food/pharmacy.jpg',
          description: 'Daily multivitamin, 30 tablet pack.',
        },
        {
          id: 'm4-i4',
          name: 'Digital Thermometer',
          price_bwp: 85,
          photo: '/food/pharmacy.jpg',
          description: 'Fast-read digital body thermometer.',
        },
        {
          id: 'm4-i5',
          name: 'Hand Sanitizer 500ml',
          price_bwp: 35,
          photo: '/food/pharmacy.jpg',
          description: 'Alcohol-based hand sanitizer, 500ml pump bottle.',
        },
      ],
    },
  ];

  const courierNames = ['Kabelo', 'Tumi', 'Ofentse', 'Naledi', 'Thato'];
  // Fixed ratings and earnings: randomizing these on every reseed made the
  // demo data look synthetic (every courier 4.5+, different each restart).
  const courierRatings = [4.9, 4.6, 4.8, 4.3, 4.7];
  const courierEarnings = [86, 42, 110, 23, 67];
  const couriers: CourierRecord[] = courierNames.map((name, i) => {
    const wp = WAYPOINTS[i % WAYPOINTS.length];
    return {
      id: `c${i + 1}`,
      name,
      status: 'online',
      lat: wp.lat,
      lng: wp.lng,
      rating: courierRatings[i],
      earnings_today_bwp: courierEarnings[i],
      waypoint_target: (i + 1) % WAYPOINTS.length,
      move_target: null,
    };
  });

  function makeUser(name: string, role: 'customer' | 'courier' | 'ops', phone: string, courierId?: string): UserRecord {
    return {
      id: crypto.randomUUID(),
      name,
      role,
      phone_hash: blindIndex(phone),
      phone_enc: encrypt(phone),
      pin_hash: hashSync('1234', { algorithm: Algorithm.Argon2id }),
      courier_id: courierId,
    };
  }

  const users: UserRecord[] = [
    makeUser('Neo', 'customer', '71111111'),
    makeUser('Kabelo', 'courier', '72222222', 'c1'),
    makeUser('Amo', 'ops', '73333333'),
  ];

  return {
    users,
    merchants,
    couriers,
    orders: [],
    ledger_entries: [],
    events_outbox: [],
    idempotency: [],
    last_dispatch: null,
  };
}
```

---

## api/src/data-store/store.service.ts

```typescript
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildSeed } from './seed';
import { StoreShape } from './interfaces';

// The whole "database" for the alpha: one JSON file on disk, held in memory
// and flushed back down on a short timer. Repository classes (OrdersRepo,
// CouriersRepo, LedgerRepo, OutboxRepo, ...) read and write through this
// service so nothing else touches the filesystem directly. Swapping this out
// for real Postgres later means only rewriting the repositories against
// postgres.repo.stub.ts, the rest of the app stays the same.
@Injectable()
export class StoreService implements OnModuleInit, OnModuleDestroy {
  private data!: StoreShape;
  private dirty = false;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private readonly filePath = path.join(__dirname, '..', '..', 'data', 'store.json');

  onModuleInit(): void {
    this.load();
    this.flushTimer = setInterval(() => this.flush(), 2000);
  }

  onModuleDestroy(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flush();
  }

  private load(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(this.filePath)) {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      this.data = JSON.parse(raw) as StoreShape;
    } else {
      this.data = buildSeed();
      this.writeNow();
    }
  }

  private writeNow(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    this.dirty = false;
  }

  // Called constantly (courier position ticks). Marks the store dirty and
  // relies on the 2s timer to actually hit disk, so a busy simulator loop
  // does not turn into a write on every single tick.
  markDirty(): void {
    this.dirty = true;
  }

  // Called after anything a client is about to read back immediately
  // (order created, status changed) so a crash right after does not lose it.
  persist(): void {
    this.writeNow();
  }

  flush(): void {
    if (this.dirty) this.writeNow();
  }

  get state(): StoreShape {
    return this.data;
  }
}
```

---

## api/src/dispatch/dispatch.module.ts

```typescript
import { Module } from '@nestjs/common';
import { DispatchService } from './dispatch.service';
import { TrackingModule } from '../tracking/tracking.module';

@Module({
  imports: [TrackingModule],
  providers: [DispatchService],
  exports: [DispatchService],
})
export class DispatchModule {}
```

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

---

## api/src/orders/corporate.test.ts

```typescript
/**
 * Brick 35's proof. Run with:
 *   npm --prefix api run test:orders
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canOrder,
  statement,
  statementNumber,
  outstanding,
  health,
  pula,
  CorporateError,
  CorporateAccount,
  CorporateOrder,
} from './corporate';

const P = (n: number) => n * 100;

const ACCOUNT: CorporateAccount = {
  id: 'acc01',
  company: 'A Gaborone bank',
  billing_contact: 'Their accounts payable',
  billing_email: 'ap@example.co.bw',
  credit_limit: P(50000),
  payment_terms_days: 30,
  cost_centres: [
    { code: 'HO', name: 'Head office' },
    { code: 'BR12', name: 'Branch 12, Main Mall' },
    { code: 'CARDS', name: 'Card operations' },
  ],
  active: true,
};

const ORDERS: CorporateOrder[] = [
  { order_id: 'o1', account_id: 'acc01', cost_centre: 'HO', amount: P(136), placed_at: '2026-09-02T09:00:00.000Z', description: 'Documents to Francistown' },
  { order_id: 'o2', account_id: 'acc01', cost_centre: 'CARDS', amount: P(250), placed_at: '2026-09-05T11:00:00.000Z', description: 'Card stock to Maun' },
  { order_id: 'o3', account_id: 'acc01', cost_centre: 'HO', amount: P(87), placed_at: '2026-09-09T14:00:00.000Z', description: 'Envelope to Lobatse' },
  { order_id: 'o4', account_id: 'acc01', cost_centre: 'BR12', amount: P(163), placed_at: '2026-09-19T08:00:00.000Z', description: 'Branch pouch' },
  { order_id: 'x1', account_id: 'acc99', cost_centre: 'HO', amount: P(999), placed_at: '2026-09-03T09:00:00.000Z', description: 'Another company entirely' },
];

test('an order must say which cost centre it is for', () => {
  const r = canOrder(ACCOUNT, 0, P(100), 'NOPE');
  assert.equal(r.allowed, false);
  assert.match(r.says, /Choose which cost centre/);
  assert.match(r.says, /HO, BR12, CARDS/);
  assert.equal(canOrder(ACCOUNT, 0, P(100), 'HO').allowed, true);
});

test('the credit limit is checked when the order is placed, not at month end', () => {
  assert.equal(canOrder(ACCOUNT, P(49900), P(50), 'HO').allowed, true);
  const over = canOrder(ACCOUNT, P(49900), P(200), 'HO');
  assert.equal(over.allowed, false);
  assert.match(over.says, /past its limit/);
  assert.match(over.says, /P100.00 left/);
});

test('an account with no agreed limit gets no credit at all', () => {
  const noLimit = { ...ACCOUNT, credit_limit: 0 };
  const r = canOrder(noLimit, 0, P(50), 'HO');
  assert.equal(r.allowed, false);
  assert.match(r.says, /No credit limit has been agreed/);
});

test('an account on hold cannot order, and is told plainly', () => {
  const held = { ...ACCOUNT, active: false };
  const r = canOrder(held, 0, P(50), 'HO');
  assert.equal(r.allowed, false);
  assert.match(r.says, /on hold/);
  assert.equal(r.says.includes(' - '), false);
});

test('the month is split by cost centre, biggest first', () => {
  const s = statement(ACCOUNT, ORDERS, '2026-09-01T00:00:00.000Z', '2026-09-30T23:59:59.000Z');
  // CARDS is P250, HO is P136 plus P87 which is P223, BR12 is P163. Biggest first.
  assert.deepEqual(s.lines.map((l) => l.cost_centre), ['CARDS', 'HO', 'BR12']);
  const ho = s.lines.find((l) => l.cost_centre === 'HO')!;
  assert.equal(ho.orders, 2);
  assert.equal(ho.total, P(223));
  assert.equal(ho.cost_centre_name, 'Head office');
  assert.equal(s.total, P(136 + 250 + 87 + 163));
});

test('another company never appears on this invoice', () => {
  const s = statement(ACCOUNT, ORDERS, '2026-09-01T00:00:00.000Z', '2026-09-30T23:59:59.000Z');
  assert.equal(s.orders.some((o) => o.order_id === 'x1'), false);
  assert.equal(s.orders.length, 4);
});

test('only orders inside the period are billed', () => {
  const s = statement(ACCOUNT, ORDERS, '2026-09-01T00:00:00.000Z', '2026-09-10T23:59:59.000Z');
  assert.equal(s.orders.length, 3, 'o4 is on the 19th and belongs to the next run');
  assert.equal(s.total, P(136 + 250 + 87));
});

test('an order with no cost centre stops the invoice rather than hiding in it', () => {
  const withOrphan = [...ORDERS, {
    order_id: 'o5', account_id: 'acc01', cost_centre: 'GHOST',
    amount: P(100), placed_at: '2026-09-11T09:00:00.000Z', description: 'Nobody knows',
  }];
  assert.throws(
    () => statement(ACCOUNT, withOrphan, '2026-09-01T00:00:00.000Z', '2026-09-30T23:59:59.000Z'),
    /no cost centre on this account/,
  );
  try {
    statement(ACCOUNT, withOrphan, '2026-09-01T00:00:00.000Z', '2026-09-30T23:59:59.000Z');
  } catch (e: any) {
    assert.match(e.message, /o5/, 'it must name which order');
  }
});

test('nothing is ever added on top, because the prices already include it', () => {
  const s = statement(ACCOUNT, ORDERS, '2026-09-01T00:00:00.000Z', '2026-09-30T23:59:59.000Z');
  assert.equal(s.all_inclusive, true);
  assert.match(s.note, /already includes VAT and the fuel surcharge/);
  assert.equal(s.total, s.lines.reduce((a, l) => a + l.total, 0), 'the total is just the lines added up');
});

test('the invoice number can be read out on the phone and sorts by month', () => {
  assert.equal(statementNumber('acc01', '2026-09-01T00:00:00.000Z'), 'SPR-ACC01-202609');
  const months = ['2026-09-01', '2026-10-01', '2027-01-01'].map((m) => statementNumber('acc01', m));
  assert.deepEqual(months, [...months].sort());
});

test('payment terms set the due date', () => {
  const s = statement(ACCOUNT, ORDERS, '2026-09-01T00:00:00.000Z', '2026-09-30T00:00:00.000Z');
  assert.equal(s.due_date, '2026-10-30');
});

test('a period that ends before it starts is refused', () => {
  assert.throws(
    () => statement(ACCOUNT, ORDERS, '2026-09-30T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
    CorporateError,
  );
});

test('what is owed counts only this account and only what is unpaid', () => {
  assert.equal(outstanding(ORDERS, 'acc01'), P(136 + 250 + 87 + 163));
  assert.equal(outstanding(ORDERS, 'acc01', '2026-09-10T00:00:00.000Z'), P(163));
  assert.equal(outstanding(ORDERS, 'acc99'), P(999));
});

test('an account manager sees one line that says whether to worry', () => {
  assert.match(health(ACCOUNT, P(48000)), /96 percent of limit used, nearly blocked/);
  assert.match(health(ACCOUNT, P(38000)), /76 percent of limit used/);
  assert.match(health(ACCOUNT, P(500)), /P500.00 owed of P50000.00/);
  assert.match(health({ ...ACCOUNT, active: false }, 0), /on hold/);
  for (const line of [health(ACCOUNT, P(500)), health(ACCOUNT, P(48000))]) {
    assert.equal(line.includes(' - '), false, 'no dashes in anything a person reads');
  }
});

test('money is shown to the cent, never rounded in the customer favour or ours', () => {
  assert.equal(pula(P(136)), 'P136.00');
  assert.equal(pula(13650), 'P136.50');
});
```

---

## api/src/orders/corporate.ts

```typescript
/**
 * Brick 35. Corporate accounts.
 *
 * This is where the money already is. The banks and the land boards are on contract today and they
 * do not pay per delivery with a card at a gate. They order against an account, they split the cost
 * across their own cost centres, and finance pays one invoice a month.
 *
 * Neither Wanzy nor Zebras can do this at all, and it is the whole reason the app is worth building
 * for an incumbent rather than a startup. A consumer app that cannot invoice a bank is a consumer
 * app. This file is the difference.
 *
 * Three rules, each learned from how these accounts actually go wrong:
 *
 *   1. EVERY ORDER CARRIES A COST CENTRE. A corporate customer whose invoice cannot be split by
 *      department will not pay it, they will query it, and the query takes longer than the delivery.
 *   2. THE CREDIT LIMIT IS CHECKED WHEN THE ORDER IS PLACED, not when the invoice is raised. A
 *      limit discovered at month end is a limit that was never a limit.
 *   3. PRICES ARE ALREADY ALL INCLUSIVE. The domestic tariff includes VAT and the fuel surcharge,
 *      so an invoice that adds either on top double charges the customer. That is how a bank stops
 *      trusting a supplier.
 */

export interface CostCentre {
  code: string;
  name: string;
}

export interface CorporateAccount {
  id: string;
  company: string;
  /** Who at the company approves the bill. Never the same person who places orders. */
  billing_contact: string;
  billing_email: string;
  /** In thebe. Zero means no limit was agreed, which is treated as no credit at all. */
  credit_limit: number;
  payment_terms_days: number;
  cost_centres: CostCentre[];
  active: boolean;
}

export interface CorporateOrder {
  order_id: string;
  account_id: string;
  cost_centre: string;
  /** In thebe, all inclusive. */
  amount: number;
  placed_at: string;
  description: string;
}

export class CorporateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CorporateError';
  }
}

export function pula(thebe: number): string {
  return `P${(thebe / 100).toFixed(2)}`;
}

/** Can this account place this order right now. Checked at order time, never at invoice time. */
export function canOrder(
  account: CorporateAccount,
  outstanding: number,
  amount: number,
  costCentre: string,
): { allowed: boolean; says: string } {
  if (!account.active) {
    return { allowed: false, says: `The ${account.company} account is on hold. Please speak to your account manager.` };
  }
  if (!account.cost_centres.some((c) => c.code === costCentre)) {
    const codes = account.cost_centres.map((c) => c.code).join(', ');
    return { allowed: false, says: `Choose which cost centre this is for. Yours are ${codes}.` };
  }
  if (account.credit_limit <= 0) {
    return { allowed: false, says: `No credit limit has been agreed for ${account.company} yet.` };
  }
  if (outstanding + amount > account.credit_limit) {
    const room = Math.max(0, account.credit_limit - outstanding);
    return {
      allowed: false,
      says: `This would take ${account.company} past its limit of ${pula(account.credit_limit)}. There is ${pula(room)} left.`,
    };
  }
  return { allowed: true, says: 'Charged to the account' };
}

export interface StatementLine {
  cost_centre: string;
  cost_centre_name: string;
  orders: number;
  total: number;
}

export interface Statement {
  account: string;
  company: string;
  number: string;
  period_from: string;
  period_to: string;
  due_date: string;
  lines: StatementLine[];
  orders: CorporateOrder[];
  total: number;
  all_inclusive: true;
  note: string;
}

/** Invoice numbers a person can read out over the phone, and that sort in order. */
export function statementNumber(accountId: string, periodFrom: string): string {
  const d = new Date(periodFrom);
  const ym = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return `SPR-${accountId.toUpperCase()}-${ym}`;
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * One month, split the way the customer's own finance team needs to see it. Refuses rather than
 * quietly dropping an order whose cost centre was never set, because a missing line is the thing
 * that gets an invoice queried.
 */
export function statement(
  account: CorporateAccount,
  orders: CorporateOrder[],
  periodFrom: string,
  periodTo: string,
): Statement {
  const mine = orders.filter((o) => o.account_id === account.id);
  const from = Date.parse(periodFrom);
  const to = Date.parse(periodTo);
  if (!(to > from)) throw new CorporateError('The period must end after it starts.');

  const inPeriod = mine.filter((o) => {
    const t = Date.parse(o.placed_at);
    return t >= from && t <= to;
  });

  const known = new Map(account.cost_centres.map((c) => [c.code, c.name]));
  const orphan = inPeriod.filter((o) => !known.has(o.cost_centre));
  if (orphan.length) {
    throw new CorporateError(
      `${orphan.length} order${orphan.length === 1 ? '' : 's'} have no cost centre on this account ` +
        `(${orphan.map((o) => o.order_id).join(', ')}). Fix them before invoicing, or the customer will query it.`,
    );
  }

  const byCentre = new Map<string, StatementLine>();
  for (const o of inPeriod) {
    const line = byCentre.get(o.cost_centre) ?? {
      cost_centre: o.cost_centre,
      cost_centre_name: known.get(o.cost_centre) as string,
      orders: 0,
      total: 0,
    };
    line.orders += 1;
    line.total += o.amount;
    byCentre.set(o.cost_centre, line);
  }

  const lines = [...byCentre.values()].sort((a, b) => b.total - a.total);
  const total = lines.reduce((a, l) => a + l.total, 0);

  return {
    account: account.id,
    company: account.company,
    number: statementNumber(account.id, periodFrom),
    period_from: periodFrom.slice(0, 10),
    period_to: periodTo.slice(0, 10),
    due_date: addDays(periodTo, account.payment_terms_days),
    lines,
    orders: inPeriod.sort((a, b) => a.placed_at.localeCompare(b.placed_at)),
    total,
    all_inclusive: true,
    note: 'Every amount already includes VAT and the fuel surcharge. Nothing is added on top.',
  };
}

/** What the account owes right now, for the limit check on the next order. */
export function outstanding(orders: CorporateOrder[], accountId: string, paidUpTo?: string): number {
  const cutoff = paidUpTo ? Date.parse(paidUpTo) : -Infinity;
  return orders
    .filter((o) => o.account_id === accountId && Date.parse(o.placed_at) > cutoff)
    .reduce((a, o) => a + o.amount, 0);
}

/** The one line an account manager needs to see on a list of accounts. */
export function health(account: CorporateAccount, owed: number): string {
  if (!account.active) return `${account.company}: on hold`;
  if (account.credit_limit <= 0) return `${account.company}: no limit agreed`;
  const pct = Math.round((owed / account.credit_limit) * 100);
  if (pct >= 90) return `${account.company}: ${pct} percent of limit used, nearly blocked`;
  if (pct >= 70) return `${account.company}: ${pct} percent of limit used`;
  return `${account.company}: ${pula(owed)} owed of ${pula(account.credit_limit)}`;
}
```

---

## api/src/orders/dto.ts

```typescript
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
```

---

## api/src/orders/handover.test.ts

```typescript
/**
 * Brick 21's proof. Run with:
 *   npm --prefix api run test:orders
 *
 * The tests that matter most are the ones about what is NOT stored. A proof of delivery that
 * quietly collects identity numbers is a breach waiting to be discovered.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  requirementFor,
  makeCode,
  checkCode,
  record,
  evidence,
  whatExpires,
  HandoverError,
  CODE_LENGTH,
  CODE_MAX_ATTEMPTS,
  PHOTO_RETENTION_DAYS,
} from './handover';

const ok = {
  order_id: 'o1',
  courier_id: 'courier_amo',
  photo_ref: 'pod/o1.jpg',
  photo_of: 'parcel' as const,
  at: '2026-09-13T10:00:00.000Z',
};
const goodId = { document: 'omang' as const, name_matched: true, old_enough: true };

test('an ordinary parcel needs a photograph and nothing more', () => {
  assert.deepEqual(requirementFor('ordinary').needs, ['photo']);
  const h = record({ ...ok, sensitivity: 'ordinary' });
  assert.equal(h.photo_of, 'parcel');
  assert.equal(h.identity, null);
});

test('liquor needs a document checked, a prescription needs the code as well', () => {
  assert.deepEqual(requirementFor('liquor').needs, ['photo', 'identity']);
  assert.deepEqual(requirementFor('prescription').needs, ['photo', 'code', 'identity']);
});

test('no delivery is recorded without a photograph', () => {
  assert.throws(() => record({ ...ok, photo_ref: null, sensitivity: 'ordinary' }), /needs a photograph/);
});

test('the photograph must be of the parcel, never of the customer', () => {
  assert.throws(
    () => record({ ...ok, photo_of: 'person', sensitivity: 'ordinary' }),
    /must be of the parcel, never of the customer/,
  );
  assert.throws(() => record({ ...ok, photo_of: null, sensitivity: 'ordinary' }), /Say what the photograph shows/);
});

test('liquor cannot be handed over with no document checked', () => {
  assert.throws(() => record({ ...ok, sensitivity: 'liquor' }), /No check was recorded/);
  const h = record({ ...ok, sensitivity: 'liquor', identity: goodId });
  assert.equal(h.identity?.checked_by, 'courier_amo');
});

test('a name that does not match, or somebody too young, stops the handover', () => {
  assert.throws(
    () => record({ ...ok, sensitivity: 'liquor', identity: { ...goodId, name_matched: false } }),
    /does not match the order/,
  );
  assert.throws(
    () => record({ ...ok, sensitivity: 'liquor', identity: { ...goodId, old_enough: false } }),
    /not old enough/,
  );
});

test('a prescription needs the code as well as the document', () => {
  assert.throws(
    () => record({ ...ok, sensitivity: 'prescription', identity: goodId }),
    /needs the code from the customer app/,
  );
  const h = record({ ...ok, sensitivity: 'prescription', identity: goodId, code_verified: true });
  assert.equal(h.code_verified, true);
  assert.match(h.says, /document and code both checked/);
});

test('an ordinary parcel must not carry an identity check it never needed', () => {
  assert.throws(
    () => record({ ...ok, sensitivity: 'ordinary', identity: goodId }),
    /must not have an identity check recorded/,
  );
});

test('an identity NUMBER is never stored, only that the check passed', () => {
  const h = record({ ...ok, sensitivity: 'liquor', identity: goodId, received_by_name: 'Neo Kgosi' });
  // Everything except the timestamp, which is legitimately full of digits and is not user input.
  const { at, ...rest } = h;
  const asText = JSON.stringify(rest);
  assert.equal(/\d{7,}/.test(asText.replace(/[\s-]/g, '')), false, 'something long and numeric got stored');
  assert.deepEqual(Object.keys(h.identity!).sort(), ['checked_by', 'document', 'name_matched', 'old_enough']);
  assert.equal('number' in h.identity!, false);
  assert.equal('date_of_birth' in h.identity!, false);
});

test('a rider typing an identity number into the name is refused', () => {
  assert.throws(
    () => record({ ...ok, sensitivity: 'liquor', identity: goodId, received_by_name: '123456789' }),
    /Record the name only, never the number/,
  );
  assert.throws(
    () => record({ ...ok, sensitivity: 'liquor', identity: goodId, received_by_name: 'Neo 12345 6789' }),
    /never the number/,
  );
  assert.doesNotThrow(() => record({ ...ok, sensitivity: 'liquor', identity: goodId, received_by_name: 'Neo Kgosi' }));
});

test('the code is short enough to read out at a gate', () => {
  const code = makeCode(() => 0.42);
  assert.equal(code.length, CODE_LENGTH);
  assert.match(code, /^\d+$/);
});

test('three wrong codes and it locks rather than letting anyone keep guessing', () => {
  let attempts = 0;
  for (let i = 0; i < CODE_MAX_ATTEMPTS - 1; i++) {
    const r = checkCode('1234', '0000', attempts);
    assert.equal(r.ok, false);
    assert.equal(r.locked, false);
    attempts = r.attempts;
  }
  const last = checkCode('1234', '0000', attempts);
  assert.equal(last.locked, true);
  assert.match(last.says, /call the office/);
  const after = checkCode('1234', '1234', last.attempts);
  assert.equal(after.ok, false, 'a locked code must not open on the right answer either');
});

test('the right code matches, and spacing around it does not matter', () => {
  assert.equal(checkCode('1234', '1234', 0).ok, true);
  assert.equal(checkCode('1234', ' 1234 ', 0).ok, true);
  assert.equal(checkCode('', '', 0).ok, false, 'an empty expected code must never match');
});

test('what a dispute is shown says the number was never recorded', () => {
  const h = record({ ...ok, sensitivity: 'prescription', identity: goodId, code_verified: true, received_by_name: 'Neo Kgosi' });
  const e = evidence(h);
  assert.match(e.identity, /never recorded/);
  assert.match(e.proof, /photograph of the parcel/);
  assert.equal(e.code, 'the customer read out the code from their app');
  assert.equal(/\d{7,}/.test(JSON.stringify(e)), false);
});

test('the photograph dies at ninety days and the record at two years', () => {
  const h = record({ ...ok, sensitivity: 'liquor', identity: goodId });
  assert.deepEqual(whatExpires(h, '2026-10-01T10:00:00.000Z'), [], 'nothing goes in the first month');
  assert.deepEqual(whatExpires(h, '2027-01-01T10:00:00.000Z'), ['photo'], `the photo should go after ${PHOTO_RETENTION_DAYS} days`);
  const old = whatExpires(h, '2029-01-01T10:00:00.000Z');
  assert.ok(old.includes('identity') && old.includes('whole_record'));
});

test('every message a person reads is plain and has no dashes', () => {
  const messages = [
    requirementFor('ordinary').says,
    requirementFor('liquor').says,
    requirementFor('prescription').says,
    checkCode('1234', '9999', 0).says,
    record({ ...ok, sensitivity: 'ordinary' }).says,
  ];
  for (const m of messages) {
    assert.ok(m.length > 10, 'a message should say something');
    assert.equal(m.includes(' - '), false, `dash in: ${m}`);
  }
});
```

---

## api/src/orders/handover.ts

```typescript
/**
 * Brick 21. Proof at the door.
 *
 * Every handover leaves a record. For most orders that is a photograph of the parcel where it
 * was left. For liquor and for a prescription it is more, because the law and the pharmacist
 * both need to know the goods reached an adult, and the right one.
 *
 * The fault model at docs/FAULT_MODEL.md leans on this. When a customer disputes a delivery,
 * the answer is whatever was recorded here at the time, by the person standing there. When an
 * identity check fails, the order goes back and the customer carries the delivery fee, and that
 * is only defensible if the check was recorded properly.
 *
 * Three rules come from the data protection assessment and are enforced by the shape of the
 * code rather than by anybody remembering them:
 *
 *   1. AN IDENTITY NUMBER IS NEVER STORED. The rider looks at the document and records that the
 *      name matched and the person is old enough. The number itself is never typed, so it can
 *      never leak, never be subpoenaed and never sit in a backup.
 *   2. THE PHOTOGRAPH IS OF THE PARCEL, NOT THE PERSON. The rider must say which, and a handover
 *      photographed with a person in it is refused.
 *   3. EVERYTHING HAS A DEATH DATE. Photographs at 90 days, identity checks at two years.
 */

export type Sensitivity = 'ordinary' | 'liquor' | 'prescription';

export type ProofKind =
  /** A photograph of the parcel at the door. The floor for every delivery. */
  | 'photo'
  /** The customer reads out the code from their app. Proves it reached the right person. */
  | 'code'
  /** The rider sees a document, checks the name and the age, and records neither number. */
  | 'identity';

export interface HandoverRequirement {
  needs: ProofKind[];
  says: string;
}

export interface IdentityCheck {
  /** What kind of document was shown. Never which one, never its number. */
  document: 'omang' | 'passport' | 'drivers_licence';
  /** Did the name on it match the name on the order. */
  name_matched: boolean;
  /** Is the person old enough. The rider answers yes or no, never types a birth date. */
  old_enough: boolean;
}

export interface Handover {
  order_id: string;
  courier_id: string;
  at: string;
  sensitivity: Sensitivity;
  photo_ref: string | null;
  /** What the photograph is of. A person is refused. */
  photo_of: 'parcel' | null;
  code_verified: boolean;
  identity: (IdentityCheck & { checked_by: string }) | null;
  received_by_name: string | null;
  says: string;
}

export class HandoverError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HandoverError';
  }
}

export const PHOTO_RETENTION_DAYS = 90;
export const IDENTITY_RETENTION_DAYS = 730;
export const CODE_LENGTH = 4;
export const CODE_MAX_ATTEMPTS = 3;

// Named for what it DETECTS, not what it stores. Nothing here ever holds an identity number.
const LOOKS_LIKE_AN_ID = /\d{7,}/;

/** What this order needs before it can be handed over. */
export function requirementFor(sensitivity: Sensitivity): HandoverRequirement {
  switch (sensitivity) {
    case 'prescription':
      return {
        needs: ['photo', 'code', 'identity'],
        says: 'A prescription goes only to the patient, so the rider checks a document and the code',
      };
    case 'liquor':
      return {
        needs: ['photo', 'identity'],
        says: 'Liquor goes only to an adult, so the rider checks a document',
      };
    default:
      return { needs: ['photo'], says: 'A photograph of the parcel where it was left' };
  }
}

/** The code the customer reads out. Digits only, because it is read aloud at a gate. */
export function makeCode(random: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += Math.floor(random() * 10).toString();
  return out;
}

export function checkCode(
  expected: string,
  given: string,
  attemptsSoFar: number,
): { ok: boolean; attempts: number; locked: boolean; says: string } {
  const attempts = attemptsSoFar + 1;
  if (attemptsSoFar >= CODE_MAX_ATTEMPTS) {
    return { ok: false, attempts: attemptsSoFar, locked: true, says: 'Too many tries, call the office' };
  }
  const ok = expected.length > 0 && expected === given.trim();
  const locked = !ok && attempts >= CODE_MAX_ATTEMPTS;
  return {
    ok,
    attempts,
    locked,
    says: ok
      ? 'Code matched'
      : locked
        ? 'Too many tries, call the office'
        : `That code does not match, ${CODE_MAX_ATTEMPTS - attempts} tries left`,
  };
}

/**
 * Record the handover. Refuses rather than recording something half done, because a proof with
 * a hole in it is worse than none: it looks like evidence and is not.
 */
export function record(input: {
  order_id: string;
  courier_id: string;
  sensitivity: Sensitivity;
  photo_ref?: string | null;
  photo_of?: 'parcel' | 'person' | null;
  code_verified?: boolean;
  identity?: IdentityCheck | null;
  received_by_name?: string | null;
  at?: string;
}): Handover {
  const req = requirementFor(input.sensitivity);
  if (!input.courier_id) throw new HandoverError('A handover must name the rider who made it.');

  if (req.needs.includes('photo')) {
    if (!input.photo_ref) {
      throw new HandoverError('Every delivery needs a photograph of the parcel at the door.');
    }
    if (input.photo_of === 'person') {
      throw new HandoverError(
        'The photograph must be of the parcel, never of the customer. Take it again showing the parcel where it was left.',
      );
    }
    if (input.photo_of !== 'parcel') {
      throw new HandoverError('Say what the photograph shows. It must be the parcel.');
    }
  }

  if (req.needs.includes('code') && !input.code_verified) {
    throw new HandoverError('This one needs the code from the customer app before it can be handed over.');
  }

  if (req.needs.includes('identity')) {
    const id = input.identity;
    if (!id) throw new HandoverError(`${req.says}. No check was recorded.`);
    if (!id.name_matched) {
      throw new HandoverError('The name on the document does not match the order. This cannot be handed over.');
    }
    if (!id.old_enough) {
      throw new HandoverError('The person is not old enough for this order. This cannot be handed over.');
    }
  } else if (input.identity) {
    throw new HandoverError('An ordinary parcel must not have an identity check recorded against it.');
  }

  const name = (input.received_by_name ?? '').trim() || null;
  if (name && LOOKS_LIKE_AN_ID.test(name.replace(/[\s-]/g, ''))) {
    throw new HandoverError('That looks like an identity number. Record the name only, never the number.');
  }

  return {
    order_id: input.order_id,
    courier_id: input.courier_id,
    at: input.at ?? new Date().toISOString(),
    sensitivity: input.sensitivity,
    photo_ref: input.photo_ref ?? null,
    photo_of: req.needs.includes('photo') ? 'parcel' : null,
    code_verified: Boolean(input.code_verified),
    identity: input.identity ? { ...input.identity, checked_by: input.courier_id } : null,
    received_by_name: name,
    says: describe(input.sensitivity, name),
  };
}

function describe(sensitivity: Sensitivity, name: string | null): string {
  const who = name ? `to ${name}` : 'at the door';
  if (sensitivity === 'prescription') return `Prescription handed ${who}, document and code both checked`;
  if (sensitivity === 'liquor') return `Liquor handed ${who}, document checked`;
  return `Delivered ${who}, photographed`;
}

/** What a dispute or a regulator is shown. Never more than this. */
export function evidence(h: Handover): Record<string, string> {
  const out: Record<string, string> = {
    order: h.order_id,
    when: h.at,
    rider: h.courier_id,
    proof: h.photo_ref ? 'photograph of the parcel at the door' : 'none',
    summary: h.says,
  };
  if (h.identity) {
    out.identity = `${h.identity.document} seen by ${h.identity.checked_by}, name matched, old enough. The number was never recorded.`;
  }
  if (h.code_verified) out.code = 'the customer read out the code from their app';
  return out;
}

/** Retention, from the data protection assessment. Returns what must go, not what may stay. */
export function whatExpires(h: Handover, nowISO?: string): Array<'photo' | 'identity' | 'whole_record'> {
  const now = nowISO ? Date.parse(nowISO) : Date.now();
  const age = (now - Date.parse(h.at)) / 86_400_000;
  const gone: Array<'photo' | 'identity' | 'whole_record'> = [];
  if (h.photo_ref && age > PHOTO_RETENTION_DAYS) gone.push('photo');
  if (h.identity && age > IDENTITY_RETENTION_DAYS) gone.push('identity');
  if (age > IDENTITY_RETENTION_DAYS) gone.push('whole_record');
  return gone;
}
```

---

## api/src/orders/liquor.test.ts

```typescript
/**
 * Brick 26's proof. Run with:
 *   npm --prefix api run test:orders
 *
 * The first test is the one that matters legally. No licence on file means no liquor moves, and
 * that is the default rather than something somebody has to remember to switch on.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mayHandOver,
  latestArrivalToday,
  daysLeft,
  expiringSoon,
  checkLicenceRecord,
  parseTime,
  hhmm,
  LiquorError,
  EXPIRY_WARNING_DAYS,
  LiquorLicence,
} from './liquor';

const T = (s: string) => parseTime(s);

const LICENCE: LiquorLicence = {
  number: 'LL/GAB/0447',
  holder: 'A licensed bottle store',
  premises: 'Plot 5310, Gaborone West',
  hours: {
    mon: { from: T('10:00'), to: T('20:00') },
    tue: { from: T('10:00'), to: T('20:00') },
    wed: { from: T('10:00'), to: T('20:00') },
    thu: { from: T('10:00'), to: T('20:00') },
    fri: { from: T('10:00'), to: T('22:00') },
    sat: { from: T('10:00'), to: T('22:00') },
    // Sunday is deliberately absent. A day with no entry is a day it may not trade.
  },
  expires: '2027-03-31',
  source: 'Copy of the licence supplied by the merchant, filed 13 September 2026',
};

// 2026-09-14 is a Monday, 2026-09-20 is a Sunday.
const MON = (t: string) => `2026-09-14T${t}:00.000Z`;
const SUN = (t: string) => `2026-09-20T${t}:00.000Z`;
const FRI = (t: string) => `2026-09-18T${t}:00.000Z`;

test('with no licence on file, nothing moves, and that is the default', () => {
  const v = mayHandOver(null, MON('12:00'));
  assert.equal(v.allowed, false);
  assert.equal(v.reason, 'no_licence');
  assert.match(v.says, /No liquor licence is on file/);
});

test('inside the hours on the licence it is allowed, and the door check is still named', () => {
  const v = mayHandOver(LICENCE, MON('12:00'));
  assert.equal(v.allowed, true);
  assert.equal(v.reason, 'ok');
  assert.match(v.says, /LL\/GAB\/0447/);
  assert.match(v.says, /still checks a document at the door/);
});

test('the time that matters is when it ARRIVES, not when it was ordered', () => {
  // Ordered at five to eight, arriving half past. The licence ends at eight.
  const late = mayHandOver(LICENCE, MON('20:30'));
  assert.equal(late.allowed, false);
  assert.equal(late.reason, 'outside_hours');
  assert.match(late.says, /would arrive at 20:30/);
  assert.match(late.says, /between 10:00 and 20:00/);
  assert.equal(mayHandOver(LICENCE, MON('19:59')).allowed, true);
  assert.equal(mayHandOver(LICENCE, MON('20:00')).allowed, true, 'the closing minute itself is inside');
  assert.equal(mayHandOver(LICENCE, MON('20:01')).allowed, false);
});

test('too early is refused as firmly as too late', () => {
  assert.equal(mayHandOver(LICENCE, MON('09:59')).allowed, false);
  assert.equal(mayHandOver(LICENCE, MON('10:00')).allowed, true);
});

test('a day the licence does not cover is closed, not merely out of hours', () => {
  const v = mayHandOver(LICENCE, SUN('12:00'));
  assert.equal(v.allowed, false);
  assert.equal(v.reason, 'closed_today');
  assert.match(v.says, /does not permit trading on a Sunday/);
});

test('different days can have different hours, and Friday runs later here', () => {
  assert.equal(mayHandOver(LICENCE, FRI('21:30')).allowed, true);
  assert.equal(mayHandOver(LICENCE, MON('21:30')).allowed, false);
});

test('an expired licence switches the merchant off with no argument', () => {
  const old = { ...LICENCE, expires: '2026-09-01' };
  const v = mayHandOver(old, MON('12:00'));
  assert.equal(v.allowed, false);
  assert.equal(v.reason, 'expired');
  assert.match(v.says, /expired on 2026-09-01/);
  assert.equal(mayHandOver({ ...LICENCE, expires: '2026-09-14' }, MON('12:00')).allowed, true,
    'the expiry day itself is still valid');
});

test('a customer is told the last time they can be promised today, before they pay', () => {
  assert.equal(latestArrivalToday(LICENCE, MON('11:00')), '2026-09-14T20:00:00.000Z');
  assert.equal(latestArrivalToday(LICENCE, FRI('11:00')), '2026-09-18T22:00:00.000Z');
  assert.equal(latestArrivalToday(LICENCE, SUN('11:00')), null, 'nothing can be promised on a closed day');
});

test('the director question: what runs out inside sixty days', () => {
  const soon = { ...LICENCE, number: 'LL/GAB/0001', holder: 'A shop nearly out of time', expires: '2026-10-20' };
  const gone = { ...LICENCE, number: 'LL/GAB/0002', holder: 'A shop already out of time', expires: '2026-08-30' };
  const fine = LICENCE;
  const list = expiringSoon([fine, soon, gone], MON('09:00'));
  assert.equal(list.length, 2, 'only the two inside the window');
  assert.equal(list[0].licence.number, 'LL/GAB/0002', 'the expired one is first');
  assert.match(list[0].says, /EXPIRED 15 days ago/);
  assert.match(list[1].says, /runs out in 36 days/);
  assert.ok(daysLeft(fine, MON('09:00')) > EXPIRY_WARNING_DAYS);
});

test('a half filled licence record is listed as incomplete rather than trusted', () => {
  assert.deepEqual(checkLicenceRecord(LICENCE), []);
  const missing = checkLicenceRecord({ number: 'LL/1', holder: 'Someone' });
  assert.ok(missing.includes('the premises it covers'));
  assert.ok(missing.includes('the expiry date'));
  assert.ok(missing.includes('the permitted hours, copied off the licence'));
  assert.ok(missing.includes('where the copy on file came from'));
  assert.deepEqual(checkLicenceRecord({}).length > 4, true);
});

test('a time that is not a time is refused rather than guessed at', () => {
  assert.throws(() => parseTime('half eight'), LiquorError);
  assert.throws(() => parseTime('25:00'), /not a real time/);
  assert.throws(() => parseTime('10:70'), /not a real time/);
  assert.equal(parseTime('09:30'), 570);
  assert.equal(hhmm(570), '09:30');
  assert.equal(hhmm(1320), '22:00');
});

test('every line a person reads is plain and has no dashes', () => {
  const lines = [
    mayHandOver(null, MON('12:00')).says,
    mayHandOver(LICENCE, MON('12:00')).says,
    mayHandOver(LICENCE, SUN('12:00')).says,
    mayHandOver(LICENCE, MON('20:30')).says,
    mayHandOver({ ...LICENCE, expires: '2026-09-01' }, MON('12:00')).says,
  ];
  for (const l of lines) {
    assert.ok(l.length > 15);
    assert.equal(l.includes(' - '), false, `dash in: ${l}`);
  }
});
```

---

## api/src/orders/liquor.ts

```typescript
/**
 * Brick 26. Liquor.
 *
 * A deliberate decision sits at the top of this file. **The app does not know the law, and does not
 * pretend to.** Botswana's Trade Act repealed the old Trade and Liquor Act, the liquor statute that
 * replaced it is not on this machine, and a trading hour invented by a delivery company is a
 * criminal offence waiting to happen.
 *
 * So the rule is the merchant's own licence. Every liquor licence names its holder, its premises,
 * the hours it permits and the day it expires. The app holds a copy of that licence and enforces
 * exactly what it says, nothing more and nothing less. If no licence is on file, no liquor moves.
 * That is both safer and more correct than any national constant, because hours differ by licence
 * type and by premises.
 *
 * The insight that makes this different from a shop till: **the time that matters is the HANDOVER,
 * not the order.** A customer ordering at five to eight for a delivery that arrives at half past is
 * a breach of the licence, and the person holding the bottle at the door is Sprint's rider. So the
 * check is run against when it will actually arrive.
 *
 * Age is checked at the door by brick 21, which refuses a handover without a document. Nothing here
 * duplicates that; this file decides whether the order may exist at all.
 */

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export const WEEKDAYS: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** Minutes from midnight. A closed day is simply absent from the map. */
export interface Hours {
  from: number;
  to: number;
}

export interface LiquorLicence {
  /** As printed on the licence. Quoted back to a customer or an inspector. */
  number: string;
  holder: string;
  premises: string;
  /** Copied off the licence itself, per day. A day with no entry is a day it may not trade. */
  hours: Partial<Record<Weekday, Hours>>;
  /** ISO date. The app stops selling the day after this, with no argument. */
  expires: string;
  /** Where the copy on file came from, so nobody has to wonder. */
  source: string;
}

export class LiquorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LiquorError';
  }
}

/** A licence inside this many days is flagged to the office, which is the director sweep question. */
export const EXPIRY_WARNING_DAYS = 60;

export function hhmm(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

export function parseTime(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) throw new LiquorError(`${s} is not a time. Use 24 hour clock, like 10:00 or 20:30.`);
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) throw new LiquorError(`${s} is not a real time.`);
  return h * 60 + mi;
}

function dayOf(iso: string): Weekday {
  return WEEKDAYS[new Date(iso).getUTCDay()];
}

function minutesOf(iso: string): number {
  const d = new Date(iso);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export interface Verdict {
  allowed: boolean;
  says: string;
  /** For the ops board. Nothing here is a guess about the law, only about this licence. */
  reason: 'no_licence' | 'expired' | 'closed_today' | 'outside_hours' | 'ok';
}

/**
 * May this merchant hand liquor over at this moment. Pass the time the order will ARRIVE, not the
 * time it was placed.
 */
export function mayHandOver(licence: LiquorLicence | null, arrivesAtISO: string): Verdict {
  if (!licence) {
    return {
      allowed: false,
      reason: 'no_licence',
      says: 'No liquor licence is on file for this shop, so Sprint cannot carry liquor for them.',
    };
  }
  const arrives = Date.parse(arrivesAtISO);
  if (Number.isNaN(arrives)) throw new LiquorError('The arrival time is not a real time.');

  const expiresEnd = Date.parse(licence.expires + 'T23:59:59Z');
  if (arrives > expiresEnd) {
    return {
      allowed: false,
      reason: 'expired',
      says: `Licence ${licence.number} expired on ${licence.expires}. Nothing may be carried for them until it is renewed.`,
    };
  }

  const day = dayOf(arrivesAtISO);
  const window = licence.hours[day];
  if (!window) {
    return {
      allowed: false,
      reason: 'closed_today',
      says: `Licence ${licence.number} does not permit trading on a ${longDay(day)}.`,
    };
  }

  const at = minutesOf(arrivesAtISO);
  if (at < window.from || at > window.to) {
    return {
      allowed: false,
      reason: 'outside_hours',
      says: `It would arrive at ${hhmm(at)}, and licence ${licence.number} permits ${longDay(day)} only between ${hhmm(window.from)} and ${hhmm(window.to)}.`,
    };
  }

  return {
    allowed: true,
    reason: 'ok',
    says: `Arriving ${hhmm(at)}, inside the hours on licence ${licence.number}. The rider still checks a document at the door.`,
  };
}

function longDay(d: Weekday): string {
  return { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' }[d];
}

/**
 * The last moment an order can be promised for today, so a customer is told before they pay rather
 * than after. Null when the shop may not trade today at all.
 */
export function latestArrivalToday(licence: LiquorLicence, nowISO: string): string | null {
  const day = dayOf(nowISO);
  const w = licence.hours[day];
  if (!w) return null;
  const d = new Date(nowISO);
  d.setUTCHours(Math.floor(w.to / 60), w.to % 60, 0, 0);
  return d.toISOString();
}

/** Days until this licence runs out. Negative once it has. */
export function daysLeft(licence: LiquorLicence, nowISO?: string): number {
  const now = nowISO ? Date.parse(nowISO) : Date.now();
  return Math.floor((Date.parse(licence.expires + 'T23:59:59Z') - now) / 86_400_000);
}

/** The director sweep question: what is running out inside sixty days. */
export function expiringSoon(licences: LiquorLicence[], nowISO?: string): Array<{ licence: LiquorLicence; days: number; says: string }> {
  return licences
    .map((l) => ({ licence: l, days: daysLeft(l, nowISO) }))
    .filter((x) => x.days <= EXPIRY_WARNING_DAYS)
    .sort((a, b) => a.days - b.days)
    .map((x) => ({
      ...x,
      says: x.days < 0
        ? `${x.licence.holder} licence ${x.licence.number} EXPIRED ${Math.abs(x.days)} days ago. They are switched off.`
        : `${x.licence.holder} licence ${x.licence.number} runs out in ${x.days} days.`,
    }));
}

/** Check a licence record is complete enough to rely on, before it is trusted with anything. */
export function checkLicenceRecord(l: Partial<LiquorLicence>): string[] {
  const missing: string[] = [];
  if (!l.number) missing.push('the licence number');
  if (!l.holder) missing.push('who holds it');
  if (!l.premises) missing.push('the premises it covers');
  if (!l.expires || !/^\d{4}-\d{2}-\d{2}$/.test(l.expires)) missing.push('the expiry date');
  if (!l.hours || Object.keys(l.hours).length === 0) missing.push('the permitted hours, copied off the licence');
  if (!l.source) missing.push('where the copy on file came from');
  return missing;
}
```

---

## api/src/orders/money_models.test.ts

```typescript
/**
 * Two money models live in this codebase and they disagree. This file holds that
 * fact still so nobody has to rediscover it.
 *
 * Found 15 September 2026 while checking the settlement rules, after the P200
 * cash ceiling had already shown that a number can sit under passing tests for
 * weeks and still be wrong.
 *
 *   settlement.ts        pays a merchant 100 percent of the goods on a delivered
 *                        order, and Sprint keeps only the delivery fee.
 *   ledger.repo.ts       splits the same order 75 percent merchant, 18 percent
 *                        courier, the remainder to Sprint.
 *
 * Only the first one decides what anybody is paid. The second feeds the
 * simulator and nothing else. Neither is policy: docs/FAULT_MODEL.md still says
 * "Status: proposed. Not yet agreed by Barbara."
 *
 * These tests do not pick a winner. That is Barbara's decision and Luther's.
 * They make sure the disagreement cannot be forgotten, cannot drift, and cannot
 * quietly become the thing that pays real merchants.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settleOne, dayPayout, readyToPay, type SettleableOrder } from './settlement';
import { SIMULATOR_SPLIT } from '../data-store/repositories/ledger.repo';

const order = (over: Partial<SettleableOrder> = {}): SettleableOrder => ({
  order_id: 'SPR-1',
  merchant_id: 'M1',
  merchant_name: 'Broadhurst Hardware',
  goods: 20000, // P200
  delivery_fee: 2500, // P25
  rail: 'cash',
  fault: 'none',
  delivered: true,
  perishable: false,
  ...over,
});

test('SETTLEMENT TAKES NO COMMISSION: a delivered order pays the merchant every thebe of the goods', () => {
  const s = settleOne(order());
  assert.equal(s.merchant, 20000, 'the merchant is paid the goods in full');
  assert.equal(s.sprint_fee, 2500, 'Sprint keeps only the delivery fee');
  assert.equal(s.merchant + s.sprint_fee, 22500);
});

test('so Sprint earns the delivery fee and nothing else on the basket', () => {
  const s = settleOne(order({ goods: 500000 })); // a P5000 basket
  assert.equal(s.sprint_fee, 2500, 'a twenty five times bigger basket earns Sprint the same P25');
  assert.equal(s.merchant, 500000);
});

test('THE OTHER MODEL DISAGREES, and it is marked as not agreed', () => {
  assert.equal(SIMULATOR_SPLIT.agreed, false, 'this became policy without anybody saying so');
  assert.equal(SIMULATOR_SPLIT.merchant, 0.75);
  assert.equal(SIMULATOR_SPLIT.courier, 0.18);
  assert.match(SIMULATOR_SPLIT.contradicts, /100 percent/);
});

test('the two models really do disagree, by a quarter of every basket', () => {
  const o = order();
  const bySettlement = settleOne(o).merchant;
  const byLedger = Math.round(o.goods * SIMULATOR_SPLIT.merchant);
  assert.notEqual(bySettlement, byLedger);
  assert.equal(bySettlement - byLedger, 5000, 'P50 on a P200 basket, every time');
});

test('nothing can be paid to anybody until Barbara agrees the fault model', () => {
  const day = dayPayout('2026-09-15', [order()], false);
  const verdict = readyToPay(day);
  assert.equal(verdict.ready, false);
  assert.match(verdict.says, /still a proposal|Barbara/);
});

test('and the day total says so on its face, not in a footnote', () => {
  const day = dayPayout('2026-09-15', [order()], false);
  assert.match(day.says, /NOT PAYABLE/);
});

test('even once agreed, the day only pays what the rules worked out', () => {
  const agreed = dayPayout('2026-09-15', [order()], true);
  assert.equal(readyToPay(agreed).ready, true);
  assert.equal(agreed.total, 20000, 'the merchant is owed the goods in full, no commission taken');
});

test('a fault that is nobody s does not quietly punish the merchant', () => {
  const s = settleOne(order({ delivered: false, fault: 'none', perishable: true }));
  assert.equal(s.perishable_loss, 20000, 'goods that cannot go back on a shelf are covered');
  assert.equal(s.sprint_fee, 0, 'Sprint does not charge for a delivery that did not happen');
});

test('when Sprint is at fault, Sprint carries it, including the fee it did not earn', () => {
  const s = settleOne(order({ delivered: false, fault: 'sprint', perishable: true }));
  assert.equal(s.sprint_absorbs, 20000 + 2500);
  assert.equal(s.merchant, 0);
});
```

---

## api/src/orders/network.test.ts

```typescript
/**
 * Brick 17's proof. Run with:
 *   npm --prefix api run test:orders
 *
 * The numbers below are not invented. They come from the company profile, read on 12 September
 * 2026. If one of these fails, either the profile changed or somebody edited the network file, and
 * both are worth stopping for.
 *
 * The last four tests exist because the FIRST read of this profile was wrong and every test here
 * passed anyway. The branch pages print in two columns, the read took them as flowing text, and
 * Kanye's address, phone and email ended up under Commerce Park while Kanye vanished. Nothing asked
 * whether each address belonged to the branch above it. Now something does.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allSites,
  offices,
  servicePoints,
  internationalSites,
  routeTo,
  placesCovered,
  contactFor,
  reachLine,
  coverageClaim,
  provenance,
  incompleteSites,
  branchClaim,
  checkEmailsMatchBranches,
  unresolvedSites,
  NetworkError,
} from './network';

test('the network is the real one, read out of the company profile', () => {
  const p = provenance();
  assert.match(p.document, /Profile/);
  assert.match(p.method, /never from memory/i, 'case insensitive: this exact trap already cost a brick once');
  assert.equal(allSites().length, 57, 'fifty seven sites in Botswana with a printed address');
  assert.equal(offices().length, 30);
  assert.equal(servicePoints().length, 27);
  assert.equal(internationalSites().length, 3);
});

test('the reach line quotes the profile instead of a rounded number nobody can source', () => {
  const line = reachLine();
  assert.match(line, /30 offices and 27 service points/);
  assert.match(coverageClaim(), /more than 50 towns/);
  assert.match(coverageClaim(), /over 75 sites/);
  assert.match(branchClaim(), /over 50 branches/, "the profile's own branch words, page 2");
  assert.equal(/55 branches/.test(line), false, 'the unsourced figure must not come back');
});

test('a real town routes to a real office with a real address', () => {
  const maun = routeTo('Maun');
  assert.equal(maun.covered, true);
  assert.equal(maun.has_office, true);
  assert.ok(maun.site);
  assert.match(maun.says, /Maun/);
  const fran = routeTo('Francistown');
  assert.equal(fran.has_office, true);
  assert.ok(fran.site!.phones.length > 0, 'a customer must be able to ring it');
});

test('a service point is named as a service point, not dressed up as an office', () => {
  const t = routeTo('Tlokweng');
  assert.equal(t.covered, true);
  assert.equal(t.has_office, false);
  assert.match(t.says, /service point/);
});

test('somewhere Sprint does not go is refused, never promised', () => {
  const v = routeTo('Timbuktu');
  assert.equal(v.covered, false);
  assert.equal(v.site, null);
  assert.match(v.says, /does not list Timbuktu/);
  assert.match(v.says, /Ask the office before quoting it/);
});

test('a place on a route with no branch is carried there, and says so honestly', () => {
  const onRoute = placesCovered().find((p) => {
    const r = routeTo(p);
    return r.covered && !r.site;
  });
  if (onRoute) {
    const r = routeTo(onRoute);
    assert.match(r.says, /carried there rather than collected there/);
  }
});

test('an empty destination is refused rather than matched to something', () => {
  assert.throws(() => routeTo('   '), NetworkError);
  assert.throws(() => routeTo(''), /needs somewhere to go/);
});

test('case and spacing do not decide whether we deliver somewhere', () => {
  for (const v of ['maun', 'MAUN', '  Maun  ']) {
    assert.equal(routeTo(v).covered, true, `${v} should route`);
  }
});

test('the place picker can only offer places on the network', () => {
  const places = placesCovered();
  assert.ok(places.length > 50);
  assert.equal(places.includes('Timbuktu'), false);
  assert.deepEqual(places, [...places].sort((a, b) => a.localeCompare(b)), 'sorted for a picker');
  assert.equal(new Set(places).size, places.length, 'no duplicates');
});

test('a customer can be told exactly who has their parcel', () => {
  const c = contactFor('Kasane');
  assert.ok(c);
  assert.ok(c!.phones.length > 0);
  assert.match(c!.says, /Call Kasane on/);
  assert.equal(contactFor('Timbuktu'), null);
});

test('every site can actually be reached by somebody', () => {
  for (const s of allSites()) {
    assert.ok(s.phones.length > 0 || s.email, `${s.name} has no phone and no email`);
    assert.ok(s.address.length > 5, `${s.name} has no usable address`);
  }
});

test('thin site records are listed rather than quietly trusted', () => {
  const thin = incompleteSites();
  // Service points legitimately have no email. What matters is that the list is honest.
  for (const t of thin) {
    assert.ok(t.missing.length > 0);
    assert.equal(t.missing.includes('an address'), false, `${t.name} has no address, which is not usable`);
  }
});

test('every line a person reads is plain and has no dashes', () => {
  const lines = [reachLine(), routeTo('Maun').says, routeTo('Timbuktu').says, routeTo('Tlokweng').says];
  for (const l of lines) {
    assert.ok(l.length > 15);
    assert.equal(l.includes(' - '), false, `dash in: ${l}`);
  }
});

test('no branch carries another branch email, which is how the column shift showed itself', () => {
  assert.deepEqual(checkEmailsMatchBranches(), [],
    'an email whose name is not the branch name means the name column slid against the address column');
});

test('Kanye is back, and Commerce Park has its own address again', () => {
  const kanye = routeTo('Kanye');
  assert.equal(kanye.covered, true, 'a whole Sprint office was missing from the app');
  assert.match(kanye.site!.address, /Motlhala Ward/);
  assert.equal(kanye.site!.email, 'office@example.com');

  const cp = routeTo('Commerce Park');
  assert.match(cp.site!.address, /Commerce Park/, 'it had been given Kanye address, 85 km away');
  assert.equal(cp.site!.email, 'office@example.com');
  assert.notEqual(cp.site!.address, kanye.site!.address);
});

test('the three branches dropped by the first read are all on the network', () => {
  for (const place of ['BDF SSKB Camp', 'Letlhakeng', 'Shoshong']) {
    assert.equal(routeTo(place).covered, true, `${place} is a real Sprint site and was missing`);
  }
});

test('no place name is two towns glued together off the map drawing', () => {
  const realTwoWord = new Set(['Charles Hill', 'Selibe Phikwe', 'Pitsane Molopo',
    'Commerce Park', 'BDF SSKB Camp', 'Main Mall', 'Rail Park', 'Bus Rank',
    'Francistown Warehouse', 'Francistown Express', 'Francistown Donga Express',
    'Maun Express', 'Maun Warehouse', 'Selibe Phikwe']);
  for (const p of placesCovered()) {
    if (p.includes(' ') && !realTwoWord.has(p)) {
      assert.fail(`"${p}" reads like two map labels glued together, the way Bobonong Gabojango was`);
    }
  }
});

test('a branch with no address is never offered as a place to collect from', () => {
  const open = unresolvedSites();
  assert.ok(open.length > 0, 'the profile does leave one Ramotswa heading without an address');
  for (const u of open) {
    assert.match(u.why, /Owner: Barbara/, 'an open question needs a name against it');
    assert.equal(allSites().some((s) => s.name === u.name && !s.address), false);
  }
  const r = routeTo('Ramotswa');
  assert.ok(r.site!.address, 'the Ramotswa that does have an address is the one used');
});
```

---

## api/src/orders/network.ts

```typescript
/**
 * Brick 17. Dispatch on the real network.
 *
 * The demo dispatched to three invented riders. This dispatches to the offices Sprint actually has,
 * read out of the company profile with their real addresses, phone numbers and email. Fifty seven
 * sites in Botswana and three in South Africa, and not one of them was typed from memory.
 *
 * **REBUILT 12 September 2026, and the reason matters more than the fix.** The branch pages print in
 * TWO COLUMNS. The first read took them as flowing text, which paired every branch name with the
 * NEXT branch's address. Kanye's address, phone and email were printed under Commerce Park, so a
 * customer told their parcel was at Commerce Park would have been sent 85 km down the road. Kanye,
 * BDF SSKB Camp, Letlhakeng and Shoshong were missing from the app entirely. And the coverage page
 * is a MAP, not a list, so neighbouring town labels had been glued into places that do not exist,
 * like "Bobonong Gabojango", while the real towns behind them were refused. The truth test passed
 * all of it, because every check asked whether the file existed and none asked whether each address
 * belonged to the branch above it. `checkEmailsMatchBranches()` is that missing question.
 *
 * **A correction to a correction.** The frame page says "55 branches" and the profile does not. But
 * the profile DOES say "over 50 branches" on page 2, which is the defensible line, and counting the
 * branch pages gives 60 sites with a printed address. So the number to use is the profile's own.
 *
 * **What this deliberately does not do.** The profile gives names and addresses, not coordinates.
 * So there is no distance here, no nearest office by kilometres, and no drive time. Inventing those
 * would be inventing the thing that decides whether a delivery is promised for today. A place that
 * is not on the network is REFUSED, not guessed at, exactly as a weight with no contract price is.
 */

import net from './network-sites.json';

export type SiteKind = 'office' | 'service_point';

export interface Site {
  name: string;
  kind: SiteKind;
  address: string;
  phones: string[];
  email: string | null;
  international: boolean;
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

const SITES: Site[] = (net.sites as Site[]);
const MAP_TOWNS: string[] = (net.towns_on_the_coverage_map as string[]);

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
}

export function allSites(): Site[] {
  return SITES.filter((s) => !s.international);
}

export function offices(): Site[] {
  return allSites().filter((s) => s.kind === 'office');
}

export function servicePoints(): Site[] {
  return allSites().filter((s) => s.kind === 'service_point');
}

export function internationalSites(): Site[] {
  return SITES.filter((s) => s.international);
}

/** The profile's own words about reach. Never a rounded number of our own. */
export function coverageClaim(): string {
  return (net.coverage_claim as string) ?? 'not stated in the profile';
}

/** The profile's own branch count. Page 2 says over 50. It never says 55. */
export function branchClaim(): string {
  return (net.branch_claim as string) ?? 'not stated in the profile';
}

/**
 * The guard that would have caught the column shift on the day it happened.
 *
 * Sprint gives most branches an email named after the branch, so `kanye@` belongs to Kanye. If a
 * future read of the profile ever slides the name column against the address column again, an
 * email will land on the wrong branch and this returns it. Three pairings in the profile are
 * genuinely shared and are named here rather than quietly excused.
 */
const EMAIL_BY_DESIGN: Record<string, string> = {
  Head: 'info',
  'Francistown Warehouse': 'frwexpress',
  'Francistown Express': 'frwexpress',
  'Maun Express': 'mubexpress',
};

export function checkEmailsMatchBranches(): Array<{ name: string; email: string }> {
  const slug = (x: string) => x.toLowerCase().replace(/[^a-z]/g, '');
  return SITES.filter((s) => {
    if (!s.email) return false;
    const local = s.email.split('@')[0];
    if (EMAIL_BY_DESIGN[s.name] === local) return false;
    return !slug(local).includes(slug(s.name)) && !slug(s.name).includes(slug(local));
  }).map((s) => ({ name: s.name, email: s.email as string }));
}

/**
 * Branches the profile names but does not give an address for. They are never offered as a place to
 * collect from, because sending somebody to a branch that may not exist is worse than saying so.
 */
export function unresolvedSites(): Array<{ name: string; phones: string[]; why: string }> {
  return (net.unresolved as Array<{ name: string; phones: string[]; why: string }>) ?? [];
}

/** Where this came from, for anyone who asks, including an MD. */
export function provenance(): typeof net._source {
  return net._source;
}

export interface Routing {
  covered: boolean;
  /** The site that would handle it, when there is one. */
  site: Site | null;
  /** True only when a full office sits there, not merely a service point. */
  has_office: boolean;
  says: string;
}

/**
 * Which site handles a delivery to this place. Matches the office name, then the places the profile
 * lists as covered. Anything else is refused rather than promised.
 */
export function routeTo(place: string): Routing {
  const want = norm(place);
  if (!want) throw new NetworkError('A delivery needs somewhere to go.');

  const exact = allSites().find((s) => norm(s.name) === want);
  if (exact) {
    return {
      covered: true,
      site: exact,
      has_office: exact.kind === 'office',
      says: exact.kind === 'office'
        ? `Handled by the ${exact.name} office, ${exact.address}.`
        : `Handled by the ${exact.name} service point, ${exact.address}.`,
    };
  }

  // The name is inside a site name, as with a place that has an express or warehouse branch.
  const partial = allSites().find((s) => norm(s.name).includes(want) || want.includes(norm(s.name)));
  if (partial) {
    return {
      covered: true,
      site: partial,
      has_office: partial.kind === 'office',
      says: `Handled by ${partial.name}, ${partial.address}.`,
    };
  }

  // On a route the profile lists, but with no site of its own. It is carried, not collected there.
  const onRoute = MAP_TOWNS.find((p) => norm(p) === want);
  if (onRoute) {
    return {
      covered: true,
      site: null,
      has_office: false,
      says: `${onRoute} is named on Sprint's own coverage map but has no branch of its own, so it is carried there rather than collected there. The map is a drawing rather than a printed list, so the office confirms before this is promised to a customer.`,
    };
  }

  return {
    covered: false,
    site: null,
    has_office: false,
    says: `Sprint does not list ${place.trim()} on its network, so nothing can be promised there. Ask the office before quoting it.`,
  };
}

/** Everywhere the profile names, for a place picker that cannot offer somewhere we do not go. */
export function placesCovered(): string[] {
  const fromSites = allSites().map((s) => s.name);
  return [...new Set([...fromSites, ...MAP_TOWNS])].sort((a, b) => a.localeCompare(b));
}

/** Who a customer rings about a parcel sitting at a branch. */
export function contactFor(place: string): { phones: string[]; email: string | null; says: string } | null {
  const r = routeTo(place);
  if (!r.site) return null;
  return {
    phones: r.site.phones,
    email: r.site.email,
    says: r.site.phones.length
      ? `Call ${r.site.name} on ${r.site.phones[0]}`
      : `Write to ${r.site.email ?? 'the head office'}`,
  };
}

/** The one line a pitch or an MD pack may use about reach, sourced rather than rounded. */
export function reachLine(): string {
  const o = offices().length, sp = servicePoints().length, intl = internationalSites().length;
  return `${o} offices and ${sp} service points in Botswana, plus ${intl} in South Africa. The company profile calls it ${branchClaim()} and describes the reach as ${coverageClaim()}.`;
}

/** A site record that is too thin to dispatch on. Named rather than silently trusted. */
export function incompleteSites(): Array<{ name: string; missing: string[] }> {
  return allSites()
    .map((s) => {
      const missing: string[] = [];
      if (!s.address || s.address.length < 6) missing.push('an address');
      if (!s.phones.length) missing.push('a phone number');
      if (!s.email) missing.push('an email');
      return { name: s.name, missing };
    })
    .filter((x) => x.missing.length > 0);
}
```

---

## api/src/orders/offline.test.ts

```typescript
/**
 * Brick 33's offline proof. Run with:
 *   npm --prefix api run test:orders
 *
 * The first test is the one that matters. A rider's phone may lose signal, run out of battery or
 * be replaced, and not one fact about money or evidence may disappear because of it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  queue,
  sync,
  sendOrder,
  remaining,
  whoWins,
  riderStatus,
  mustKeep,
  isPrecious,
  OfflineError,
  GIVE_UP_AFTER,
  QueuedAction,
} from './offline';

const act = (id: string, kind: any, order_id: string, at: string): Omit<QueuedAction, 'attempts' | 'last_error'> =>
  ({ id, kind, order_id, happened_at: at, payload: {} });

const ok = () => 'sent' as const;
const dead = () => { throw new Error('no route to host'); };

test('nothing is ever dropped, whatever the server says', () => {
  const box = [
    act('a1', 'handover', 'o1', '2026-09-13T10:00:00Z'),
    act('a2', 'cash_collected', 'o1', '2026-09-13T10:01:00Z'),
  ].reduce(queue, [] as QueuedAction[]);

  const refused = sync(box, () => 'needs_a_person');
  assert.equal(refused.sent.length, 0);
  assert.equal(refused.needs_a_person.length + refused.still_waiting.length, 2, 'both must still exist somewhere');
  assert.equal(remaining(refused).length, 2, 'and both are still on the phone');

  const broken = sync(box, dead);
  assert.equal(remaining(broken).length, 2);
});

test('no signal means everything waits, and the rider is told nothing is lost', () => {
  const box = [act('a1', 'handover', 'o1', '2026-09-13T10:00:00Z')].reduce(queue, [] as QueuedAction[]);
  const r = sync(box, ok, false);
  assert.equal(r.still_waiting.length, 1);
  assert.equal(r.sent.length, 0);
  assert.match(r.says, /nothing lost/);
  assert.match(riderStatus(box, false), /go when you have signal/);
});

test('an action sent twice is recognised, not repeated', () => {
  let box: QueuedAction[] = [];
  box = queue(box, act('a1', 'cash_collected', 'o1', '2026-09-13T10:00:00Z'));
  box = queue(box, act('a1', 'cash_collected', 'o1', '2026-09-13T10:00:00Z'));
  assert.equal(box.length, 1, 'queueing the same id twice must not double it');

  const r = sync(box, () => 'already_known');
  assert.equal(r.already_known.length, 1);
  assert.equal(r.sent.length, 0);
  assert.equal(remaining(r).length, 0, 'the office already had it, so the phone can let it go');
});

test('every action must carry an id and the time it actually happened', () => {
  assert.throws(() => queue([], { id: '', kind: 'handover', order_id: 'o1', happened_at: 'x', payload: {} } as any), OfflineError);
  assert.throws(() => queue([], { id: 'a1', kind: 'handover', order_id: 'o1', happened_at: '', payload: {} } as any), /when it happened/);
});

test('for one order things go in the right order, whatever order they were queued in', () => {
  const box = [
    act('a3', 'cash_collected', 'o1', '2026-09-13T10:02:00Z'),
    act('a1', 'handover', 'o1', '2026-09-13T10:01:00Z'),
    act('a2', 'address_confirmed', 'o1', '2026-09-13T10:00:00Z'),
  ].reduce(queue, [] as QueuedAction[]);
  assert.deepEqual(sendOrder(box).map((a) => a.kind), ['address_confirmed', 'handover', 'cash_collected']);
});

test('this morning delivery is not stuck behind this afternoon one', () => {
  const box = [
    act('b1', 'handover', 'o2', '2026-09-13T15:00:00Z'),
    act('a1', 'handover', 'o1', '2026-09-13T08:00:00Z'),
  ].reduce(queue, [] as QueuedAction[]);
  assert.deepEqual(sendOrder(box).map((a) => a.order_id), ['o1', 'o2']);
});

test('when one thing for an order will not go, nothing later for it jumps ahead', () => {
  const box = [
    act('a1', 'handover', 'o1', '2026-09-13T10:00:00Z'),
    act('a2', 'cash_collected', 'o1', '2026-09-13T10:01:00Z'),
    act('b1', 'handover', 'o2', '2026-09-13T11:00:00Z'),
  ].reduce(queue, [] as QueuedAction[]);
  const r = sync(box, (a) => { if (a.id === 'a1') throw new Error('server said no'); return 'sent'; });
  assert.equal(r.sent.length, 1, 'the other order still goes');
  assert.equal(r.sent[0].order_id, 'o2');
  assert.equal(r.still_waiting.some((a) => a.id === 'a2'), true, 'the cash must not arrive before the handover');
});

test('after enough failed tries it stops retrying and asks a person, still holding the action', () => {
  let box = [act('a1', 'handover', 'o1', '2026-09-13T10:00:00Z')].reduce(queue, [] as QueuedAction[]);
  for (let i = 0; i < GIVE_UP_AFTER; i++) {
    const r = sync(box, dead);
    box = remaining(r);
  }
  assert.equal(box.length, 1, 'it is still there');
  assert.equal(box[0].attempts >= GIVE_UP_AFTER, true);
  const last = sync(box, dead);
  assert.equal(last.needs_a_person.length + last.still_waiting.length, 1);
  assert.match(riderStatus(box, true), /Call the office, nothing is lost/);
});

test('a failure says what actually went wrong, not that something went wrong', () => {
  const box = [act('a1', 'handover', 'o1', '2026-09-13T10:00:00Z')].reduce(queue, [] as QueuedAction[]);
  const r = sync(box, () => { throw new Error('the battery died mid send'); });
  assert.match(r.still_waiting[0].last_error!, /battery died/);
});

test('money and evidence are marked so a full phone can never bin them', () => {
  assert.equal(isPrecious('handover'), true);
  assert.equal(isPrecious('cash_collected'), true);
  assert.equal(isPrecious('cold_box_reading'), true);
  assert.equal(isPrecious('address_confirmed'), false);
  const box = [
    act('a1', 'handover', 'o1', '2026-09-13T10:00:00Z'),
    act('a2', 'address_confirmed', 'o1', '2026-09-13T10:00:00Z'),
  ].reduce(queue, [] as QueuedAction[]);
  assert.deepEqual(mustKeep(box).map((a) => a.id), ['a1']);
});

test('the person who was actually there wins, except about dispatch', () => {
  assert.equal(whoWins('handover'), 'the rider');
  assert.equal(whoWins('cash_collected'), 'the rider');
  assert.equal(whoWins('address_confirmed'), 'the rider');
  assert.equal(whoWins('state_move'), 'the office');
});

test('the rider screen never says something vague', () => {
  assert.equal(riderStatus([], true), 'Everything is up to date');
  const box = [
    act('a1', 'handover', 'o1', '2026-09-13T10:00:00Z'),
    act('a2', 'address_confirmed', 'o1', '2026-09-13T10:00:00Z'),
  ].reduce(queue, [] as QueuedAction[]);
  const line = riderStatus(box, false);
  assert.match(line, /2 waiting to send/);
  assert.match(line, /including 1 about money or proof/);
  for (const l of [line, riderStatus([], true), riderStatus(box, true)]) {
    assert.equal(l.includes(' - '), false, `dash in: ${l}`);
  }
});

test('a whole day of work syncs in one go when the signal comes back', () => {
  let box: QueuedAction[] = [];
  for (let i = 1; i <= 12; i++) {
    box = queue(box, act(`h${i}`, 'handover', `o${i}`, `2026-09-13T${String(8 + i).padStart(2, '0')}:00:00Z`));
    box = queue(box, act(`c${i}`, 'cash_collected', `o${i}`, `2026-09-13T${String(8 + i).padStart(2, '0')}:05:00Z`));
  }
  assert.equal(box.length, 24);
  const r = sync(box, ok);
  assert.equal(r.sent.length, 24);
  assert.equal(remaining(r).length, 0);
  assert.match(r.says, /24 sent/);
});
```

---

## api/src/orders/offline.ts

```typescript
/**
 * Brick 33, the offline half. What a rider's phone does when there is no signal.
 *
 * Large parts of this country have no coverage, and a rider does not stop working because a bar
 * disappeared. They still hand the parcel over, still take the cash, still photograph the door.
 * Every one of those is a fact about money or evidence, and none of them may be lost because a
 * phone could not reach a server at that moment.
 *
 * So the phone keeps its own outbox and the rules are deliberately unforgiving:
 *
 *   1. NOTHING IS EVER DROPPED. Not when the queue is full, not when the server refuses it, not
 *      when it looks like a duplicate. An action that cannot be applied goes to a pile a person
 *      looks at. The bin does not exist.
 *   2. EVERY ACTION CARRIES ITS OWN ID, made on the phone. Sending twice must not pay twice or
 *      deliver twice. The server keeps the id and the second send is recognised, not repeated.
 *   3. ORDER IS KEPT PER ORDER. Picked up before handed over, always, whatever order the network
 *      happens to let through.
 *   4. THE PERSON WHO WAS THERE WINS. If the phone and the server disagree about a handover, the
 *      rider was standing at the door and the office was not. Dispatch decisions are the other way
 *      round, because the office can see every rider and the rider can see one.
 */

export type ActionKind =
  | 'handover'
  | 'cash_collected'
  | 'address_confirmed'
  | 'address_not_found'
  | 'state_move'
  | 'cold_box_reading';

export interface QueuedAction {
  /** Made on the phone, never by the server. This is what stops a double send being a double pay. */
  id: string;
  kind: ActionKind;
  order_id: string;
  /** When it happened, not when it was sent. The difference is the whole point. */
  happened_at: string;
  payload: Record<string, unknown>;
  attempts: number;
  last_error: string | null;
}

export type Outcome = 'sent' | 'already_known' | 'needs_a_person';

export interface SyncResult {
  sent: QueuedAction[];
  already_known: QueuedAction[];
  needs_a_person: Array<QueuedAction & { why: string }>;
  still_waiting: QueuedAction[];
  says: string;
}

export class OfflineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OfflineError';
  }
}

/** After this many failed sends an action stops being retried and a person is asked. */
export const GIVE_UP_AFTER = 5;

/** Actions about money or evidence. These are never discarded, whatever else happens. */
const PRECIOUS: ActionKind[] = ['handover', 'cash_collected', 'cold_box_reading'];

/** The order things must be applied in for one order. Lower happens first. */
const SEQUENCE: Record<ActionKind, number> = {
  address_confirmed: 1,
  address_not_found: 1,
  state_move: 2,
  cold_box_reading: 3,
  handover: 4,
  cash_collected: 5,
};

export function isPrecious(kind: ActionKind): boolean {
  return PRECIOUS.includes(kind);
}

export function queue(
  outbox: QueuedAction[],
  action: Omit<QueuedAction, 'attempts' | 'last_error'>,
): QueuedAction[] {
  if (!action.id) throw new OfflineError('Every action needs an id made on the phone.');
  if (!action.happened_at) throw new OfflineError('Every action must say when it happened, not when it was sent.');
  if (outbox.some((a) => a.id === action.id)) return outbox; // queueing twice is not an error
  return [...outbox, { ...action, attempts: 0, last_error: null }];
}

/**
 * The order to send things in. Per order, the sequence above; between orders, oldest first, so a
 * delivery from this morning is not stuck behind one from this afternoon.
 */
export function sendOrder(outbox: QueuedAction[]): QueuedAction[] {
  return [...outbox].sort((a, b) => {
    if (a.order_id !== b.order_id) return a.happened_at.localeCompare(b.happened_at);
    const s = SEQUENCE[a.kind] - SEQUENCE[b.kind];
    return s !== 0 ? s : a.happened_at.localeCompare(b.happened_at);
  });
}

/**
 * Try to send. `send` is whatever actually talks to the server; it returns an outcome or throws.
 * Nothing here decides to discard anything, because nothing here is allowed to.
 */
export function sync(
  outbox: QueuedAction[],
  send: (a: QueuedAction) => Outcome,
  online = true,
): SyncResult {
  if (!online) {
    return {
      sent: [], already_known: [], needs_a_person: [], still_waiting: outbox,
      says: outbox.length
        ? `No signal. ${outbox.length} thing${outbox.length === 1 ? '' : 's'} waiting, nothing lost.`
        : 'No signal, and nothing waiting.',
    };
  }

  const sent: QueuedAction[] = [];
  const known: QueuedAction[] = [];
  const stuck: Array<QueuedAction & { why: string }> = [];
  const waiting: QueuedAction[] = [];
  const blocked = new Set<string>();

  for (const a of sendOrder(outbox)) {
    // If something earlier for this order could not go, nothing later for it may jump ahead.
    if (blocked.has(a.order_id)) {
      waiting.push(a);
      continue;
    }
    let outcome: Outcome;
    try {
      outcome = send(a);
    } catch (e: any) {
      const attempts = a.attempts + 1;
      const failed = { ...a, attempts, last_error: String(e?.message ?? e) };
      blocked.add(a.order_id);
      if (attempts >= GIVE_UP_AFTER) {
        stuck.push({ ...failed, why: `Tried ${attempts} times and it will not go. Last reason: ${failed.last_error}` });
      } else {
        waiting.push(failed);
      }
      continue;
    }
    if (outcome === 'sent') sent.push(a);
    else if (outcome === 'already_known') known.push(a);
    else {
      blocked.add(a.order_id);
      stuck.push({ ...a, why: 'The office could not accept this one. Somebody needs to look at it.' });
    }
  }

  const parts: string[] = [];
  if (sent.length) parts.push(`${sent.length} sent`);
  if (known.length) parts.push(`${known.length} the office already had`);
  if (waiting.length) parts.push(`${waiting.length} still waiting`);
  if (stuck.length) parts.push(`${stuck.length} need${stuck.length === 1 ? 's' : ''} a person`);

  return {
    sent, already_known: known, needs_a_person: stuck, still_waiting: waiting,
    says: parts.length ? parts.join(', ') : 'Nothing to send',
  };
}

/** What stays on the phone after a sync. Never includes anything that went, always keeps the rest. */
export function remaining(result: SyncResult): QueuedAction[] {
  return sendOrder([...result.still_waiting, ...result.needs_a_person]);
}

/**
 * When the phone and the office disagree, who is right. The rider was at the door; the office was
 * not. Dispatch is the other way round, because the office can see every rider at once.
 */
export function whoWins(kind: ActionKind): 'the rider' | 'the office' {
  if (kind === 'state_move') return 'the office';
  return 'the rider';
}

/** What the rider's screen says, so they can see nothing has been lost. */
export function riderStatus(outbox: QueuedAction[], online: boolean): string {
  if (!outbox.length) return online ? 'Everything is up to date' : 'Nothing waiting, and no signal';
  const precious = outbox.filter((a) => isPrecious(a.kind)).length;
  const stuck = outbox.filter((a) => a.attempts >= GIVE_UP_AFTER).length;
  if (stuck) return `${stuck} thing${stuck === 1 ? '' : 's'} the office could not take. Call the office, nothing is lost.`;
  return `${outbox.length} waiting to send` +
    (precious ? `, including ${precious} about money or proof` : '') +
    (online ? '. Sending now.' : '. They will go when you have signal.');
}

/** The phone is full or being wiped. Say what may never be thrown away. */
export function mustKeep(outbox: QueuedAction[]): QueuedAction[] {
  return outbox.filter((a) => isPrecious(a.kind));
}
```

---

## api/src/orders/ops.test.ts

```typescript
/**
 * Brick 34's proof. Run with:
 *   npm --prefix api run test:orders
 *
 * The board must lead with what needs a person. The last test is the one that keeps it that way.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  exceptionQueue, byState, perRider, perMerchant, failuresByFault, theOneThing,
  LiveOrder,
} from './ops';
import { SettleableOrder } from './settlement';

const NOW = '2026-09-13T12:00:00.000Z';
const ago = (mins: number) => new Date(Date.parse(NOW) - mins * 60000).toISOString();
const P = (n: number) => n * 100;

const live: LiveOrder[] = [
  { order_id: 'o1', state: 'picked_up', since: ago(70), courier_id: 'c1', courier_name: 'Amo', merchant_id: 'm1', merchant_name: 'A grocer', place: 'Mogoditshane' },
  { order_id: 'o2', state: 'dispatch_offered', since: ago(9), courier_id: null, courier_name: null, merchant_id: 'm2', merchant_name: 'A pharmacy', place: 'Phakalane' },
  { order_id: 'o3', state: 'picked_up', since: ago(10), courier_id: 'c2', courier_name: 'Kabelo', merchant_id: 'm1', merchant_name: 'A grocer', place: 'Tlokweng' },
  { order_id: 'o4', state: 'at_door', since: ago(2), courier_id: 'c1', courier_name: 'Amo', merchant_id: 'm2', merchant_name: 'A pharmacy', place: 'Main Mall' },
];

const done: SettleableOrder[] = [
  { order_id: 'd1', merchant_id: 'm1', merchant_name: 'A grocer', goods: P(200), delivery_fee: P(60), rail: 'cash', fault: 'none', delivered: true, perishable: false },
  { order_id: 'd2', merchant_id: 'm1', merchant_name: 'A grocer', goods: P(150), delivery_fee: P(60), rail: 'cash', fault: 'merchant', delivered: false, perishable: false },
  { order_id: 'd3', merchant_id: 'm1', merchant_name: 'A grocer', goods: P(150), delivery_fee: P(60), rail: 'cash', fault: 'merchant', delivered: false, perishable: false },
  { order_id: 'd4', merchant_id: 'm2', merchant_name: 'A pharmacy', goods: P(400), delivery_fee: P(60), rail: 'myzaka', fault: 'none', delivered: true, perishable: false },
  { order_id: 'd5', merchant_id: 'm2', merchant_name: 'A pharmacy', goods: P(90), delivery_fee: P(60), rail: 'cash', fault: 'rider', delivered: false, perishable: false },
];

const riderOf = new Map([
  ['d1', { id: 'c1', name: 'Amo' }],
  ['d2', { id: 'c1', name: 'Amo' }],
  ['d3', { id: 'c2', name: 'Kabelo' }],
  ['d4', { id: 'c2', name: 'Kabelo' }],
  ['d5', { id: 'c1', name: 'Amo' }],
]);

test('the stuck queue is worst first, and names who has it', () => {
  const q = exceptionQueue(live, NOW);
  assert.equal(q.length, 2, 'o1 at 70 minutes and o2 at 9 minutes are both over');
  assert.equal(q[0].order.order_id, 'o1', 'the worst comes first');
  assert.equal(q[0].minutes, 70);
  assert.equal(q[0].over_by, 25, 'picked up allows 45 minutes');
  assert.match(q[0].says, /with Amo/);
  assert.match(q[1].says, /with nobody/);
});

test('an order inside its time is not in the queue', () => {
  const ids = exceptionQueue(live, NOW).map((e) => e.order.order_id);
  assert.equal(ids.includes('o3'), false, 'picked up 10 minutes ago is fine');
  assert.equal(ids.includes('o4'), false, 'at the door 2 minutes ago is fine');
});

test('the board says what to do, not just what is true', () => {
  const one = theOneThing(live, NOW);
  assert.match(one, /^Ring Amo about o1/);
  assert.match(one, /70 minutes/);
  assert.match(one, /Mogoditshane/, 'it must say where, so the caller has context');
});

test('with nothing stuck it says so plainly and counts who is waiting', () => {
  const calm: LiveOrder[] = [{ ...live[3], since: ago(1) }];
  const line = theOneThing(calm, NOW);
  assert.match(line, /Nothing is stuck/);
  assert.match(line, /1 customer is waiting/);
  assert.match(theOneThing([], NOW), /nobody is waiting/);
});

test('the shape of the day groups by where orders are', () => {
  const s = byState(live);
  assert.equal(s[0].state, 'picked_up');
  assert.equal(s[0].count, 2);
  assert.equal(s.reduce((a, x) => a + x.count, 0), live.length);
  assert.equal(s.every((x) => typeof x.waiting === 'boolean'), true);
});

test('output per rider is by name, and failures are split by whose fault', () => {
  const rs = perRider(live, done, riderOf);
  const amo = rs.find((r) => r.courier_id === 'c1')!;
  assert.equal(amo.delivered, 1, 'd1');
  assert.equal(amo.failed_own_fault, 1, 'd5 was the rider');
  assert.equal(amo.failed_other, 1, 'd2 was the shop');
  assert.equal(amo.live, 2, 'o1 and o4');
  assert.match(amo.says, /1 their own/);
  assert.match(amo.says, /1 not their fault/);
});

test('a rider who only took hard jobs is not made to look bad for other people failures', () => {
  const rs = perRider(live, done, riderOf);
  const kabelo = rs.find((r) => r.courier_id === 'c2')!;
  assert.equal(kabelo.failed_own_fault, 0);
  assert.equal(kabelo.failed_other, 1, 'the shop had no stock, not Kabelo');
  assert.equal(kabelo.says.includes('their own'), false);
});

test('the merchant quietly costing money is at the top', () => {
  const ms = perMerchant(done);
  assert.equal(ms[0].merchant_id, 'm1', 'two failed trips because the shop had no stock');
  assert.equal(ms[0].cost_of_their_failures, P(120));
  assert.match(ms[0].says, /67 percent failed/);
  assert.match(ms[0].says, /costing Sprint 120.00 pula in wasted trips/);
});

test('a merchant who simply had a rider problem is not blamed for it', () => {
  const ms = perMerchant(done);
  const pharmacy = ms.find((m) => m.merchant_id === 'm2')!;
  assert.equal(pharmacy.failures, 1);
  assert.equal(pharmacy.cost_of_their_failures, 0, 'the rider caused it, not the pharmacy');
});

test('the leak is shown by whose fault, dearest first', () => {
  const f = failuresByFault(done);
  assert.equal(f[0].fault, 'rider', 'Sprint carried that one');
  assert.equal(f[0].cost, P(60));
  const merchantRow = f.find((x) => x.fault === 'merchant')!;
  assert.equal(merchantRow.count, 2);
  assert.equal(merchantRow.cost, 0, 'Sprint absorbed nothing, the shop simply was not paid');
});

test('every line a person reads is plain and has no dashes', () => {
  const lines = [
    theOneThing(live, NOW),
    exceptionQueue(live, NOW)[0].says,
    perRider(live, done, riderOf)[0].says,
    perMerchant(done)[0].says,
  ];
  for (const l of lines) {
    assert.ok(l.length > 15);
    assert.equal(l.includes(' - '), false, `dash in: ${l}`);
  }
});
```

---

## api/src/orders/ops.ts

```typescript
/**
 * Brick 34. The ops tower.
 *
 * This is the screen the director sweep asks for, and every question on it is one nobody at Sprint
 * can answer today:
 *
 *   Where is every order right now and who has it.
 *   Which orders are stuck, worst first, so somebody rings before the customer does.
 *   Output and failures PER RIDER, by name, so it is visible who is struggling rather than who
 *   complains loudest.
 *   Margin PER MERCHANT, so a shop quietly costing money through stock it does not have shows up.
 *   What is leaking, which is the failures nobody is carrying.
 *
 * It computes, it does not decide. Every number here falls out of the state machine, the fault on
 * each order and the settlement rules. Nothing is estimated and nothing is rounded into a headline.
 *
 * The one design rule: **the board leads with what needs a person, not with a total.** A dashboard
 * that opens with revenue teaches people to scroll past the order that has been sitting for an hour.
 */

import { OrderState, STATES, isStuck } from './state_machine';
import { Fault } from './state_machine';
import { SettleableOrder, settleOne } from './settlement';

export interface LiveOrder {
  order_id: string;
  state: OrderState;
  /** When it entered its current state. The clock that decides whether it is stuck. */
  since: string;
  courier_id: string | null;
  courier_name: string | null;
  merchant_id: string;
  merchant_name: string;
  place: string;
}

export interface Exception {
  order: LiveOrder;
  minutes: number;
  over_by: number;
  says: string;
}

/** Orders past the dwell limit for the state they are in, worst first. */
export function exceptionQueue(orders: LiveOrder[], nowISO?: string): Exception[] {
  const now = nowISO ? Date.parse(nowISO) : Date.now();
  return orders
    .filter((o) => isStuck(o.state, o.since, nowISO))
    .map((o) => {
      const minutes = Math.floor((now - Date.parse(o.since)) / 60000);
      const limit = STATES[o.state].stuckAfterMinutes as number;
      return {
        order: o,
        minutes,
        over_by: minutes - limit,
        says: `${o.order_id} has been ${o.state.replace(/_/g, ' ')} for ${minutes} minutes, ${minutes - limit} over` +
          (o.courier_name ? `, with ${o.courier_name}` : ', with nobody'),
      };
    })
    .sort((a, b) => b.over_by - a.over_by);
}

/** Everything live, grouped by where it is, so the board shows the shape of the day at a glance. */
export function byState(orders: LiveOrder[]): Array<{ state: OrderState; count: number; waiting: boolean }> {
  const m = new Map<OrderState, number>();
  for (const o of orders) m.set(o.state, (m.get(o.state) ?? 0) + 1);
  return [...m.entries()]
    .map(([state, count]) => ({ state, count, waiting: STATES[state].customerWaiting }))
    .sort((a, b) => b.count - a.count);
}

export interface RiderLine {
  courier_id: string;
  courier_name: string;
  live: number;
  delivered: number;
  failed_own_fault: number;
  failed_other: number;
  says: string;
}

/**
 * Output per rider, by name. Failures are split by whose fault, because a rider who takes the hard
 * addresses will have more failures that are not theirs, and punishing that is how you lose them.
 */
export function perRider(live: LiveOrder[], done: SettleableOrder[], riderOf: Map<string, { id: string; name: string }>): RiderLine[] {
  const m = new Map<string, RiderLine>();
  const touch = (id: string, name: string) =>
    m.get(id) ?? m.set(id, { courier_id: id, courier_name: name, live: 0, delivered: 0, failed_own_fault: 0, failed_other: 0, says: '' }).get(id)!;

  for (const o of live) {
    if (!o.courier_id) continue;
    touch(o.courier_id, o.courier_name ?? o.courier_id).live += 1;
  }
  for (const d of done) {
    const r = riderOf.get(d.order_id);
    if (!r) continue;
    const line = touch(r.id, r.name);
    if (d.delivered) line.delivered += 1;
    else if (d.fault === 'rider') line.failed_own_fault += 1;
    else line.failed_other += 1;
  }

  return [...m.values()].map((l) => {
    const finished = l.delivered + l.failed_own_fault + l.failed_other;
    l.says = finished === 0
      ? `${l.courier_name}: ${l.live} live, nothing finished yet`
      : `${l.courier_name}: ${l.delivered} delivered of ${finished}` +
        (l.failed_own_fault ? `, ${l.failed_own_fault} their own` : '') +
        (l.failed_other ? `, ${l.failed_other} not their fault` : '');
    return l;
  }).sort((a, b) => b.delivered - a.delivered || b.live - a.live);
}

export interface MerchantLine {
  merchant_id: string;
  merchant_name: string;
  orders: number;
  goods: number;
  /** What Sprint earned in delivery fees on this merchant's orders. */
  fees: number;
  /** What Sprint carried because of this merchant's failures. */
  cost_of_their_failures: number;
  failures: number;
  says: string;
}

/**
 * Margin per merchant. A shop that keeps running out of stock costs Sprint rider time and goodwill,
 * and until now there was no way to see which one.
 */
export function perMerchant(done: SettleableOrder[]): MerchantLine[] {
  const m = new Map<string, MerchantLine>();
  for (const o of done) {
    const l = m.get(o.merchant_id) ?? {
      merchant_id: o.merchant_id, merchant_name: o.merchant_name,
      orders: 0, goods: 0, fees: 0, cost_of_their_failures: 0, failures: 0, says: '',
    };
    const s = settleOne(o);
    l.orders += 1;
    l.goods += s.merchant;
    l.fees += s.sprint_fee;
    if (!o.delivered) {
      l.failures += 1;
      if (o.fault === 'merchant') l.cost_of_their_failures += o.delivery_fee;
    }
    m.set(o.merchant_id, l);
  }
  return [...m.values()].map((l) => {
    const rate = l.orders ? Math.round((l.failures / l.orders) * 100) : 0;
    l.says = `${l.merchant_name}: ${l.orders} orders, ${rate} percent failed` +
      (l.cost_of_their_failures ? `, costing Sprint ${(l.cost_of_their_failures / 100).toFixed(2)} pula in wasted trips` : '');
    return l;
  }).sort((a, b) => b.cost_of_their_failures - a.cost_of_their_failures || b.orders - a.orders);
}

/** Failures by whose fault, which is the leak nobody has ever measured. */
export function failuresByFault(done: SettleableOrder[]): Array<{ fault: Fault; count: number; cost: number }> {
  const m = new Map<Fault, { fault: Fault; count: number; cost: number }>();
  for (const o of done.filter((d) => !d.delivered)) {
    const e = m.get(o.fault) ?? { fault: o.fault, count: 0, cost: 0 };
    e.count += 1;
    e.cost += settleOne(o).sprint_absorbs;
    m.set(o.fault, e);
  }
  return [...m.values()].sort((a, b) => b.cost - a.cost || b.count - a.count);
}

/**
 * The single thing to do right now. A board that shows twenty numbers and no instruction gets
 * scrolled past, so this names one order and one action.
 */
export function theOneThing(orders: LiveOrder[], nowISO?: string): string {
  const q = exceptionQueue(orders, nowISO);
  if (!q.length) {
    const waiting = orders.filter((o) => STATES[o.state].customerWaiting).length;
    return waiting
      ? `Nothing is stuck. ${waiting} customer${waiting === 1 ? ' is' : 's are'} waiting and all of them are inside their time.`
      : 'Nothing is stuck and nobody is waiting.';
  }
  const worst = q[0];
  const who = worst.order.courier_name ?? 'nobody';
  return `Ring ${who} about ${worst.order.order_id}. It has been ${worst.order.state.replace(/_/g, ' ')} for ${worst.minutes} minutes, which is ${worst.over_by} over, going to ${worst.order.place}.`;
}
```

---

## api/src/orders/orders.controller.ts

```typescript
import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto';
import { JwtAuthGuard } from '../common/jwt-auth.guard';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @HttpCode(201)
  create(@Body() body: CreateOrderDto, @Req() req: Request) {
    const user = (req as any).user as { sub: string };
    const idempotencyKey = (req.headers['idempotency-key'] as string) || '';
    return this.ordersService.create(user.sub, body, idempotencyKey);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  getOne(@Param('id') id: string, @Req() req: Request) {
    const user = (req as any).user as { sub: string; role: string };
    return this.ordersService.getById(id, user);
  }
}
```

---

## api/src/orders/orders.module.ts

```typescript
import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
```

---

## api/src/orders/orders.service.ts

```typescript
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
```

---

## api/src/orders/parcel.test.ts

```typescript
/**
 * Brick 27's proof. Run with:
 *   npm --prefix api run test:orders
 *
 * Every expected number below was typed from the signed contract, UPDATED SLA_2026.pdf page 10,
 * read by word position on 13 September 2026. If a test here fails, either the tariff file drifted
 * from the contract or somebody changed the rules. Both are worth stopping for.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quote, chargedWeight, ladder, priceNote, provenance, ParcelError, MAX_TABLE_KG } from './parcel';

test('the prices are the ones in the signed contract', () => {
  // KGs | Zone 1 | Zone 2 | Zone 3 | Zone 4
  assert.equal(quote(0.5, '1').price, 87.0);
  assert.equal(quote(0.5, '2').price, 98.0);
  assert.equal(quote(0.5, '3').price, 114.0);
  assert.equal(quote(0.5, '4').price, 152.0);
  assert.equal(quote(1, '1').price, 93.0);
  assert.equal(quote(5, '1').price, 136.0);
  assert.equal(quote(5, '4').price, 250.0);
  assert.equal(quote(10, '2').price, 242.0);
  assert.equal(quote(20, '1').price, 298.0);
  assert.equal(quote(20, '4').price, 575.0);
});

test('the five to twenty kilo band is priced, which is the band that was missing elsewhere', () => {
  for (const kg of [5.5, 8, 12.5, 16, 19.5, 20]) {
    for (const z of ['1', '2', '3', '4'] as const) {
      const q = quote(kg, z);
      assert.ok(q.price > 0, `${kg}kg zone ${z} has no price`);
      assert.equal(q.beyond_table, false);
    }
  }
  assert.equal(quote(15, '3').price, 366.0);
});

test('a part weight is charged at the next half kilo, never rounded down', () => {
  assert.equal(chargedWeight(0.1), 0.5);
  assert.equal(chargedWeight(1.2), 1.5);
  assert.equal(chargedWeight(2.0), 2.0);
  assert.equal(quote(1.2, '1').price, quote(1.5, '1').price);
  assert.equal(quote(1.2, '1').charged_kg, 1.5);
});

test('past the table it uses the contract per kilo rate, not a guess', () => {
  const q = quote(25, '1');
  assert.equal(q.beyond_table, true);
  // 20kg zone 1 is 298.00, then 9.00 a kilo for the next five
  assert.equal(q.price, 298.0 + 5 * 9.0);
  assert.equal(quote(30, '4').price, 575.0 + 10 * 16.0);
});

test('a weight with no price is refused rather than estimated', () => {
  assert.throws(() => quote(0, '1'), /needs a weight/);
  assert.throws(() => quote(-3, '1'), /needs a weight/);
  assert.throws(() => quote(NaN, '1'), /needs a weight/);
});

test('a zone Sprint does not contract is refused', () => {
  assert.throws(() => quote(5, '5' as any), /zones 1 to 4 only/);
  assert.throws(() => quote(5, 'Gaborone' as any), /not in the contract/);
});

test('every price is all inclusive and the app says so', () => {
  const q = quote(5, '2');
  assert.equal(q.includes_vat, true);
  assert.match(q.says, /everything included/);
  assert.match(priceNote(), /Includes VAT at 14 percent and the fuel surcharge at 42 percent/);
  assert.match(priceNote(), /Nothing is added at the end/);
});

test('the price rises with weight and with distance, with no dips', () => {
  for (const z of ['1', '2', '3', '4'] as const) {
    let last = 0;
    for (let kg = 0.5; kg <= MAX_TABLE_KG; kg += 0.5) {
      const p = quote(Math.round(kg * 10) / 10, z).price;
      assert.ok(p >= last, `zone ${z} dips at ${kg}kg: ${p} after ${last}`);
      last = p;
    }
  }
  for (const kg of [0.5, 5, 12, 20]) {
    const prices = (['1', '2', '3', '4'] as const).map((z) => quote(kg, z).price);
    assert.deepEqual(prices, [...prices].sort((a, b) => a - b), `zones out of order at ${kg}kg`);
  }
});

test('the ladder a customer sees has no gaps and no invented rows', () => {
  const l = ladder('1', 5);
  assert.equal(l.length, 10, 'half kilo steps from 0.5 to 5');
  assert.equal(l[0].price, 87.0);
  assert.equal(l[l.length - 1].price, 136.0);
});

test('the prices can always be traced back to the document they came from', () => {
  const p = provenance();
  assert.match(p.document, /SLA/);
  assert.equal(p.page, 10);
  assert.match(p.method, /word position/);
  assert.match(p.why, /derived file is never a source/);
  assert.match(quote(5, '1').source, /page 10/);
});
```

---

## api/src/orders/parcel.ts

```typescript
/**
 * Brick 27. Parcels and documents inside the same app.
 *
 * This is the thing neither Wanzy nor Zebras can answer. A customer who is already using the app
 * for groceries can send a parcel to Francistown from the same account, at the same rates Sprint
 * already contracts on, carried by the same riders and branches.
 *
 * THE PRICES COME FROM THE SIGNED CONTRACT, NOT FROM A COPY OF IT. `tariff-domestic.json` beside
 * this file was written straight out of UPDATED SLA_2026.pdf, page 10, read by word position,
 * because a layout dump shifts rows on that document and produces wrong prices. Its own header
 * records the document, the page, the method and the day it was read. On 13 September 2026 all
 * 160 prices were checked against the live quote engine and every one matched.
 *
 * The rule that governs everything here: **a price that cannot be looked up is refused, never
 * estimated.** A wrong price reaches a customer, and then it reaches an argument.
 */

import tariff from './tariff-domestic.json';

export type Zone = '1' | '2' | '3' | '4';

export interface ParcelQuote {
  weight_kg: number;
  /** The weight actually charged. Sprint charges the next half kilo up, like everyone does. */
  charged_kg: number;
  zone: Zone;
  price: number;
  /** True when the weight is past the table and the per kilo rate was used. */
  beyond_table: boolean;
  includes_vat: boolean;
  says: string;
  source: string;
}

export class ParcelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParcelError';
  }
}

export const MAX_TABLE_KG: number = tariff.max_table_kg;
export const STEP_KG = 0.5;

/** Sprint's table moves in half kilos, so anything between steps is charged at the next one up. */
export function chargedWeight(kg: number): number {
  if (!Number.isFinite(kg) || kg <= 0) {
    throw new ParcelError('A parcel needs a weight before it can be priced.');
  }
  return Math.ceil(kg / STEP_KG) * STEP_KG;
}

function keyFor(kg: number): string {
  const asInt = String(Number.isInteger(kg) ? kg : kg);
  const steps = tariff.steps as Record<string, Record<string, number>>;
  for (const cand of [asInt, kg.toFixed(1), String(kg)]) {
    if (cand in steps) return cand;
  }
  return '';
}

/**
 * Price a parcel. Refuses rather than guessing, because the only thing worse than no quote is a
 * confident wrong one.
 */
export function quote(kg: number, zone: Zone): ParcelQuote {
  if (!(['1', '2', '3', '4'] as string[]).includes(zone)) {
    throw new ParcelError(`Zone ${zone} is not in the contract. Sprint prices zones 1 to 4 only.`);
  }
  const charged = chargedWeight(kg);

  if (charged <= MAX_TABLE_KG) {
    const key = keyFor(charged);
    const row = (tariff.steps as Record<string, Record<string, number>>)[key];
    if (!row || typeof row[zone] !== 'number') {
      throw new ParcelError(
        `No price in the contract for ${charged}kg in zone ${zone}. This must be asked, not estimated.`,
      );
    }
    return {
      weight_kg: kg,
      charged_kg: charged,
      zone,
      price: row[zone],
      beyond_table: false,
      includes_vat: true,
      says: `P${row[zone].toFixed(2)} to send ${charged}kg, everything included`,
      source: `${tariff._source.document} page ${tariff._source.page}`,
    };
  }

  // Past the table, the contract gives a rate per kilo on top of the last row.
  const base = (tariff.steps as Record<string, Record<string, number>>)[keyFor(MAX_TABLE_KG)];
  const perKg = (tariff.per_kg_after_max as Record<string, number>)[zone];
  if (!base || typeof base[zone] !== 'number' || typeof perKg !== 'number') {
    throw new ParcelError(`The contract has no rate beyond ${MAX_TABLE_KG}kg for zone ${zone}.`);
  }
  const extra = charged - MAX_TABLE_KG;
  const price = Math.round((base[zone] + extra * perKg) * 100) / 100;
  return {
    weight_kg: kg,
    charged_kg: charged,
    zone,
    price,
    beyond_table: true,
    includes_vat: true,
    says: `P${price.toFixed(2)} to send ${charged}kg, everything included`,
    source: `${tariff._source.document} page ${tariff._source.page}`,
  };
}

/** What the app shows beside the price. Never itemise VAT or fuel: they are already inside. */
export function priceNote(): string {
  return `Includes VAT at ${tariff.vat_pct} percent and the fuel surcharge at ${tariff.fuel_pct} percent. Nothing is added at the end.`;
}

/** So a screen can show a customer what it will cost before they weigh anything precisely. */
export function ladder(zone: Zone, upToKg = 5): Array<{ kg: number; price: number }> {
  const out: Array<{ kg: number; price: number }> = [];
  for (let kg = STEP_KG; kg <= upToKg + 1e-9; kg += STEP_KG) {
    const k = Math.round(kg * 10) / 10;
    try {
      out.push({ kg: k, price: quote(k, zone).price });
    } catch {
      // A missing step is left out rather than filled in with a guess.
    }
  }
  return out;
}

/** Where the prices came from, for anyone who asks, including an auditor. */
export function provenance(): typeof tariff._source {
  return tariff._source;
}
```

---

## api/src/orders/payments.test.ts

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RAILS,
  MemoryBook,
  PaymentError,
  UnconfiguredRail,
  railsAvailableToday,
  railsWaitingOnSomebody,
  railCost,
  netOf,
  pula,
  canMove,
  isFinal,
  take,
  move,
  refund,
} from './payments';

const req = (over: Partial<Parameters<typeof take>[1]> = {}) => ({
  key: 'k1',
  order_id: 'SPR-1',
  rail: 'cash' as const,
  amount_thebe: 6500,
  ...over,
});

/* ---------------- the one that saves the most money ---------------- */

test('three taps on a bad signal make ONE payment, not three', () => {
  const book = new MemoryBook();
  const a = take(book, req());
  const b = take(book, req());
  const c = take(book, req());
  assert.equal(a.key, b.key);
  assert.equal(b.key, c.key);
  assert.equal(book.all().length, 1, 'a retried tap created a second payment');
});

test('the same key with different money is refused, never charged again', () => {
  const book = new MemoryBook();
  take(book, req());
  assert.throws(() => take(book, req({ amount_thebe: 9900 })), PaymentError);
  assert.throws(() => take(book, req({ order_id: 'SPR-2' })), PaymentError);
  assert.equal(book.all().length, 1);
});

test('a payment with no key is refused outright', () => {
  assert.throws(() => take(new MemoryBook(), req({ key: '' })), PaymentError);
});

/* ---------------- money is whole thebe, never a float ---------------- */

test('a fraction of a thebe is not money', () => {
  assert.throws(() => take(new MemoryBook(), req({ amount_thebe: 65.5 })), PaymentError);
});

test('nothing and less than nothing are both refused', () => {
  assert.throws(() => take(new MemoryBook(), req({ amount_thebe: 0 })), PaymentError);
  assert.throws(() => take(new MemoryBook(), req({ amount_thebe: -100 })), PaymentError);
});

test('pula prints thebe the way a person reads it', () => {
  assert.equal(pula(6500), 'P65.00');
  assert.equal(pula(6), 'P0.06');
  assert.equal(pula(100000), 'P1000.00');
  assert.equal(pula(-250), '-P2.50');
});

/* ---------------- rails that are not switched on ---------------- */

test('only the rails that actually work today are offered', () => {
  const open = railsAvailableToday();
  assert.ok(open.includes('cash'));
  assert.ok(open.includes('account'));
  assert.equal(open.includes('orange_money'), false, 'Orange Money has no credentials yet');
  assert.equal(open.includes('card'), false);
});

test('every blocked rail names WHO or WHAT is being waited on', () => {
  const waiting = railsWaitingOnSomebody();
  assert.ok(waiting.length >= 4);
  for (const w of waiting) {
    assert.ok(w.blockedBy.length > 12, w.rail + ' does not say what it waits on');
  }
  const orange = waiting.find((w) => w.rail === 'orange_money');
  assert.match(String(orange?.blockedBy), /credentials/);
});

test('paying on a rail that is not switched on throws, and says why', () => {
  assert.throws(
    () => take(new MemoryBook(), req({ rail: 'orange_money' })),
    /not switched on yet/,
  );
});

test('the inert connector refuses loudly rather than pretending to succeed', async () => {
  await assert.rejects(() => new UnconfiguredRail('orange_money').charge(), PaymentError);
});

test('NO RAIL CLAIMS A REAL RATE YET: this fails the day a rate is pasted in without a source', () => {
  // Every cost is still a placeholder, which is only acceptable while blockedBy is set.
  for (const [rail, spec] of Object.entries(RAILS)) {
    if (spec.costBp !== 0 || spec.costFlatThebe !== 0) {
      assert.equal(
        spec.blockedBy,
        null,
        rail + ' carries a rate but is still marked as waiting. Say where the rate came from.',
      );
    }
  }
});

/* ---------------- the state machine ---------------- */

test('a payment cannot go backwards, and captured money cannot become pending', () => {
  assert.equal(canMove('created', 'captured'), true);
  assert.equal(canMove('captured', 'created'), false);
  assert.equal(canMove('captured', 'awaiting_customer'), false);
  assert.equal(canMove('failed', 'captured'), false);
  assert.equal(canMove('cancelled', 'captured'), false);
});

test('failed, cancelled and refunded are the end of the road', () => {
  assert.equal(isFinal('failed'), true);
  assert.equal(isFinal('cancelled'), true);
  assert.equal(isFinal('refunded'), true);
  assert.equal(isFinal('captured'), false);
});

test('a mobile rail starts by waiting for the customer, cash does not', () => {
  const book = new MemoryBook();
  const cash = take(book, req());
  assert.equal(cash.state, 'created');
  assert.match(cash.says, /at the door/);
});

test('capturing records what the rail took and what the customer sees', () => {
  const book = new MemoryBook();
  take(book, req());
  const p = move(book, 'k1', 'captured', 'REF-77');
  assert.equal(p.state, 'captured');
  assert.equal(p.rail_ref, 'REF-77');
  assert.equal(p.cost_thebe, 0); // cash costs nothing
  assert.match(p.says, /received/);
});

test('an impossible move is refused in plain words', () => {
  const book = new MemoryBook();
  take(book, req());
  move(book, 'k1', 'failed');
  assert.throws(() => move(book, 'k1', 'captured'), /cannot go from failed to captured/);
});

test('a payment nobody started cannot be moved', () => {
  assert.throws(() => move(new MemoryBook(), 'ghost', 'captured'), PaymentError);
});

/* ---------------- refunds ---------------- */

test('cash cannot be refunded by software, and says so instead of failing quietly', () => {
  const book = new MemoryBook();
  take(book, req());
  move(book, 'k1', 'captured');
  assert.throws(() => refund(book, 'k1', 100), /cannot be refunded by software/);
});

test('money that was never taken cannot be sent back', () => {
  const book = new MemoryBook();
  take(book, req({ rail: 'account', amount_thebe: 5000 }));
  assert.throws(() => refund(book, 'k1', 100), /Only money actually taken/);
});

test('a refund can never exceed what was taken, even in two goes', () => {
  const book = new MemoryBook();
  take(book, req({ rail: 'account', amount_thebe: 5000 }));
  move(book, 'k1', 'captured');
  refund(book, 'k1', 3000);
  assert.throws(() => refund(book, 'k1', 2500), /more than was taken/);
  refund(book, 'k1', 2000);
  assert.equal(book.get('k1')?.state, 'refunded');
});

/* ---------------- what the merchant actually nets ---------------- */

test('with every rate still at zero, the merchant nets exactly what was paid', () => {
  assert.equal(railCost('cash', 6500), 0);
  assert.equal(netOf('cash', 6500), 6500);
});

test('the cut is computed in whole thebe, never a fraction of one', () => {
  // proves the rounding holds the day a real rate lands
  const spec = RAILS.orange_money;
  const saved = { bp: spec.costBp, flat: spec.costFlatThebe };
  spec.costBp = 175; // 1.75 percent, a plausible shape, not a quoted rate
  spec.costFlatThebe = 50;
  const cost = railCost('orange_money', 6533);
  assert.ok(Number.isInteger(cost), 'a cost came out as a fraction of a thebe');
  assert.equal(cost, Math.round((6533 * 175) / 10000) + 50);
  assert.equal(netOf('orange_money', 6533), 6533 - cost);
  spec.costBp = saved.bp;
  spec.costFlatThebe = saved.flat;
});

test('cash stays under the cap the cash engine already enforces', () => {
  assert.equal(RAILS.cash.maxThebe, 100000);
  assert.throws(() => take(new MemoryBook(), req({ amount_thebe: 100001 })), /does not take amounts over/);
});
```

---

## api/src/orders/payments.ts

```typescript
/**
 * Payments: taking the money, and never taking it twice.
 *
 * Phase 2 of the plan Luther approved on 15 September 2026. What is deliberately
 * NOT here: a working connection to Orange Money. That needs merchant credentials
 * and a merchant rate, and the emails asking all three networks for both are
 * queued for Monday morning. Writing a connector that pretends to succeed without
 * them would be the worst thing in this file, so the adapter REFUSES instead: an
 * unconfigured rail throws, loudly, by name. A payment system that silently does
 * nothing is how money goes missing.
 *
 * What IS here, and is real and tested:
 *
 *   - Idempotency. A customer with a bad signal taps Pay three times. Three taps,
 *     one charge. This is the single most expensive bug in any payment system and
 *     it is solved by the key, not by hoping the button disables in time.
 *   - A state machine that cannot go backwards. Captured money cannot become
 *     pending again; a failed payment cannot be captured; a refund cannot exceed
 *     what was taken.
 *   - The cost of each rail, so the merchant's net is computed from what actually
 *     arrives rather than from what the customer typed. Settlement already exists
 *     in settlement.ts and consumes this.
 *   - Which rails can refund at all. Cash cannot be refunded through a phone, and
 *     pretending otherwise puts a rider at somebody's door with an argument.
 *
 * Money is in thebe, as whole integers, exactly as cash.ts has it. Never floats.
 * Two pula is 200, and 0.1 + 0.2 is a bug waiting in a currency you can spend.
 */

import type { Rail } from './settlement';

export const THEBE = 100;

export class PaymentError extends Error {}

/** A rail cannot be used until this is false. */
export interface RailSpec {
  label: string;
  /** the customer does something on their own phone before it completes */
  needsCustomerAction: boolean;
  /** money can be sent back down this rail by software */
  refundable: boolean;
  /** what the rail takes, in basis points of the amount (100 bp = 1 percent) */
  costBp: number;
  /** a flat charge per transaction, in thebe, on top of costBp */
  costFlatThebe: number;
  /** below this the rail is not worth offering */
  minThebe: number;
  /** above this the rail refuses or the risk is not ours to take */
  maxThebe: number;
  /**
   * The named thing that must exist before this rail may be switched on. Null
   * means it works today. Every non-null value here is somebody's reply, not a
   * piece of code.
   */
  blockedBy: string | null;
}

/**
 * The costs below are PLACEHOLDERS and are marked as such by blockedBy. Not one
 * of them is a rate anybody has quoted Sprint. They exist so the maths can be
 * tested; they must be replaced with the real merchant rate the day it arrives,
 * and the test named 'no rail claims a real rate' fails if that is forgotten.
 */
export const RAILS: Record<Rail, RailSpec> = {
  cash: {
    label: 'Cash at the door',
    needsCustomerAction: false,
    refundable: false, // a rider cannot un-take cash; this goes through settlement
    costBp: 0,
    costFlatThebe: 0,
    minThebe: 0,
    maxThebe: 100000, // P1000, the cap cash.ts already enforces
    blockedBy: null,
  },
  orange_money: {
    label: 'Orange Money',
    needsCustomerAction: true, // the customer approves on their handset
    refundable: true,
    costBp: 0,
    costFlatThebe: 0,
    minThebe: 100,
    maxThebe: 500000,
    blockedBy: 'Orange Money merchant credentials and rate (email queued Monday 10:05)',
  },
  myzaka: {
    label: 'MyZaka',
    needsCustomerAction: true,
    refundable: true,
    costBp: 0,
    costFlatThebe: 0,
    minThebe: 100,
    maxThebe: 500000,
    blockedBy: 'Mascom MyZaka merchant credentials and rate (email queued Monday 10:35)',
  },
  smega: {
    label: 'Smega',
    needsCustomerAction: true,
    refundable: true,
    costBp: 0,
    costFlatThebe: 0,
    minThebe: 100,
    maxThebe: 500000,
    blockedBy: 'BTC Smega merchant credentials and rate (email queued Monday 11:05)',
  },
  card: {
    label: 'Card',
    needsCustomerAction: true,
    refundable: true,
    costBp: 0,
    costFlatThebe: 0,
    minThebe: 100,
    maxThebe: 2000000,
    blockedBy: 'A card gateway chosen and signed: DPO or Tingg',
  },
  account: {
    label: 'On account',
    needsCustomerAction: false,
    refundable: true,
    costBp: 0,
    costFlatThebe: 0,
    minThebe: 0,
    maxThebe: 10000000,
    blockedBy: null, // corporate.ts already governs who may do this
  },
};

export function railsAvailableToday(): Rail[] {
  return (Object.keys(RAILS) as Rail[]).filter((r) => RAILS[r].blockedBy === null);
}

export function railsWaitingOnSomebody(): { rail: Rail; blockedBy: string }[] {
  return (Object.keys(RAILS) as Rail[])
    .filter((r) => RAILS[r].blockedBy !== null)
    .map((r) => ({ rail: r, blockedBy: RAILS[r].blockedBy as string }));
}

/** What the rail takes off the top, in thebe, rounded to a whole thebe. */
export function railCost(rail: Rail, amountThebe: number): number {
  const spec = RAILS[rail];
  if (amountThebe < 0) throw new PaymentError('An amount cannot be negative.');
  return Math.round((amountThebe * spec.costBp) / 10000) + spec.costFlatThebe;
}

/** What actually lands, after the rail has taken its cut. */
export function netOf(rail: Rail, amountThebe: number): number {
  return amountThebe - railCost(rail, amountThebe);
}

export function pula(thebe: number): string {
  const sign = thebe < 0 ? '-' : '';
  const n = Math.abs(thebe);
  return sign + 'P' + Math.floor(n / THEBE) + '.' + String(n % THEBE).padStart(2, '0');
}

/* ------------------------------------------------------------------ the states */

export type PaymentState =
  | 'created'
  | 'awaiting_customer'
  | 'captured'
  | 'failed'
  | 'cancelled'
  | 'refunded';

const MOVES: Record<PaymentState, PaymentState[]> = {
  created: ['awaiting_customer', 'captured', 'failed', 'cancelled'],
  awaiting_customer: ['captured', 'failed', 'cancelled'],
  captured: ['refunded'],
  failed: [],
  cancelled: [],
  refunded: [],
};

export function canMove(from: PaymentState, to: PaymentState): boolean {
  return MOVES[from].includes(to);
}

export function isFinal(s: PaymentState): boolean {
  return MOVES[s].length === 0;
}

export interface Payment {
  /** the idempotency key: the same key is always the same payment */
  key: string;
  order_id: string;
  rail: Rail;
  amount_thebe: number;
  state: PaymentState;
  /** what the rail took, known only once captured */
  cost_thebe: number;
  refunded_thebe: number;
  /** set when the rail names its own reference, so a dispute can be traced */
  rail_ref: string | null;
  says: string;
}

/* ------------------------------------------------------- taking the money once */

export interface TakeRequest {
  key: string;
  order_id: string;
  rail: Rail;
  amount_thebe: number;
}

/**
 * The book of payments. Deliberately an interface: the real one is Postgres, the
 * one in the tests is a Map, and neither the state machine nor the idempotency
 * rule should care which it is.
 */
export interface PaymentBook {
  get(key: string): Payment | undefined;
  put(p: Payment): void;
}

export class MemoryBook implements PaymentBook {
  private readonly m = new Map<string, Payment>();
  get(key: string) {
    return this.m.get(key);
  }
  put(p: Payment) {
    this.m.set(p.key, p);
  }
  all(): Payment[] {
    return [...this.m.values()];
  }
}

/**
 * Start a payment, or hand back the one this key already started.
 *
 * The rule that matters: the SAME key with DIFFERENT details is a bug in the
 * caller, not a second payment, and it throws rather than quietly charging
 * again. A retried tap sends identical details and gets the identical payment
 * back, which is the whole point.
 */
export function take(book: PaymentBook, req: TakeRequest): Payment {
  if (!req.key) throw new PaymentError('A payment needs an idempotency key.');
  if (!Number.isInteger(req.amount_thebe)) {
    throw new PaymentError('Money is whole thebe. ' + req.amount_thebe + ' is not.');
  }
  if (req.amount_thebe <= 0) throw new PaymentError('An amount must be more than nothing.');

  const existing = book.get(req.key);
  if (existing) {
    if (
      existing.order_id !== req.order_id ||
      existing.rail !== req.rail ||
      existing.amount_thebe !== req.amount_thebe
    ) {
      throw new PaymentError(
        'This key has already been used for a different payment. Refusing to charge again.',
      );
    }
    return existing; // the retried tap
  }

  const spec = RAILS[req.rail];
  if (spec.blockedBy) {
    throw new PaymentError(spec.label + ' is not switched on yet: ' + spec.blockedBy);
  }
  if (req.amount_thebe < spec.minThebe) {
    throw new PaymentError(spec.label + ' does not take amounts under ' + pula(spec.minThebe) + '.');
  }
  if (req.amount_thebe > spec.maxThebe) {
    throw new PaymentError(spec.label + ' does not take amounts over ' + pula(spec.maxThebe) + '.');
  }

  const p: Payment = {
    key: req.key,
    order_id: req.order_id,
    rail: req.rail,
    amount_thebe: req.amount_thebe,
    state: spec.needsCustomerAction ? 'awaiting_customer' : 'created',
    cost_thebe: 0,
    refunded_thebe: 0,
    rail_ref: null,
    says: spec.needsCustomerAction
      ? 'Approve ' + pula(req.amount_thebe) + ' on your phone.'
      : pula(req.amount_thebe) + ' due at the door.',
  };
  book.put(p);
  return p;
}

export function move(
  book: PaymentBook,
  key: string,
  to: PaymentState,
  railRef?: string,
): Payment {
  const p = book.get(key);
  if (!p) throw new PaymentError('No payment with that key.');
  if (!canMove(p.state, to)) {
    throw new PaymentError('A payment cannot go from ' + p.state + ' to ' + to + '.');
  }
  p.state = to;
  if (railRef) p.rail_ref = railRef;
  if (to === 'captured') {
    p.cost_thebe = railCost(p.rail, p.amount_thebe);
    p.says = pula(p.amount_thebe) + ' received.';
  }
  if (to === 'failed') p.says = 'That payment did not go through. Nothing was taken.';
  if (to === 'cancelled') p.says = 'Payment cancelled. Nothing was taken.';
  book.put(p);
  return p;
}

export function refund(book: PaymentBook, key: string, amountThebe: number): Payment {
  const p = book.get(key);
  if (!p) throw new PaymentError('No payment with that key.');
  if (p.state !== 'captured') throw new PaymentError('Only money actually taken can be sent back.');
  if (!RAILS[p.rail].refundable) {
    throw new PaymentError(
      RAILS[p.rail].label + ' cannot be refunded by software. This one goes through settlement.',
    );
  }
  if (!Number.isInteger(amountThebe) || amountThebe <= 0) {
    throw new PaymentError('A refund must be a whole amount of thebe, more than nothing.');
  }
  if (p.refunded_thebe + amountThebe > p.amount_thebe) {
    throw new PaymentError('That is more than was taken.');
  }
  p.refunded_thebe += amountThebe;
  if (p.refunded_thebe === p.amount_thebe) p.state = 'refunded';
  p.says = pula(p.refunded_thebe) + ' sent back.';
  book.put(p);
  return p;
}

/* ------------------------------------------------- the rail itself, unconfigured */

export interface RailAdapter {
  rail: Rail;
  charge(p: Payment): Promise<{ ok: boolean; ref?: string; says: string }>;
}

/**
 * The Orange Money connector, deliberately inert.
 *
 * Orange holds over seven in ten of Botswana's mobile money and publishes a real
 * web payment API, so this is the rail that matters. It cannot be written blind:
 * it needs a merchant id, a secret and the notification URL Orange calls back on.
 * Until those exist this throws by name rather than returning a cheerful false
 * success, because a payment layer that appears to work and takes nothing is
 * worse than one that plainly refuses.
 */
export class UnconfiguredRail implements RailAdapter {
  constructor(public readonly rail: Rail) {}
  async charge(): Promise<{ ok: boolean; says: string }> {
    const spec = RAILS[this.rail];
    throw new PaymentError(
      spec.label + ' has no credentials on this machine. Waiting on: ' + (spec.blockedBy ?? 'nothing'),
    );
  }
}
```

---

## api/src/orders/settlement.test.ts

```typescript
/**
 * Brick 19's proof. Run with:
 *   npm --prefix api run test:orders
 *
 * The first and last tests are the ones that matter. Nothing pays out while the rules are still a
 * proposal, and a rail that does not settle itself is marked rather than assumed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  settleOne,
  dayPayout,
  readyToPay,
  payoutCsv,
  pula,
  SettlementError,
  SettleableOrder,
} from './settlement';

const P = (n: number) => n * 100;

const order = (over: Partial<SettleableOrder> = {}): SettleableOrder => ({
  order_id: 'o1', merchant_id: 'm1', merchant_name: 'A Gaborone grocer',
  goods: P(200), delivery_fee: P(60), rail: 'cash', fault: 'none',
  delivered: true, perishable: false, ...over,
});

test('nothing pays out while the fault model is still a proposal', () => {
  const p = dayPayout('2026-09-13', [order()], false);
  const r = readyToPay(p);
  assert.equal(r.ready, false);
  assert.match(r.says, /still a proposal/);
  assert.match(r.says, /Barbara has it/);
  assert.match(p.says, /NOT PAYABLE/);
  assert.ok(p.total > 0, 'the figure is still worked out, it just cannot be paid');
});

test('once it is agreed, the same day is payable', () => {
  const p = dayPayout('2026-09-13', [order()], true);
  assert.equal(readyToPay(p).ready, true);
  assert.equal(p.total, P(200));
});

test('a delivered order pays the merchant in full and Sprint keeps the fee', () => {
  const s = settleOne(order());
  assert.equal(s.merchant, P(200));
  assert.equal(s.sprint_fee, P(60));
  assert.equal(s.sprint_absorbs, 0);
  assert.match(s.says, /Delivered, paid in full/);
});

test('the shop could not supply, so nothing is owed to it', () => {
  const s = settleOne(order({ delivered: false, fault: 'merchant' }));
  assert.equal(s.merchant, 0);
  assert.equal(s.perishable_loss, 0);
  assert.equal(s.sprint_fee, 0);
  assert.match(s.says, /could not supply/);
});

test('the customer caused it, so the delivery fee stands and the goods go back', () => {
  const s = settleOne(order({ delivered: false, fault: 'customer' }));
  assert.equal(s.merchant, 0, 'the goods are resellable, so nothing is owed');
  assert.equal(s.sprint_fee, P(60), 'the fee stands');
  assert.equal(s.sprint_absorbs, 0);
});

test('a perishable that cannot go back on a shelf is a real loss, and the shop is covered', () => {
  const s = settleOne(order({ delivered: false, fault: 'customer', perishable: true }));
  assert.equal(s.perishable_loss, P(200));
  assert.match(s.says, /cannot be resold, so the shop is covered/);
});

test('when Sprint could not deliver, Sprint carries it', () => {
  const s = settleOne(order({ delivered: false, fault: 'sprint', perishable: true }));
  assert.equal(s.sprint_fee, 0, 'no fee is earned on a delivery that did not happen');
  assert.equal(s.perishable_loss, P(200));
  assert.equal(s.sprint_absorbs, P(200) + P(60));
  assert.match(s.says, /Sprint carries the cost/);
});

test('a rider who abandoned the job costs Sprint, not the merchant', () => {
  const s = settleOne(order({ delivered: false, fault: 'rider' }));
  assert.equal(s.merchant, 0);
  assert.equal(s.sprint_absorbs, P(60));
});

test('nobody at fault means nobody profits and nobody is punished', () => {
  const s = settleOne(order({ delivered: false, fault: 'none', perishable: true }));
  assert.equal(s.sprint_fee, 0);
  assert.equal(s.perishable_loss, P(200));
  assert.match(s.says, /Nobody was at fault/);
});

test('the day is grouped by merchant, biggest first', () => {
  const p = dayPayout('2026-09-13', [
    order({ order_id: 'a', merchant_id: 'm1', merchant_name: 'A grocer', goods: P(100) }),
    order({ order_id: 'b', merchant_id: 'm2', merchant_name: 'A pharmacy', goods: P(500) }),
    order({ order_id: 'c', merchant_id: 'm1', merchant_name: 'A grocer', goods: P(300) }),
  ], true);
  // m2 is a single P500 order, m1 is P100 plus P300 which is P400. Biggest first.
  assert.deepEqual(p.lines.map((l) => l.merchant_id), ['m2', 'm1']);
  const grocer = p.lines.find((l) => l.merchant_id === 'm1')!;
  assert.equal(grocer.orders, 2);
  assert.equal(grocer.net, P(400));
  assert.equal(p.total, P(900));
});

test('a rail that does not settle itself is marked, because Sprint must fund it', () => {
  const my = dayPayout('2026-09-13', [order({ rail: 'myzaka' })], true);
  assert.equal(my.lines[0].funded_by_sprint, true);
  assert.match(my.lines[0].says, /funded from Sprint's own account/);
  assert.match(my.lines[0].says, /wallet somebody must empty by hand/);
  assert.equal(my.funded_by_sprint, P(200));

  const card = dayPayout('2026-09-13', [order({ rail: 'card' })], true);
  assert.equal(card.lines[0].funded_by_sprint, false, 'a card rail pays the merchant itself');
  assert.equal(card.funded_by_sprint, 0);

  // Cash is NOT the same problem. The rider already collected the notes, so Sprint holds the money
  // and simply transfers it. Conflating that with a wallet would overstate what has to be funded.
  const cash = dayPayout('2026-09-13', [order({ rail: 'cash' })], true);
  assert.equal(cash.lines[0].funded_by_sprint, false);
  assert.match(cash.lines[0].says, /out of the cash the rider already collected/);
});

test('Sprint can see what it earned and what it carried, separately', () => {
  const p = dayPayout('2026-09-13', [
    order({ order_id: 'a' }),
    order({ order_id: 'b', delivered: false, fault: 'sprint', perishable: true }),
  ], true);
  assert.equal(p.sprint_delivery_fees, P(60), 'only the one that actually arrived');
  assert.equal(p.sprint_absorbed, P(260));
});

test('a day that works out to less than nothing stops and asks a person', () => {
  const p = dayPayout('2026-09-13', [order({ goods: 0, delivered: false, fault: 'merchant' })], true);
  p.total = -1; // only reachable if something upstream is wrong, which is the point
  assert.equal(readyToPay(p).ready, false);
  assert.match(readyToPay(p).says, /A person must look/);
});

test('a bad day or a negative amount is refused rather than paid', () => {
  assert.throws(() => dayPayout('13 September', [order()], true), SettlementError);
  assert.throws(() => dayPayout('2026-09-13', [order({ goods: -1 })], true), /negative amount/);
});

test('the file finance opens is a real CSV with a total that adds up', () => {
  const p = dayPayout('2026-09-13', [
    order({ order_id: 'a', merchant_id: 'm1', merchant_name: 'A grocer, Ltd', goods: P(100) }),
    order({ order_id: 'b', merchant_id: 'm2', merchant_name: 'A pharmacy', goods: P(250), rail: 'myzaka' }),
  ], true);
  const csv = payoutCsv(p);
  const rows = csv.trim().split('\n');
  assert.equal(rows.length, 4, 'a header, two merchants and a total');
  assert.match(rows[0], /^day,merchant_id,merchant_name,orders,goods_pula/);
  assert.match(csv, /"A grocer, Ltd"/, 'a comma in a name must not break the columns');
  assert.match(rows[rows.length - 1], /TOTAL/);
  assert.match(rows[rows.length - 1], /350\.00/);
  assert.match(csv, /myzaka,yes/, 'the funded flag must reach the file');
});

test('every line a person reads is plain and has no dashes', () => {
  const p = dayPayout('2026-09-13', [order({ rail: 'myzaka' })], false);
  for (const l of [p.says, p.lines[0].says, readyToPay(p).says, pula(P(12))]) {
    assert.equal(l.includes(' - '), false, `dash in: ${l}`);
  }
});
```

---

## api/src/orders/settlement.ts

```typescript
/**
 * Brick 19. Merchants paid the same day.
 *
 * Both council seats said settlement speed is existential: a merchant paid tomorrow leaves for a
 * platform that pays today. They also said it is impossible without brick 15, the fault model,
 * because the moment money moves on its own somebody must already have decided who carries a loss.
 *
 * So this file turns the fault on each order into arithmetic. At the end of a day every completed
 * order has a fault of merchant, customer, sprint, rider or none already attached by the person who
 * was there, and the payout file falls out of that without anybody reading an order history.
 *
 * **Status: the RULES here are brick 15's, which Barbara has not agreed yet.** The mechanism is
 * real and tested; the percentages and the deduction rules are the proposal in docs/FAULT_MODEL.md.
 * Nothing may actually pay a merchant until she signs it, and `readyToPay()` refuses while the model
 * is unagreed rather than quietly running on a draft.
 *
 * **One thing the council did not know.** MyZaka has no automatic settlement to a bank account at
 * all. Their own contract has the merchant emptying an electronic wallet by hand. So on that rail a
 * same day payout has to be funded from Sprint's own account and reconciled afterwards, and this
 * file marks those lines rather than pretending the money moved.
 */

import { Fault } from './state_machine';

/** Money is in thebe throughout. A decimal is how money quietly disappears. */
import { commissionOn, type MerchantTerms } from './commission';

export type Rail = 'cash' | 'orange_money' | 'myzaka' | 'smega' | 'card' | 'account';

/**
 * Three different things, and conflating them would mislead finance badly.
 *   SELF_SETTLING: the rail moves money to the merchant itself. Nothing to fund.
 *   IN_HAND: the rider physically collected it, so Sprint holds the notes and simply transfers them.
 *   WALLET: the money sits in an electronic wallet that somebody at Sprint must empty by hand, per
 *           Mascom's own MyZakaPay contract clause 3.3.6. THIS is the one that has to be funded from
 *           Sprint's own bank account on the day and reconciled afterwards.
 */
const SELF_SETTLING: Rail[] = ['card', 'account'];
const IN_HAND: Rail[] = ['cash'];
const WALLET: Rail[] = ['orange_money', 'myzaka', 'smega'];

export interface SettleableOrder {
  order_id: string;
  merchant_id: string;
  merchant_name: string;
  /** What the customer paid for the goods, in thebe. Excludes the delivery fee. */
  goods: number;
  /** The delivery fee, which is Sprint's, not the merchant's. */
  delivery_fee: number;
  rail: Rail;
  /** 'none' when it completed normally. Anything else means something went wrong. */
  fault: Fault;
  /** Did the goods actually reach the customer. */
  delivered: boolean;
  /** Perishable or dispensed goods cannot go back on a shelf. */
  perishable: boolean;
}

export interface PayoutLine {
  merchant_id: string;
  merchant_name: string;
  orders: number;
  /** What the merchant is owed for goods that reached a customer. */
  goods: number;
  /** Deducted because the merchant caused a failure. Never a penalty, only real cost. */
  deductions: number;
  /** Paid to the merchant for goods that came back but cannot be resold. */
  perishable_loss: number;
  net: number;
  rail: Rail;
  /** True when Sprint must fund this from its own account because the rail does not settle itself. */
  funded_by_sprint: boolean;
  says: string;
}

export interface Payout {
  day: string;
  lines: PayoutLine[];
  total: number;
  funded_by_sprint: number;
  /** Sprint's own take for the day: delivery fees earned, less what it carried for its own failures. */
  sprint_delivery_fees: number;
  sprint_absorbed: number;
  agreed: boolean;
  says: string;
}

export class SettlementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettlementError';
  }
}

export function pula(thebe: number): string {
  return `P${(thebe / 100).toFixed(2)}`;
}

/**
 * What one order settles to. The fault decides it, exactly as the table in docs/FAULT_MODEL.md says.
 */
export function settleOne(o: SettleableOrder, terms: MerchantTerms | null = null): {
  merchant: number;
  perishable_loss: number;
  sprint_fee: number;
  sprint_absorbs: number;
  /** Sprint's share of the GOODS. Zero unless the merchant's rate is agreed. */
  commission: number;
  says: string;
} {
  if (o.goods < 0 || o.delivery_fee < 0) throw new SettlementError('An order cannot have a negative amount on it.');

  if (o.delivered) {
    // It arrived. The merchant is paid for the goods and Sprint keeps the delivery fee, whatever
    // went wrong on the way, because the customer got what they ordered.
    /* Commission is earned only on a delivery that happened, and only on the
       goods. An unagreed rate earns zero, so a rate typed in during a negotiation
       cannot start taking money from a merchant because somebody forgot it was
       still a proposal. See commission.ts. */
    const cut = commissionOn(o.goods, terms);
    return {
      merchant: o.goods - cut.thebe,
      perishable_loss: 0,
      sprint_fee: o.delivery_fee,
      sprint_absorbs: 0,
      commission: cut.thebe,
      says: cut.earned ? `Delivered. ${cut.says}` : 'Delivered, paid in full',
    };
  }

  switch (o.fault) {
    case 'merchant':
      // The shop could not supply. They are paid nothing and carry any perishable loss themselves.
      return { merchant: 0, perishable_loss: 0, sprint_fee: 0, sprint_absorbs: 0, commission: 0, says: 'The shop could not supply it, nothing is owed' };

    case 'customer':
      // Wrong address, nobody home, failed identity check. The customer keeps paying the delivery
      // fee, and a perishable that cannot be resold is the merchant's real loss, so it is paid.
      return {
        merchant: 0,
        perishable_loss: o.perishable ? o.goods : 0,
        sprint_fee: o.delivery_fee,
        sprint_absorbs: 0,
        commission: 0,   // nothing was delivered, so nothing is earned on the basket
        says: o.perishable
          ? 'The customer caused it and the goods cannot be resold, so the shop is covered'
          : 'The customer caused it, the goods go back, the delivery fee stands',
      };

    case 'rider':
    case 'sprint':
      // Sprint could not do what it sold. The customer is refunded, the merchant is covered for
      // anything that cannot be resold, and Sprint carries it.
      return {
        merchant: 0,
        perishable_loss: o.perishable ? o.goods : 0,
        sprint_fee: 0,
        sprint_absorbs: (o.perishable ? o.goods : 0) + o.delivery_fee,
        commission: 0,   // nothing was delivered, so nothing is earned on the basket
        says: 'Sprint could not deliver it, so Sprint carries the cost',
      };

    case 'none':
    default:
      // Nobody is at fault. Flood, accident, roadblock. Nobody profits and nobody is punished.
      return {
        merchant: 0,
        perishable_loss: o.perishable ? o.goods : 0,
        sprint_fee: 0,
        sprint_absorbs: o.perishable ? o.goods : 0,
        commission: 0,   // nothing was delivered, so nothing is earned on the basket
        says: 'Nobody was at fault, the goods that cannot be resold are covered',
      };
  }
}

/**
 * The day's payout, grouped by merchant. `agreed` is whether Barbara has signed the fault model;
 * false produces the file but marks it not payable, so nobody pays out on a draft by accident.
 */
export function dayPayout(day: string, orders: SettleableOrder[], agreed: boolean): Payout {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new SettlementError('A payout needs a day, as 2026-09-13.');

  const byMerchant = new Map<string, PayoutLine>();
  let fees = 0, absorbed = 0;

  for (const o of orders) {
    const s = settleOne(o);
    fees += s.sprint_fee;
    absorbed += s.sprint_absorbs;

    const line = byMerchant.get(o.merchant_id) ?? {
      merchant_id: o.merchant_id,
      merchant_name: o.merchant_name,
      orders: 0, goods: 0, deductions: 0, perishable_loss: 0, net: 0,
      rail: o.rail,
      funded_by_sprint: WALLET.includes(o.rail),
      says: '',
    };
    line.orders += 1;
    line.goods += s.merchant;
    line.perishable_loss += s.perishable_loss;
    if (!o.delivered && o.fault === 'merchant') line.deductions += 0; // nothing owed, nothing deducted
    byMerchant.set(o.merchant_id, line);
  }

  const lines = [...byMerchant.values()].map((l) => {
    l.net = l.goods + l.perishable_loss - l.deductions;
    l.says = l.funded_by_sprint
      ? `${pula(l.net)} to ${l.merchant_name}, funded from Sprint's own account because ${railName(l.rail)} leaves the money in a wallet somebody must empty by hand`
      : IN_HAND.includes(l.rail)
        ? `${pula(l.net)} to ${l.merchant_name}, out of the cash the rider already collected`
        : `${pula(l.net)} to ${l.merchant_name} on ${railName(l.rail)}`;
    return l;
  }).sort((a, b) => b.net - a.net);

  const total = lines.reduce((a, l) => a + l.net, 0);
  const funded = lines.filter((l) => l.funded_by_sprint).reduce((a, l) => a + l.net, 0);

  return {
    day, lines, total,
    funded_by_sprint: funded,
    sprint_delivery_fees: fees,
    sprint_absorbed: absorbed,
    agreed,
    says: agreed
      ? `${pula(total)} to ${lines.length} merchant${lines.length === 1 ? '' : 's'} for ${day}`
      : `${pula(total)} worked out for ${day}, NOT PAYABLE until the fault model is agreed`,
  };
}

function railName(r: Rail): string {
  return { cash: 'cash', orange_money: 'Orange Money', myzaka: 'MyZaka', smega: 'Smega', card: 'card', account: 'account' }[r];
}

/** The gate. Nothing pays a merchant while the rules behind it are still a proposal. */
export function readyToPay(p: Payout): { ready: boolean; says: string } {
  if (!p.agreed) {
    return { ready: false, says: 'The fault model is still a proposal, so nothing can be paid out yet. Barbara has it.' };
  }
  if (p.total < 0) {
    return { ready: false, says: 'The day works out to less than nothing, which means something is wrong. A person must look.' };
  }
  return { ready: true, says: p.says };
}

/** The file finance actually opens. Plain CSV, because that is what a bank upload takes. */
export function payoutCsv(p: Payout): string {
  const head = 'day,merchant_id,merchant_name,orders,goods_pula,perishable_pula,net_pula,rail,funded_by_sprint';
  const rows = p.lines.map((l) =>
    [p.day, l.merchant_id, `"${l.merchant_name.replace(/"/g, '""')}"`, l.orders,
     (l.goods / 100).toFixed(2), (l.perishable_loss / 100).toFixed(2), (l.net / 100).toFixed(2),
     l.rail, l.funded_by_sprint ? 'yes' : 'no'].join(','));
  const foot = `${p.day},TOTAL,"",${p.lines.reduce((a, l) => a + l.orders, 0)},,,${(p.total / 100).toFixed(2)},,`;
  return [head, ...rows, foot].join('\n') + '\n';
}
```

---

## api/src/orders/state_machine.test.ts

```typescript
/**
 * Brick 14's proof. Run with:
 *   npm --prefix api run test:orders
 *
 * The first three tests are the ones that matter. They prove mechanically that an order can
 * never get stuck, which is the council's finding, rather than asserting it in a comment.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATES,
  TRANSITIONS,
  OrderState,
  apply,
  can,
  allowedEvents,
  isTerminal,
  isStuck,
  deadEnds,
  unreachable,
  untimed,
  canReachEnd,
  TransitionError,
} from './state_machine';

const ALL = Object.keys(STATES) as OrderState[];

test('guarantee 1: no order can get stuck, every live state has a way out', () => {
  assert.deepEqual(deadEnds(), [], 'these states trap an order forever');
});

test('guarantee 2: no orphan states, everything is reachable from placed', () => {
  assert.deepEqual(unreachable(), [], 'these states can never be entered');
});

test('guarantee 3: every live state has a dwell limit so nothing sits silently', () => {
  assert.deepEqual(untimed(), [], 'these states would never raise an ops alert');
});

test('every state can still reach an ending', () => {
  for (const s of ALL) {
    assert.equal(canReachEnd(s), true, `${s} can never be finished`);
  }
});

test('terminal states accept nothing further', () => {
  for (const s of ALL.filter(isTerminal)) {
    assert.equal(TRANSITIONS.some((t) => t.from === s), false, `${s} is terminal but has moves`);
    assert.throws(() => apply(s, 'close', { actor: 'ops' }), TransitionError);
  }
});

test('the happy path runs end to end', () => {
  let s: OrderState = 'placed';
  const path: Array<[string, any]> = [
    ['pay_succeeded', 'system'],
    ['offer_to_riders', 'system'],
    ['rider_accepted', 'courier'],
    ['rider_arrived_at_shop', 'courier'],
    ['collected', 'courier'],
    ['arrived', 'courier'],
    ['handed_over', 'courier'],
    ['close', 'system'],
  ];
  for (const [event, actor] of path) {
    s = apply(s, event, { actor }).state;
  }
  assert.equal(s, 'closed');
});

test('out of stock, customer takes a substitute, order still completes', () => {
  let s: OrderState = 'at_merchant';
  s = apply(s, 'out_of_stock', { actor: 'merchant', fault: 'merchant' }).state;
  assert.equal(s, 'stock_problem');
  s = apply(s, 'substitute_accepted', { actor: 'customer' }).state;
  assert.equal(s, 'at_merchant');
  s = apply(s, 'collected', { actor: 'courier' }).state;
  assert.equal(s, 'picked_up');
});

test('wrong address is recoverable without cancelling the order', () => {
  let s: OrderState = apply('at_door', 'wrong_address', { actor: 'courier' }).state;
  assert.equal(s, 'address_problem');
  s = apply(s, 'address_fixed', { actor: 'customer' }).state;
  assert.equal(s, 'picked_up');
  s = apply(s, 'arrived', { actor: 'courier' }).state;
  assert.equal(s, 'at_door');
});

test('customer absent, then answers, still gets the order', () => {
  let s: OrderState = apply('at_door', 'nobody_there', { actor: 'courier' }).state;
  assert.equal(s, 'customer_absent');
  s = apply(s, 'customer_answered', { actor: 'courier' }).state;
  assert.equal(s, 'at_door');
});

test('rider breaks down, order is reassigned rather than lost', () => {
  let s: OrderState = apply('dispatch_accepted', 'rider_dropped', { actor: 'courier', fault: 'rider' }).state;
  assert.equal(s, 'dispatch_offered');
  s = apply(s, 'rider_accepted', { actor: 'courier' }).state;
  assert.equal(s, 'dispatch_accepted');
});

test('a failed identity check sends liquor or medicine back, and names the fault', () => {
  const move = apply('at_door', 'id_check_failed', { actor: 'courier', fault: 'customer' });
  assert.equal(move.state, 'returning');
  assert.equal(move.fault, 'customer');
  let s = apply(move.state, 'back_at_merchant', { actor: 'courier' }).state;
  assert.equal(s, 'returned');
  s = apply(s, 'settle', { actor: 'ops', fault: 'customer' }).state;
  assert.equal(s, 'refund_due');
  s = apply(s, 'refunded', { actor: 'ops' }).state;
  assert.equal(s, 'closed');
});

test('brick 15: money never moves on a failure whose fault was never decided', () => {
  assert.throws(
    () => apply('at_door', 'id_check_failed', { actor: 'courier' }),
    /needs somebody to carry the cost/,
  );
  assert.throws(
    () => apply('delivered', 'dispute_raised', { actor: 'customer' }),
    /needs somebody to carry the cost/,
  );
  const ok = apply('delivered', 'dispute_raised', { actor: 'customer', fault: 'sprint' });
  assert.equal(ok.fault, 'sprint');
});

test('a fault is not invented on a clean transition', () => {
  const move = apply('at_door', 'handed_over', { actor: 'courier' });
  assert.equal(move.fault, 'none');
});

test('the wrong person cannot move an order', () => {
  assert.throws(() => apply('at_door', 'handed_over', { actor: 'customer' }), /may not do/);
  assert.throws(() => apply('paid', 'offer_to_riders', { actor: 'customer' }), /may not do/);
});

test('an impossible move is refused loudly and says what is possible', () => {
  assert.throws(() => apply('placed', 'handed_over', { actor: 'courier' }), /is not possible from placed/);
  try {
    apply('placed', 'handed_over', { actor: 'courier' });
  } catch (e: any) {
    assert.match(e.message, /pay_succeeded/);
  }
});

test('allowedEvents drives what a rider sees, and it is never the whole list', () => {
  const riderAtDoor = allowedEvents('at_door', 'courier').map((t) => t.event);
  assert.ok(riderAtDoor.includes('handed_over'));
  assert.ok(riderAtDoor.includes('nobody_there'));
  const customerAtDoor = allowedEvents('at_door', 'customer').map((t) => t.event);
  assert.deepEqual(customerAtDoor, [], 'a customer has no buttons at the door');
  assert.equal(can('at_door', 'handed_over', 'courier'), true);
  assert.equal(can('at_door', 'handed_over', 'customer'), false);
});

test('the stuck clock fires on the states that matter', () => {
  const t0 = '2026-09-12T08:00:00.000Z';
  assert.equal(isStuck('dispatch_offered', t0, '2026-09-12T08:02:00.000Z'), false);
  assert.equal(isStuck('dispatch_offered', t0, '2026-09-12T08:04:00.000Z'), true);
  assert.equal(isStuck('picked_up', t0, '2026-09-12T08:40:00.000Z'), false);
  assert.equal(isStuck('picked_up', t0, '2026-09-12T09:00:00.000Z'), true);
  assert.equal(isStuck('closed', t0, '2027-01-01T00:00:00.000Z'), false, 'a finished order is never stuck');
});

test('every transition names a real state, a real actor set and plain words', () => {
  const actors = ['customer', 'courier', 'merchant', 'ops', 'system'];
  for (const t of TRANSITIONS) {
    assert.ok(STATES[t.from], `unknown from state ${t.from}`);
    assert.ok(STATES[t.to], `unknown to state ${t.to}`);
    assert.ok(t.actors.length > 0, `${t.event} has nobody who can do it`);
    for (const a of t.actors) assert.ok(actors.includes(a), `${t.event} has unknown actor ${a}`);
    assert.ok(t.says && t.says.length > 5, `${t.event} has no plain words`);
    assert.equal(t.says.includes('-'), false, `${t.event} uses a dash in text a person reads`);
  }
});

test('no two transitions share a from and event pair', () => {
  const seen = new Set<string>();
  for (const t of TRANSITIONS) {
    const key = `${t.from}:${t.event}`;
    assert.equal(seen.has(key), false, `${key} is defined twice`);
    seen.add(key);
  }
});

test('every state a customer waits in has a limit under an hour, except the money ones', () => {
  const slowOnPurpose: OrderState[] = ['payment_failed', 'refund_due'];
  for (const s of ALL) {
    const m = STATES[s];
    if (m.customerWaiting && !slowOnPurpose.includes(s)) {
      assert.ok(m.stuckAfterMinutes !== null && m.stuckAfterMinutes <= 60,
        `${s} keeps a customer waiting ${m.stuckAfterMinutes} minutes with no alert`);
    }
  }
});
```

---

## api/src/orders/state_machine.ts

```typescript
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
```

---

## api/src/orders/till.test.ts

```typescript
/**
 * Brick 32's proof. Run with:
 *   npm --prefix api run test:orders
 *
 * The test that matters most is the third one. A dead till and a slow shopkeeper look identical on
 * every delivery dashboard in this market, and they need two different phone calls.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tillState, ladder, says, speedOf, mayDispatch, faultFor, deviceWall,
  ACCEPT_WITHIN_SECONDS, GIVE_UP_AFTER_SECONDS, TRUSTED_AFTER_ORDERS,
  Till, Offer, TillError,
} from './till';

const NOW = '2026-09-12T09:00:00.000Z';
const ago = (secs: number) => new Date(Date.parse(NOW) - secs * 1000).toISOString();

const alive: Till = {
  merchant_id: 'm1', merchant_name: 'A grocer', channel: 'printer',
  last_seen: ago(30), person: 'Neo', phone: '71 234 567',
};
const dead: Till = { ...alive, merchant_id: 'm2', merchant_name: 'A pharmacy', last_seen: ago(40 * 60) };
const unboxed: Till = { ...alive, merchant_id: 'm3', merchant_name: 'A bottle store', channel: 'tablet', last_seen: null };

const offer = (over: Partial<Offer> = {}): Offer => ({
  order_id: 'o1', merchant_id: 'm1', sent_at: ago(10),
  accepted_at: null, refused_at: null, refusal: null, ...over,
});

test('inside two minutes nothing is wrong and the shop is told how long is left', () => {
  const o = offer({ sent_at: ago(30) });
  assert.equal(tillState(o, alive, NOW), 'waiting');
  assert.match(says(o, alive, NOW), /90 seconds left/);
});

test('past two minutes the shop is late and the line names who to ring', () => {
  const o = offer({ sent_at: ago(ACCEPT_WITHIN_SECONDS + 60) });
  assert.equal(tillState(o, alive, NOW), 'late');
  assert.match(says(o, alive, NOW), /has not accepted it/);
  assert.match(says(o, alive, NOW), /Ring Neo/);
});

test('a dead till is a dead device, not a slow shopkeeper, and it is checked first', () => {
  const o = offer({ merchant_id: 'm2', sent_at: ago(30) });
  // Only 30 seconds gone, so lateness is not even in question yet. The device still wins.
  assert.equal(tillState(o, dead, NOW), 'device_silent');
  const line = says(o, dead, NOW);
  assert.match(line, /never saw/);
  assert.match(line, /This is the device, not the shop/);
  assert.match(line, /read the order out/);
});

test('a till with no phone number behind it says so, because there is then no way to reach anyone', () => {
  const orphan: Till = { ...dead, phone: null, person: null };
  const line = says(offer({ merchant_id: orphan.merchant_id }), orphan, NOW);
  assert.match(line, /no way to reach them/);
  assert.match(line, /before they take another order/);
});

test('past the limit it stops waiting and a person owns telling the customer', () => {
  const o = offer({ sent_at: ago(GIVE_UP_AFTER_SECONDS + 60) });
  assert.equal(tillState(o, alive, NOW), 'given_up');
  assert.match(says(o, alive, NOW), /needs telling now, by a person/);
});

test('accepting and refusing both end the clock, and a refusal carries the shop own words', () => {
  const yes = offer({ sent_at: ago(45), accepted_at: ago(20) });
  assert.equal(tillState(yes, alive, NOW), 'accepted');
  assert.match(says(yes, alive, NOW), /accepted o1 in 25 seconds/);

  const no = offer({ refused_at: ago(5), refusal: 'no stock of that size' });
  assert.equal(tillState(no, alive, NOW), 'refused');
  assert.match(says(no, alive, NOW), /no stock of that size/);
});

test('every rung of the ladder names somebody, and the last one is telling the customer', () => {
  const rungs = ladder(alive);
  assert.ok(rungs.length >= 4);
  for (const r of rungs) {
    assert.ok(r.who.length > 2, 'a rung with no owner is how an order ends up owned by nobody');
    assert.ok(r.what.length > 15);
  }
  assert.deepEqual(rungs.map((r) => r.at_seconds), [...rungs.map((r) => r.at_seconds)].sort((a, b) => a - b));
  assert.match(rungs[rungs.length - 1].what, /tells the customer/);
  assert.match(rungs[2].what, /71 234 567/, 'the office rung carries the actual number to ring');
});

test('a shop speed is measured, and trust is earned over real orders rather than agreed', () => {
  const fast: Offer[] = Array.from({ length: TRUSTED_AFTER_ORDERS }, (_, i) => ({
    order_id: `f${i}`, merchant_id: 'm1', sent_at: ago(600), accepted_at: ago(600 - 40),
    refused_at: null, refusal: null,
  }));
  const s = speedOf('m1', 'A grocer', fast);
  assert.equal(s.median_seconds, 40);
  assert.equal(s.orders, TRUSTED_AFTER_ORDERS);
  assert.equal(s.inside_two_minutes, TRUSTED_AFTER_ORDERS);
  assert.equal(s.trusted, true);
  assert.match(s.says, /usually accepts in 40 seconds/);
});

test('a fast shop with too few orders has not earned an early rider yet', () => {
  const few: Offer[] = Array.from({ length: 3 }, (_, i) => ({
    order_id: `f${i}`, merchant_id: 'm1', sent_at: ago(600), accepted_at: ago(600 - 20),
    refused_at: null, refusal: null,
  }));
  const s = speedOf('m1', 'A grocer', few);
  assert.equal(s.median_seconds, 20, 'quick, but on almost nothing');
  assert.equal(s.trusted, false);
});

test('a shop that has never accepted anything is not judged on a number it has not earned', () => {
  const s = speedOf('m9', 'A new shop', []);
  assert.equal(s.median_seconds, null, 'never a zero, because zero would read as instant');
  assert.equal(s.trusted, false);
  assert.match(s.says, /nothing to judge them on/);
});

test('no rider is sent to a counter that has not accepted, unless the shop earned it', () => {
  const slow = speedOf('m1', 'A grocer', []);
  const waiting = offer({ sent_at: ago(30) });
  assert.equal(mayDispatch(waiting, alive, slow, NOW).may, false);
  assert.match(mayDispatch(waiting, alive, slow, NOW).says, /nobody is sent to wait at the counter/);

  const fast = speedOf('m1', 'A grocer', Array.from({ length: TRUSTED_AFTER_ORDERS }, (_, i) => ({
    order_id: `f${i}`, merchant_id: 'm1', sent_at: ago(600), accepted_at: ago(600 - 30),
    refused_at: null, refusal: null,
  })));
  assert.equal(mayDispatch(waiting, alive, fast, NOW).may, true);
});

test('a trusted shop still gets no rider while its till is dead', () => {
  const fast = speedOf('m2', 'A pharmacy', Array.from({ length: TRUSTED_AFTER_ORDERS }, (_, i) => ({
    order_id: `f${i}`, merchant_id: 'm2', sent_at: ago(600), accepted_at: ago(600 - 30),
    refused_at: null, refusal: null,
  })));
  const d = mayDispatch(offer({ merchant_id: 'm2' }), dead, fast, NOW);
  assert.equal(d.may, false, 'the rider would arrive at a shop that never saw the order');
  assert.match(d.says, /Somebody rings first/);
});

test('a till Sprint installed and did not keep working is Sprint fault, not the shop', () => {
  assert.equal(faultFor(offer({ merchant_id: 'm2' }), dead, NOW).fault, 'sprint');
  assert.match(faultFor(offer({ merchant_id: 'm2' }), dead, NOW).says, /this one is ours/);

  const givenUp = offer({ sent_at: ago(GIVE_UP_AFTER_SECONDS + 1) });
  assert.equal(faultFor(givenUp, alive, NOW).fault, 'merchant');
  assert.equal(faultFor(offer({ sent_at: ago(10) }), alive, NOW).fault, 'none');
});

test('the device wall answers where every till is and whether it works, dead ones first', () => {
  const wall = deviceWall([alive, dead, unboxed], NOW);
  assert.equal(wall[0].alive, false, 'what is broken comes first, not last');
  assert.equal(wall[wall.length - 1].alive, true);
  const box = wall.find((w) => w.till.merchant_id === 'm3');
  assert.match(box!.says, /never checked in/);
  assert.match(box!.says, /still be in a box/, 'a device nobody unpacked is a real and common state');
  assert.match(wall.find((w) => w.till.merchant_id === 'm2')!.says, /quiet for 40 minutes/);
});

test('an order offered in the future is refused rather than quietly treated as fresh', () => {
  assert.throws(() => tillState(offer({ sent_at: new Date(Date.parse(NOW) + 60000).toISOString() }), alive, NOW), TillError);
});

test('every line a person reads is plain and has no dashes', () => {
  const lines = [
    says(offer({ sent_at: ago(30) }), alive, NOW),
    says(offer({ sent_at: ago(300) }), alive, NOW),
    says(offer({ merchant_id: 'm2' }), dead, NOW),
    deviceWall([unboxed], NOW)[0].says,
    ...ladder(alive).map((r) => r.what),
  ];
  for (const l of lines) {
    assert.ok(l.length > 15);
    assert.equal(l.includes(' - '), false, `dash in: ${l}`);
  }
});
```

---

## api/src/orders/till.ts

```typescript
/**
 * Brick 32. The merchant till.
 *
 * Both competitors lose orders in the same place, and it is not the app. It is the shop counter. An
 * order arrives on a phone nobody is holding, the assistant is serving a queue, and twenty minutes
 * later a rider is standing at a till where nothing has been picked. The customer blames the courier.
 *
 * So the promise on the wall is two minutes to accept, and this file is what makes two minutes mean
 * something. It does four things nothing in this market does:
 *
 *   1. It separates "the shop has not accepted yet" from "the shop never got it". Those look
 *      identical on a dashboard and they are two different phone calls to two different people. A
 *      till that has stopped reporting in is a DEAD DEVICE, and chasing the shopkeeper about it
 *      wastes everyone's morning.
 *   2. It will not send a rider to a counter that has not accepted, unless that shop has EARNED it
 *      by being fast, measured over real orders rather than decided in a meeting.
 *   3. It escalates on a ladder with a named person at every rung, and the last rung is telling the
 *      customer the truth before their expectation breaks, not after.
 *   4. It never quietly cancels. Somebody is always named as holding it.
 *
 * The acceptance clock also feeds brick 34, so the shop that is quietly slow shows up by name
 * instead of by complaint.
 */

import { Fault } from './state_machine';

/** Two minutes. This is the number on the wall and in the pack, so it lives here once. */
export const ACCEPT_WITHIN_SECONDS = 120;

/** A till that has not reported in for this long is treated as dead, not as a slow shopkeeper. */
export const TILL_SILENT_AFTER_MINUTES = 10;

/** After this, the order stops waiting and a person tells the customer. Nothing cancels itself. */
export const GIVE_UP_AFTER_SECONDS = 600;

/** What a shop must show before a rider is sent before acceptance. Earned, never granted. */
export const TRUSTED_AFTER_ORDERS = 20;
export const TRUSTED_MEDIAN_SECONDS = 45;

export type TillChannel = 'printer' | 'tablet' | 'whatsapp' | 'phone_call';

export interface Till {
  merchant_id: string;
  merchant_name: string;
  channel: TillChannel;
  /** Last time the device said it was alive. Null means it has never checked in. */
  last_seen: string | null;
  /** Who at the shop is called when the till does not answer. A device needs a person behind it. */
  person: string | null;
  phone: string | null;
}

export interface Offer {
  order_id: string;
  merchant_id: string;
  /** When the order was put in front of the shop. */
  sent_at: string;
  /** When somebody at the shop pressed accept. Null while it is still waiting. */
  accepted_at: string | null;
  /** Set when the shop says no, with the reason in their own words. */
  refused_at: string | null;
  refusal: string | null;
}

export type TillState =
  | 'accepted'
  | 'refused'
  | 'waiting'        // inside the two minutes, nothing is wrong
  | 'late'           // past two minutes, the shop has it and has not pressed accept
  | 'device_silent'  // the till has not checked in, so the shop probably never saw it
  | 'given_up';      // past the limit, a person owns telling the customer

export class TillError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TillError';
  }
}

function secondsBetween(fromISO: string, toISO?: string): number {
  const to = toISO ? Date.parse(toISO) : Date.now();
  return Math.floor((to - Date.parse(fromISO)) / 1000);
}

function tillIsSilent(till: Till, nowISO?: string): boolean {
  if (!till.last_seen) return true;
  return secondsBetween(till.last_seen, nowISO) > TILL_SILENT_AFTER_MINUTES * 60;
}

/**
 * Where this order stands at the counter.
 *
 * The order of these questions is the whole point. A dead till is checked BEFORE lateness, because
 * an order sitting on a printer with no paper is not a slow shop, and ringing the shopkeeper about
 * it teaches them the app is nonsense.
 */
export function tillState(offer: Offer, till: Till, nowISO?: string): TillState {
  if (offer.accepted_at) return 'accepted';
  if (offer.refused_at) return 'refused';

  const waited = secondsBetween(offer.sent_at, nowISO);
  if (waited < 0) throw new TillError('An order cannot have been offered in the future.');

  if (tillIsSilent(till, nowISO)) return 'device_silent';
  if (waited >= GIVE_UP_AFTER_SECONDS) return 'given_up';
  if (waited >= ACCEPT_WITHIN_SECONDS) return 'late';
  return 'waiting';
}

export interface Rung {
  at_seconds: number;
  who: string;
  what: string;
}

/**
 * The escalation ladder. Every rung names a person, because "the system escalates" is how an order
 * ends up owned by nobody.
 */
export function ladder(till: Till): Rung[] {
  const person = till.person ?? 'whoever is on the counter';
  const rings = till.phone ? `ring ${person} on ${till.phone}` : `ring the shop and ask for ${person}`;
  const device = till.channel === 'printer' ? 'printer' : 'device';
  return [
    { at_seconds: 0, who: 'the till', what: `The order prints and the ${device} sounds until somebody touches it.` },
    { at_seconds: ACCEPT_WITHIN_SECONDS, who: 'the till', what: 'It sounds again, louder, and the order goes to the top of the screen.' },
    { at_seconds: 240, who: 'the office', what: `Somebody in the office will ${rings}.` },
    { at_seconds: 420, who: 'the office', what: 'The office offers the order to another shop that has the same goods, and tells the customer it is being moved.' },
    { at_seconds: GIVE_UP_AFTER_SECONDS, who: 'the office', what: 'The office tells the customer plainly that the shop cannot supply it, refunds, and the order is recorded against the shop.' },
  ];
}

/** The one line the office reads. It says what is wrong and who to ring, not a status code. */
export function says(offer: Offer, till: Till, nowISO?: string): string {
  const state = tillState(offer, till, nowISO);
  const waited = secondsBetween(offer.sent_at, nowISO);
  const mins = Math.floor(waited / 60);
  const who = till.person ?? 'the counter';

  switch (state) {
    case 'accepted':
      return `${till.merchant_name} accepted ${offer.order_id} in ${secondsBetween(offer.sent_at, offer.accepted_at as string)} seconds.`;
    case 'refused':
      return `${till.merchant_name} cannot supply ${offer.order_id}. They said: ${offer.refusal ?? 'no reason given'}.`;
    case 'device_silent':
      return `The till at ${till.merchant_name} has not checked in, so they probably never saw ${offer.order_id}. This is the device, not the shop. ` +
        (till.phone
          ? `Ring ${who} on ${till.phone} and read the order out.`
          : 'Nobody has given a phone number for this shop, so there is no way to reach them. That needs fixing before they take another order.');
    case 'late':
      return `${till.merchant_name} has had ${offer.order_id} for ${mins} minute${mins === 1 ? '' : 's'} and has not accepted it. Ring ${who}.`;
    case 'given_up':
      return `${offer.order_id} sat at ${till.merchant_name} for ${mins} minutes. The customer needs telling now, by a person.`;
    default: {
      const left = ACCEPT_WITHIN_SECONDS - waited;
      return `${till.merchant_name} has ${left} second${left === 1 ? '' : 's'} left to accept ${offer.order_id}.`;
    }
  }
}

export interface Speed {
  merchant_id: string;
  merchant_name: string;
  orders: number;
  median_seconds: number | null;
  inside_two_minutes: number;
  missed: number;
  trusted: boolean;
  says: string;
}

/**
 * How fast a shop actually is. This is the number that decides whether a rider may be sent early,
 * and it is measured rather than agreed. A shop can lose the privilege the same way it earned it.
 */
export function speedOf(merchant_id: string, merchant_name: string, offers: Offer[]): Speed {
  const all = offers.filter((o) => o.merchant_id === merchant_id);
  const times = all
    .filter((o) => o.accepted_at)
    .map((o) => secondsBetween(o.sent_at, o.accepted_at as string))
    .sort((a, b) => a - b);

  const median = times.length
    ? times.length % 2
      ? times[(times.length - 1) / 2]
      : Math.round((times[times.length / 2 - 1] + times[times.length / 2]) / 2)
    : null;

  const inside = times.filter((t) => t <= ACCEPT_WITHIN_SECONDS).length;
  const trusted = all.length >= TRUSTED_AFTER_ORDERS && median !== null && median <= TRUSTED_MEDIAN_SECONDS;

  return {
    merchant_id,
    merchant_name,
    orders: all.length,
    median_seconds: median,
    inside_two_minutes: inside,
    missed: all.length - inside,
    trusted,
    says: median === null
      ? `${merchant_name} has not accepted an order yet, so there is nothing to judge them on.`
      : `${merchant_name} usually accepts in ${median} seconds, ${inside} of ${all.length} inside two minutes.`,
  };
}

/**
 * May a rider be sent before the shop has accepted.
 *
 * Sending early wins minutes and costs a rider standing at a counter. So it is allowed only where
 * the shop has proved it is fast, and never while the till is dead, because a rider would be sent
 * to collect an order the shop has not even seen.
 */
export function mayDispatch(offer: Offer, till: Till, speed: Speed, nowISO?: string): { may: boolean; says: string } {
  const state = tillState(offer, till, nowISO);

  if (state === 'accepted') return { may: true, says: `${till.merchant_name} has accepted it, so a rider can go.` };
  if (state === 'refused') return { may: false, says: `${till.merchant_name} cannot supply it, so there is nothing to collect.` };
  if (state === 'device_silent') {
    return { may: false, says: `The till at ${till.merchant_name} is not answering, so a rider would arrive at a shop that never saw the order. Somebody rings first.` };
  }
  if (speed.trusted) {
    return { may: true, says: `${till.merchant_name} accepts in about ${speed.median_seconds} seconds on ${speed.orders} orders, so a rider can start now.` };
  }
  return {
    may: false,
    says: `${till.merchant_name} has not accepted yet and has not earned an early rider, so nobody is sent to wait at the counter.`,
  };
}

/**
 * Whose fault an unaccepted order is, in the words brick 15 and brick 19 already use, so a lost
 * order settles the same way as every other lost order rather than becoming a special case.
 */
export function faultFor(offer: Offer, till: Till, nowISO?: string): { fault: Fault; says: string } {
  const state = tillState(offer, till, nowISO);

  if (state === 'refused' || state === 'given_up') {
    return { fault: 'merchant', says: `${till.merchant_name} could not supply it.` };
  }
  if (state === 'device_silent') {
    // A device Sprint put in the shop and did not keep working is Sprint's problem, not the shop's.
    return { fault: 'sprint', says: `The till Sprint installed at ${till.merchant_name} was not working, so this one is ours.` };
  }
  return { fault: 'none', says: 'Nothing has gone wrong yet.' };
}

/**
 * Every till and whether it is alive. This is the asset question the director sweep asks: where is
 * each device, who has it, and is it working right now. Dead ones sort to the top.
 */
export function deviceWall(tills: Till[], nowISO?: string): Array<{ till: Till; alive: boolean; says: string }> {
  return tills
    .map((till) => {
      const alive = !tillIsSilent(till, nowISO);
      const mins = till.last_seen ? Math.floor(secondsBetween(till.last_seen, nowISO) / 60) : null;
      return {
        till,
        alive,
        says: alive
          ? `${till.merchant_name}: the ${till.channel} is on, last heard from ${mins} minute${mins === 1 ? '' : 's'} ago.`
          : till.last_seen
            ? `${till.merchant_name}: the ${till.channel} has been quiet for ${mins} minutes. Nobody there can receive an order.`
            : `${till.merchant_name}: this ${till.channel} has never checked in. It may still be in a box.`,
      };
    })
    .sort((a, b) => Number(a.alive) - Number(b.alive));
}
```

---

## api/src/orders/tracking.test.ts

```typescript
/**
 * Brick 20's proof. Run with:
 *   npm --prefix api run test:orders
 *
 * The first two tests are the council ruling, written so it cannot be redesigned away.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrivalWindow, panels, shouldConfirmAddress, whatsappLine, isSafeForWhatsapp } from './tracking';
import { create, confirmAtDoor, AddressPassport } from './address_passport';

const T0 = '2026-09-13T12:00:00.000Z';
const typed: AddressPassport = create({
  id: 'p1', customer_id: 'c1', label: 'Home',
  plot: 'Plot 2147, Block 8', landmark: 'Blue gate opposite ABC Hardware', at: T0,
});
const confirmed = confirmAtDoor(typed, 'courier_amo', T0);

test('the council ruling: the arrival window is above the map, always', () => {
  const w = arrivalWindow('picked_up', T0, T0);
  const p = panels('picked_up', confirmed, true, w);
  const arrival = p.find((x) => x.kind === 'arrival');
  const map = p.find((x) => x.kind === 'map');
  assert.ok(arrival && map, 'both should be on screen');
  assert.ok(arrival!.rank < map!.rank, 'the map must never be the headline');
});

test('the council ruling: a problem outranks everything, including the time', () => {
  const w = arrivalWindow('address_problem', T0, T0);
  const p = panels('address_problem', typed, true, w);
  assert.equal(p[0].kind, 'problem');
  assert.match(p[0].says, /cannot find the place/);
});

test('the answer is a window, never a countdown', () => {
  const w = arrivalWindow('picked_up', T0, T0)!;
  assert.ok(Date.parse(w.to) > Date.parse(w.from), 'it must be a range');
  assert.match(w.says, /between \d\d:\d\d and \d\d:\d\d/);
  assert.equal(/\bin \d+ minutes?\b/.test(w.says), false, 'never a countdown');
});

test('running late widens the window instead of sliding it', () => {
  const onTime = arrivalWindow('picked_up', T0, '2026-09-13T12:10:00.000Z')!;
  const late = arrivalWindow('picked_up', T0, '2026-09-13T13:10:00.000Z')!;
  const span = (w: typeof onTime) => Date.parse(w.to) - Date.parse(w.from);
  assert.equal(onTime.confidence, 'firm');
  assert.ok(span(late) > span(onTime), 'the uncertainty should be visible, not hidden');
  assert.match(late.says, /Running a bit behind|cannot give you a good time/);
});

test('when it is really late the app admits it does not know', () => {
  const w = arrivalWindow('picked_up', T0, '2026-09-13T14:30:00.000Z')!;
  assert.equal(w.confidence, 'unknown');
  assert.match(w.says, /cannot give you a good time/);
});

test('no arrival time is offered once there is nothing to arrive', () => {
  for (const s of ['delivered', 'cancelled', 'closed', 'returning', 'refund_due'] as const) {
    assert.equal(arrivalWindow(s, T0, T0), null, `${s} should not show a time`);
  }
});

test('the address is checked early, while there is still time to act', () => {
  assert.equal(shouldConfirmAddress('paid', typed, false), true);
  assert.equal(shouldConfirmAddress('at_merchant', typed, false), true);
  assert.equal(shouldConfirmAddress('picked_up', typed, false), false, 'too late to be useful');
  assert.equal(shouldConfirmAddress('at_door', typed, false), false);
});

test('a customer is asked once, and never about an address a rider already confirmed', () => {
  assert.equal(shouldConfirmAddress('paid', typed, true), false, 'asked twice teaches people to ignore it');
  assert.equal(shouldConfirmAddress('paid', confirmed, false), false, 'a rider has already been there');
  assert.equal(shouldConfirmAddress('paid', null, false), false);
});

test('the confirm panel names the landmark, because that is what people recognise', () => {
  const p = panels('paid', typed, false, arrivalWindow('paid', T0, T0));
  const confirm = p.find((x) => x.kind === 'confirm_address');
  assert.ok(confirm);
  assert.match(confirm!.says, /Blue gate opposite ABC Hardware/);
});

test('the map only appears once there is a rider to follow', () => {
  for (const s of ['placed', 'paid', 'dispatch_offered'] as const) {
    assert.equal(panels(s, confirmed, true, arrivalWindow(s, T0, T0)).some((x) => x.kind === 'map'), false,
      `${s} has no rider yet, so a map is a blank promise`);
  }
  assert.equal(panels('picked_up', confirmed, true, arrivalWindow('picked_up', T0, T0)).some((x) => x.kind === 'map'), true);
});

test('panels come back in order with no gaps or repeats', () => {
  const p = panels('at_merchant', typed, false, arrivalWindow('at_merchant', T0, T0));
  assert.deepEqual(p.map((x) => x.rank), p.map((_, i) => i + 1));
  assert.equal(new Set(p.map((x) => x.kind)).size, p.length);
});

test('WhatsApp gets a short line only when something actually happened', () => {
  assert.equal(whatsappLine('dispatch_offered', null), null, 'nobody needs telling we are still looking');
  assert.equal(whatsappLine('paid', null), null);
  assert.match(whatsappLine('at_door', null)!, /at your gate/);
  assert.match(whatsappLine('delivered', null)!, /Delivered/);
});

test('nothing clinical ever goes to WhatsApp, because WhatsApp leaves the country', () => {
  const states = ['dispatch_accepted', 'picked_up', 'at_door', 'delivered', 'stock_problem', 'address_problem', 'customer_absent'] as const;
  for (const s of states) {
    const line = whatsappLine(s, arrivalWindow(s, T0, T0));
    if (line) assert.equal(isSafeForWhatsapp(line), true, `${s} leaked something clinical: ${line}`);
  }
  assert.equal(isSafeForWhatsapp('Your prescription is on the way'), false);
  assert.equal(isSafeForWhatsapp('Your 500mg tablets are here'), false);
  assert.equal(isSafeForWhatsapp('Your order is on the road.'), true);
});

test('every line a customer reads is plain and has no dashes', () => {
  const lines = [
    arrivalWindow('picked_up', T0, T0)!.says,
    ...panels('address_problem', typed, false, arrivalWindow('address_problem', T0, T0)).map((p) => p.says),
    whatsappLine('at_door', null)!,
  ];
  for (const l of lines) {
    assert.ok(l.length > 8);
    assert.equal(l.includes(' - '), false, `dash in: ${l}`);
  }
});
```

---

## api/src/orders/tracking.ts

```typescript
/**
 * Brick 20. Tracking the Gaborone way.
 *
 * Both council seats reached the same ruling independently: put the ARRIVAL WINDOW and a
 * LANDMARK CONFIRMATION first, and make the map the secondary thing. A moving dot on a map is
 * what a customer watches when they do not trust the estimate. It is entertainment, not
 * information, and in a city without a street grid the dot is often wrong anyway.
 *
 * So this file answers two questions and refuses to answer a third.
 *
 *   1. When will it arrive? As a window, never as a countdown. "Between 14:20 and 14:40" can be
 *      right. "Arriving in 3 minutes" is a promise that is usually broken, and a customer who
 *      has been told three minutes for ten minutes stops believing anything the app says.
 *   2. Is the address still right? Asked ONCE, before the rider gets close, while there is still
 *      time to fix it. Not after they are lost outside the wrong gate.
 *   3. Exactly where is my rider right now? Available, second, and never the headline.
 *
 * The window WIDENS as an order runs late rather than quietly sliding. A window that keeps
 * moving by five minutes every five minutes is a lie told in instalments.
 */

import { OrderState, STATES } from './state_machine';
import { AddressPassport } from './address_passport';

export interface ArrivalWindow {
  /** ISO timestamps. Always a range, never a point. */
  from: string;
  to: string;
  /** How much to trust it. Drives the words shown, not just the numbers. */
  confidence: 'firm' | 'rough' | 'unknown';
  says: string;
}

export type PanelKind = 'arrival' | 'confirm_address' | 'map' | 'problem';

export interface Panel {
  kind: PanelKind;
  /** 1 is the top of the screen. The council's ruling lives in these numbers. */
  rank: number;
  says: string;
}

/** Minutes of work still ahead, by state. Rough on purpose; a false precision is worse. */
const MINUTES_REMAINING: Partial<Record<OrderState, [number, number]>> = {
  placed: [35, 60],
  paid: [30, 55],
  dispatch_offered: [30, 55],
  dispatch_accepted: [22, 40],
  at_merchant: [18, 32],
  picked_up: [8, 20],
  at_door: [0, 5],
  stock_problem: [25, 60],
  address_problem: [10, 30],
  customer_absent: [0, 10],
  rider_failed: [30, 70],
};

/** States where an arrival time is a fiction and should not be shown at all. */
const NO_ESTIMATE: OrderState[] = [
  'payment_failed', 'returning', 'returned', 'refund_due', 'cancelled', 'closed', 'delivered',
];

export function arrivalWindow(state: OrderState, sinceISO: string, nowISO?: string): ArrivalWindow | null {
  if (NO_ESTIMATE.includes(state)) return null;
  const range = MINUTES_REMAINING[state];
  if (!range) return null;

  const now = nowISO ? Date.parse(nowISO) : Date.now();
  const since = Date.parse(sinceISO);
  let [lo, hi] = range;

  // Running late in this state widens the window instead of sliding it. The customer sees the
  // uncertainty grow, which is the truth, rather than a promise quietly renewed.
  const limit = STATES[state].stuckAfterMinutes;
  const satFor = Number.isNaN(since) ? 0 : (now - since) / 60000;
  let confidence: ArrivalWindow['confidence'] = 'firm';
  if (limit !== null && satFor > limit) {
    const overBy = satFor - limit;
    lo = lo + Math.floor(overBy * 0.5);
    hi = hi + Math.ceil(overBy * 1.5);
    confidence = 'rough';
  }
  if (hi - lo > 45) confidence = 'unknown';

  const from = new Date(now + lo * 60000);
  const to = new Date(now + hi * 60000);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    confidence,
    says:
      confidence === 'unknown'
        ? 'We cannot give you a good time yet, someone is looking at this one'
        : confidence === 'rough'
          ? `Running a bit behind, expect it between ${hhmm(from)} and ${hhmm(to)}`
          : `Arriving between ${hhmm(from)} and ${hhmm(to)}`,
  };
}

function hhmm(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/**
 * Ask the customer to check the address ONCE, and only while there is still time to act on the
 * answer. Never for an address a rider has already confirmed, because asking a person to check
 * something the company already knows is how an app teaches people to ignore it.
 */
export function shouldConfirmAddress(
  state: OrderState,
  passport: AddressPassport | null,
  alreadyAsked: boolean,
): boolean {
  if (alreadyAsked || !passport) return false;
  if (passport.confidence === 'rider_confirmed') return false;
  return ['paid', 'dispatch_offered', 'dispatch_accepted', 'at_merchant'].includes(state);
}

/**
 * What the tracking screen shows, in order. This IS the council ruling, written as data so it
 * cannot drift back into a map at the top the next time somebody redesigns a screen.
 */
export function panels(
  state: OrderState,
  passport: AddressPassport | null,
  alreadyAsked: boolean,
  window: ArrivalWindow | null,
): Panel[] {
  const out: Panel[] = [];

  const problems: Partial<Record<OrderState, string>> = {
    stock_problem: 'The shop is short of something, tap to choose what to do',
    address_problem: 'Your rider cannot find the place, tap to help them',
    customer_absent: 'Your rider is outside and cannot reach you',
    payment_failed: 'The payment did not go through',
    rider_failed: 'We are finding you another rider',
  };
  if (problems[state]) {
    out.push({ kind: 'problem', rank: 1, says: problems[state] as string });
  }

  if (window) {
    out.push({ kind: 'arrival', rank: out.length + 1, says: window.says });
  }

  if (shouldConfirmAddress(state, passport, alreadyAsked)) {
    out.push({
      kind: 'confirm_address',
      rank: out.length + 1,
      says: `Still ${passport!.landmark || passport!.plot}? Tap to change it while there is time`,
    });
  }

  // The map is always last and always optional. That is the ruling.
  if (['dispatch_accepted', 'at_merchant', 'picked_up', 'at_door'].includes(state)) {
    out.push({ kind: 'map', rank: out.length + 1, says: 'See where your rider is' });
  }

  return out;
}

/**
 * The one line sent to WhatsApp. Kept short because it is read on a lock screen, and kept free
 * of anything clinical because WhatsApp leaves the country. See section 6 of the DPIA.
 */
export function whatsappLine(state: OrderState, window: ArrivalWindow | null): string | null {
  const worth: Partial<Record<OrderState, string>> = {
    dispatch_accepted: 'A rider has your order and is on the way to the shop.',
    picked_up: 'Your order is on the road.',
    at_door: 'Your rider is at your gate.',
    delivered: 'Delivered. Thank you for using Sprint.',
    stock_problem: 'The shop is short of something. Please open the app to choose what to do.',
    address_problem: 'Your rider cannot find the address. Please open the app to help.',
    customer_absent: 'Your rider is outside and cannot reach you.',
  };
  const base = worth[state];
  if (!base) return null;
  const line = window && ['dispatch_accepted', 'picked_up'].includes(state)
    ? `${base} ${window.says}.`
    : base;
  return line.replace(/\s+/g, ' ').trim();
}

/** Nothing about medicine, ever, on a channel that leaves the country. */
export function isSafeForWhatsapp(text: string): boolean {
  return !/(prescription|medicine|medication|tablet|pharmac|mg\b|dose)/i.test(text);
}
```

---

## api/src/simulator/simulator.module.ts

```typescript
import { Module } from '@nestjs/common';
import { SimulatorService } from './simulator.service';
import { DispatchModule } from '../dispatch/dispatch.module';
import { TrackingModule } from '../tracking/tracking.module';

@Module({
  imports: [DispatchModule, TrackingModule],
  providers: [SimulatorService],
})
export class SimulatorModule {}
```

---

## api/src/simulator/simulator.service.ts

```typescript
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CouriersRepo } from '../data-store/repositories/couriers.repo';
import { OrdersRepo } from '../data-store/repositories/orders.repo';
import { MerchantsRepo } from '../data-store/repositories/merchants.repo';
import { LedgerRepo } from '../data-store/repositories/ledger.repo';
import { OutboxRepo } from '../data-store/repositories/outbox.repo';
import { DispatchService } from '../dispatch/dispatch.service';
import { TrackingGateway } from '../tracking/tracking.gateway';
import { WAYPOINTS } from '../common/waypoints';
import { nextStepDelayMs } from '../orders/orders.service';
import { OrderRecord } from '../data-store/interfaces';
import { OrderStatus } from '../common/types';

const TICK_MS = 1000;
const IDLE_LERP = 0.12;
const BUSY_LERP = 0.28;
const ARRIVE_THRESHOLD = 0.003; // roughly 300m in degrees, close enough for a demo

// Order status walked through in order, each entry paired with the outbox
// event name used for that transition. Kept as a lookup table so the
// lifecycle only has to be spelled out once.
const NEXT_STEP: Record<string, { status: OrderStatus; event: string } | undefined> = {
  placed: { status: 'paid', event: 'order.paid' },
  paid: { status: 'dispatch.offered', event: 'dispatch.offered' },
  'dispatch.offered': { status: 'dispatch.accepted', event: 'dispatch.accepted' },
  'dispatch.accepted': { status: 'picked_up', event: 'order.picked_up' },
  picked_up: { status: 'delivered', event: 'order.delivered' },
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function distance(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  return Math.hypot(a.lat - b.lat, a.lng - b.lng);
}

// The whole demo's heartbeat: every second it nudges every courier's
// position and checks whether any order has reached its randomly rolled
// next_step_at, advancing the ones that have. This is what makes the API
// feel alive without any client ever polling for it.
@Injectable()
export class SimulatorService implements OnModuleInit {
  private readonly logger = new Logger(SimulatorService.name);

  constructor(
    private readonly couriersRepo: CouriersRepo,
    private readonly ordersRepo: OrdersRepo,
    private readonly merchantsRepo: MerchantsRepo,
    private readonly ledgerRepo: LedgerRepo,
    private readonly outboxRepo: OutboxRepo,
    private readonly dispatchService: DispatchService,
    private readonly tracking: TrackingGateway,
  ) {}

  onModuleInit(): void {
    setInterval(() => this.tick(), TICK_MS);
    this.logger.log('Simulator started, couriers wandering and orders advancing on their own.');
  }

  private tick(): void {
    this.moveCouriers();
    this.advanceDueOrders();
  }

  private moveCouriers(): void {
    const couriers = this.couriersRepo.listAll();
    for (const courier of couriers) {
      const activeOrder = this.ordersRepo
        .listActiveForCourier(courier.id)
        .find((o) => o.status === 'dispatch.accepted' || o.status === 'picked_up');

      if (activeOrder) {
        const target =
          activeOrder.status === 'picked_up'
            ? { lat: activeOrder.delivery_lat, lng: activeOrder.delivery_lng }
            : this.merchantPoint(activeOrder);
        if (target) {
          courier.lat = lerp(courier.lat, target.lat, BUSY_LERP);
          courier.lng = lerp(courier.lng, target.lng, BUSY_LERP);
        }
      } else {
        const wp = WAYPOINTS[courier.waypoint_target % WAYPOINTS.length];
        courier.lat = lerp(courier.lat, wp.lat, IDLE_LERP);
        courier.lng = lerp(courier.lng, wp.lng, IDLE_LERP);
        if (distance(courier, wp) < ARRIVE_THRESHOLD) {
          let next = Math.floor(Math.random() * WAYPOINTS.length);
          if (next === courier.waypoint_target) next = (next + 1) % WAYPOINTS.length;
          courier.waypoint_target = next;
        }
      }
    }
    for (const courier of couriers) {
      this.couriersRepo.update(courier.id, { lat: courier.lat, lng: courier.lng, waypoint_target: courier.waypoint_target });
    }
    this.tracking.emitCourierLocations(
      couriers.map((c) => ({ id: c.id, lat: c.lat, lng: c.lng, status: c.status })),
    );
  }

  private merchantPoint(order: OrderRecord): { lat: number; lng: number } | null {
    const merchant = this.merchantsRepo.findById(order.merchant_id);
    return merchant ? { lat: merchant.lat, lng: merchant.lng } : null;
  }

  private advanceDueOrders(): void {
    const due = this.ordersRepo.listDue(Date.now());
    for (const order of due) {
      this.advanceOrder(order);
    }
  }

  private advanceOrder(order: OrderRecord): void {
    const step = NEXT_STEP[order.status];
    if (!step) return;

    const nowIso = new Date().toISOString();
    order.status = step.status;
    order.timeline.push({ status: step.status, at: nowIso });
    order.next_step_at = Date.now() + nextStepDelayMs();
    this.ordersRepo.update(order.id, {
      status: order.status,
      timeline: order.timeline,
      next_step_at: order.next_step_at,
    });
    this.outboxRepo.append(step.event, order.id, { status: step.status });
    this.tracking.emitOrderStatus(order.id, step.status);

    if (step.status === 'dispatch.offered') {
      this.dispatchService.assign(order);
    } else if (step.status === 'dispatch.accepted') {
      if (order.courier_id) this.couriersRepo.update(order.courier_id, { status: 'busy' });
    } else if (step.status === 'delivered') {
      this.ledgerRepo.writeOrderSplit(order.id, order.total_bwp);
      if (order.courier_id) {
        const courier = this.couriersRepo.findById(order.courier_id);
        if (courier) {
          const courierAmt = Math.round(order.total_bwp * 0.18 * 100) / 100;
          this.couriersRepo.update(order.courier_id, {
            earnings_today_bwp: Math.round((courier.earnings_today_bwp + courierAmt) * 100) / 100,
            status: 'online',
          });
        }
      }
    }
  }
}
```

---

## api/src/tracking/tracking.gateway.ts

```typescript
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { DispatchScore } from '../data-store/interfaces';

// Namespace /rt carries every live update the web app cares about:
//  - courier_locations, an array of every courier, roughly once a second
//  - order_status, one order's new status the moment it changes
//  - dispatch_scored, the full scoring breakdown right after a courier
//    is offered an order
@WebSocketGateway({
  namespace: '/rt',
  cors: {
    origin: process.env.WEB_ORIGIN || 'http://localhost:5173',
    credentials: true,
  },
})
export class TrackingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  handleConnection(client: Socket): void {
    // No auth handshake needed for the alpha demo, the socket only ever
    // carries public-ish tracking data (positions, statuses, scores).
    void client;
  }

  handleDisconnect(client: Socket): void {
    void client;
  }

  emitCourierLocations(locations: { id: string; lat: number; lng: number; status: string }[]): void {
    this.server?.emit('courier_locations', locations);
  }

  emitOrderStatus(orderId: string, status: string): void {
    this.server?.emit('order_status', { order_id: orderId, status });
  }

  emitDispatchScored(orderId: string, scores: DispatchScore[]): void {
    this.server?.emit('dispatch_scored', { order_id: orderId, scores });
  }
}
```

---

## api/src/tracking/tracking.module.ts

```typescript
import { Module } from '@nestjs/common';
import { TrackingGateway } from './tracking.gateway';

@Module({
  providers: [TrackingGateway],
  exports: [TrackingGateway],
})
export class TrackingModule {}
```
