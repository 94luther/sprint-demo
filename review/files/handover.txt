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
