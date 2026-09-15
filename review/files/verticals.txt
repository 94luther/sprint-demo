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
