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
