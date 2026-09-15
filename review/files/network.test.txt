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
