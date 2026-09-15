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
