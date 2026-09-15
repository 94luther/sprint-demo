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
