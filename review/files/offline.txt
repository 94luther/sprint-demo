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
