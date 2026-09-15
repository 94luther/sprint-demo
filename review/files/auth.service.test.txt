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
