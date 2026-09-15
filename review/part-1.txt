# Sprint delivery engine, part 1 of 6

A customer facing delivery platform for Gaborone, Botswana. One app, many kinds of
shop, the way Checkers Sixty60 works: a shop has a KIND and each kind carries its
own rules. A pharmacy needs a pharmacist, a bottle store needs a licence and
trading hours, a pet shop needs neither.

TypeScript on NestJS. 271 tests passing, tsc clean.
Public copy: https://github.com/94luther/sprint-alpha-review

**This is part 1 of 6.** The engine is split so that nothing gets silently
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

## The 29 files in THIS part

**When you answer, tell me how many of these you actually read.**

1. `api/src/app.module.ts`
2. `api/src/auth/auth.controller.ts`
3. `api/src/auth/auth.module.ts`
4. `api/src/auth/auth.service.test.ts`
5. `api/src/auth/auth.service.ts`
6. `api/src/auth/dto.ts`
7. `api/src/catalog/catalog.controller.ts`
8. `api/src/catalog/catalog.module.ts`
9. `api/src/catalog/catalog.service.ts`
10. `api/src/catalog/verticals.test.ts`
11. `api/src/catalog/verticals.ts`
12. `api/src/common/aes.ts`
13. `api/src/common/jwt-auth.guard.ts`
14. `api/src/common/rate-limit.ts`
15. `api/src/common/types.ts`
16. `api/src/common/waypoints.ts`
17. `api/src/data-store/data-store.module.ts`
18. `api/src/data-store/interfaces.ts`
19. `api/src/data-store/repo-interfaces.ts`
20. `api/src/data-store/repositories/couriers.repo.ts`
21. `api/src/data-store/repositories/ledger.repo.ts`
22. `api/src/data-store/repositories/merchants.repo.ts`
23. `api/src/data-store/repositories/orders.repo.ts`
24. `api/src/data-store/repositories/outbox.repo.ts`
25. `api/src/data-store/repositories/postgres.repo.stub.ts`
26. `api/src/data-store/repositories/users.repo.ts`
27. `api/src/data-store/seed.ts`
28. `api/src/data-store/store.service.ts`
29. `api/src/dispatch/dispatch.module.ts`


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
