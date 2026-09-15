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
