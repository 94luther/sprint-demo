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
