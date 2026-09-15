# Sprint delivery engine, part 4 of 6

A customer facing delivery platform for Gaborone, Botswana. One app, many kinds of
shop, the way Checkers Sixty60 works: a shop has a KIND and each kind carries its
own rules. A pharmacy needs a pharmacist, a bottle store needs a licence and
trading hours, a pet shop needs neither.

TypeScript on NestJS. 271 tests passing, tsc clean.
Public copy: https://github.com/94luther/sprint-alpha-review

**This is part 4 of 6.** The engine is split so that nothing gets silently
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

## The 10 files in THIS part

**When you answer, tell me how many of these you actually read.**

1. `api/src/orders/network.ts`
2. `api/src/orders/offline.test.ts`
3. `api/src/orders/offline.ts`
4. `api/src/orders/ops.test.ts`
5. `api/src/orders/ops.ts`
6. `api/src/orders/orders.controller.ts`
7. `api/src/orders/orders.module.ts`
8. `api/src/orders/orders.service.ts`
9. `api/src/orders/parcel.test.ts`
10. `api/src/orders/parcel.ts`


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
